import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { derivedPort } from "./support/ports";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #23: on the Premium Plan, named Enriched Contacts at the employer, from a
// licensed contact-data provider: people found by the Company Dossier's Suggested
// Contact Roles, whose details the Candidate asks for one by one (counted against
// the Plan Quota), each showing its source provider and retrieval date, and usable
// as the Outreach Message's recipient. The provider is Apollo, faked by
// e2e/support/fake-contact-provider.mjs; the register behind the dossier by
// e2e/support/fake-company-sources.mjs.
const expect = baseExpect.configure({ timeout: 15_000 });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const t = fr.enrichedContacts;
const td = fr.tailoredDocuments;
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

/** Signs a new Candidate in (on `plan`), saves a Job Offer from Acme Industrie, builds its Company Dossier unless told not to, and opens the Application's Contacts Section. */
async function openApplication(
  page: Page,
  { plan, dossier = true, employer = "Acme Industrie", location = "Lyon" }: { plan: "free" | "premium"; dossier?: boolean; employer?: string; location?: string },
) {
  const email = newAddress("enriched-contacts");
  await signInWithMagicLink(page, email);
  if (plan === "premium") await subscribe(page, email, "premium");
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const offer = await page.request.post("/api/job-offers", {
    data: { title: "DAF H/F", content: `(réf. ${unique()}) Poste de DAF.`, employer, location },
    headers: { origin },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  if (dossier) {
    const built = await page.request.post(`/api/applications/${id}/company-dossier`, { headers: { origin } });
    expect(built.ok(), await built.text()).toBe(true);
  }
  await page.goto(`/candidatures/${id}/contacts`);
  await page.waitForLoadState("networkidle");
  return { id, section: page.getByRole("region", { name: t.title }) };
}

test.describe("Enriched Contacts", () => {
  test("a Premium Candidate finds people at the employer, gets one's details with their source and date, and addresses the Outreach Message to them", async ({ page }) => {
    const { id, section } = await openApplication(page, { plan: "premium" });

    await section.getByRole("button", { name: t.find }).click();

    const found = section.getByRole("group", { name: t.foundTitle });
    await expect(found.getByText("Claire Ma***n")).toBeVisible();
    await expect(found.getByText("Hugo Be***d")).toBeVisible();

    await found.getByRole("button", { name: t.revealFor.replace("{{name}}", "Claire Ma***n") }).click();
    const contacts = section.getByRole("group", { name: t.contactsTitle });
    await expect(contacts.getByText("Claire Martin")).toBeVisible();
    await expect(contacts.getByRole("link", { name: "claire.martin@acme-industrie.example" })).toBeVisible();
    await expect(contacts.getByText(/Source : Apollo, coordonnées obtenues le \d+/)).toBeVisible();

    // The provider has nothing for Hugo: nothing is counted, and he stays among the people found.
    await found.getByRole("button", { name: t.revealFor.replace("{{name}}", "Hugo Be***d") }).click();
    await expect(section.getByRole("alert")).toHaveText(t.noDetails);
    await expect(found.getByText("Hugo Be***d")).toBeVisible();

    // Premium's monthly Plan Quota counts Claire's details, and only hers.
    await page.goto("/abonnement");
    await expect(page.locator("dl").locator("div").filter({ hasText: "Contacts enrichis" }).locator("dd")).toHaveText("1 sur 20");
    await page.goBack();

    // The Outreach Message can be addressed to Claire: named in the draft, and the mail link is to her.
    await page.goto(`/candidatures/${id}/documents`);
    // The Outreach Message is a tab of the Application's Tailored Documents (#136).
    const documents = page.getByRole("region", { name: fr.application.documentsTitle });
    await documents.getByRole("tab", { name: td.outreachMessage.title }).click();
    const message = documents.getByRole("tabpanel", { name: td.outreachMessage.title });
    await message.getByLabel(td.outreachMessage.recipientLabel).selectOption({ label: "Claire Martin · DRH" });
    await message.getByRole("button", { name: td.outreachMessage.draft }).click();
    await expect(message.getByText(td.outreachMessage.addressedTo.replace("{{name}}", "Claire Martin (DRH)"))).toBeVisible();
    const mail = (await message.getByRole("link", { name: td.outreachMessage.openInMail }).getAttribute("href"))!;
    expect(mail.startsWith("mailto:claire.martin@acme-industrie.example?")).toBe(true);
  });

  test("a Candidate whose Plan has no Enriched Contacts gets the Upgrade Prompt, and nobody is looked up", async ({ page }) => {
    const { id, section } = await openApplication(page, { plan: "free" });

    await section.getByRole("button", { name: t.find }).click();

    await expect(section.getByRole("alert").getByRole("link", { name: /Premium/ })).toBeVisible();
    await expect(section.getByRole("group", { name: t.foundTitle })).toHaveCount(0);
    const state = await (await page.request.get(`/api/applications/${id}/enriched-contacts`)).json();
    expect(state).toEqual({ enabled: true, searchable: true, found: [], contacts: [] });
  });

  test("without a Company Dossier there is nothing to look for yet", async ({ page }) => {
    const { section } = await openApplication(page, { plan: "premium", dossier: false });

    await expect(section.getByText(t.needsDossier)).toBeVisible();
    await expect(section.getByRole("button", { name: t.find })).toHaveCount(0);
  });

  test("another Candidate cannot read or reveal someone else's contacts", async ({ page, browser }) => {
    const { id, section } = await openApplication(page, { plan: "premium" });
    await section.getByRole("button", { name: t.find }).click();
    await expect(section.getByRole("group", { name: t.foundTitle })).toBeVisible();
    const { found } = await (await page.request.get(`/api/applications/${id}/enriched-contacts`)).json();

    const other = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(other, newAddress("enriched-contacts-other"));
    expect((await other.request.get(`/api/applications/${id}/enriched-contacts`)).status()).toBe(404);
    expect((await other.request.post(`/api/applications/${id}/enriched-contacts/${found[0].id}`, { headers: { origin } })).status()).toBe(404);
    await other.close();
  });
});

/**
 * A second build of the app, on the suite's database, configured differently: the
 * Candidate signed in on the suite's server keeps their session there (same
 * AUTH_SECRET; cookies on localhost go to every port).
 */
async function startConfiguredServer(offset: number, contactEnrichment: Record<string, string>) {
  const port = derivedPort(offset);
  const serverOrigin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  for (const key of ["CONTACT_ENRICHMENT_PROVIDER", "CONTACT_ENRICHMENT_DPA_SIGNED", "LUSHA_API_KEY", "KASPR_API_KEY", "APOLLO_API_KEY", "CONTACT_ENRICHMENT_API_URL"]) delete env[key];
  Object.assign(env, {
    DATABASE_URL: process.env.E2E_DATABASE_URL,
    APP_URL: serverOrigin,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-e2e-only-secret-e2e-only",
    MAIL_TRANSPORT: "console",
    MISTRAL_API_KEY: "e2e-mistral-key",
    PERPLEXITY_API_KEY: "e2e-perplexity-key",
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
    STRIPE_PRICE_STANDARD: "price_standard_monthly",
    STRIPE_PRICE_PREMIUM: "price_premium_monthly",
    STRIPE_API_URL: process.env.E2E_STRIPE_URL,
    NODE_OPTIONS: ["fake-mistral.mjs", "fake-company-sources.mjs", "fake-contact-provider.mjs"].map((f) => `--import=${path.resolve("e2e/support", f)}`).join(" "),
    ...contactEnrichment,
  });
  let output = "";
  const child: ChildProcess = spawn("npx", ["next", "start", "apps/web", "-p", String(port)], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  const stop = () => {
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // already gone
    }
  };
  try {
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw new Error(`web app exited (${child.exitCode}):\n${output}`);
          return fetch(`${serverOrigin}/api/health`).then((r) => r.status, () => 0);
        },
        { timeout: 90_000, message: "web app answers /api/health" },
      )
      .toBe(200);
  } catch (error) {
    stop();
    throw error;
  }
  return { origin: serverOrigin, stop, output: () => output };
}

test.describe("Enriched Contacts configuration", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test(".env.example lists the provider choice, the DPA flag and every provider's API key, off by default", () => {
    const example = readFileSync(".env.example", "utf8");
    for (const key of ["CONTACT_ENRICHMENT_PROVIDER=", "CONTACT_ENRICHMENT_DPA_SIGNED=false", "LUSHA_API_KEY=", "KASPR_API_KEY=", "APOLLO_API_KEY="]) {
      expect(example).toMatch(new RegExp(`^${key}$`, "m"));
    }
  });

  const off = [
    { name: "a provider and its key, but the DPA not confirmed signed", offset: 700, env: { CONTACT_ENRICHMENT_PROVIDER: "apollo", APOLLO_API_KEY: "e2e-apollo-key", CONTACT_ENRICHMENT_DPA_SIGNED: "false" } },
    { name: "the DPA flag set, but no provider", offset: 720, env: { CONTACT_ENRICHMENT_DPA_SIGNED: "true" } },
  ];
  for (const { name, offset, env } of off) {
    test(`off with ${name}: no section, nobody looked up`, async ({ page }) => {
      const { id } = await openApplication(page, { plan: "premium" });
      const server = await startConfiguredServer(offset, env);
      try {
        const state = await (await page.request.get(`${server.origin}/api/applications/${id}/enriched-contacts`)).json();
        expect(state).toMatchObject({ enabled: false, found: [], contacts: [] });
        const find = await page.request.post(`${server.origin}/api/applications/${id}/enriched-contacts`, { headers: { origin: server.origin } });
        expect(find.status(), await find.text()).toBe(409);
        expect(await find.json()).toEqual({ error: "disabled" });
        await page.goto(`${server.origin}/candidatures/${id}/documents`);
        await expect(page.getByRole("tab", { name: td.outreachMessage.title })).toBeVisible();
        await expect(page.getByRole("region", { name: t.title })).toHaveCount(0);
        // No Contacts Section (ADR-0024): not listed, and not at its address.
        const sections = page.getByRole("navigation", { name: fr.application.sections.sectionsLabel });
        await expect(sections.getByRole("link", { name: fr.application.sections.documents })).toBeVisible();
        await expect(sections.getByRole("link", { name: fr.application.sections.contacts })).toHaveCount(0);
        expect((await page.goto(`${server.origin}/candidatures/${id}/contacts`))?.status()).toBe(404);
      } finally {
        server.stop();
      }
    });
  }

  // Issue #77: Lusha's v3 API, faked as strictly as the real one (e2e/support/fake-contact-provider.mjs):
  // a Prospecting request with a property v3 does not define (the old top-level `excludeDnc`) is refused
  // with 400, which the Candidate would see as "unavailable". QA #63 case 6.2, minus the real credits.
  // What the fake Lusha logged of each request the server sent it.
  type LushaRequest = {
    path: string;
    body: {
      ids?: string[];
      options: { excludeDnc?: boolean };
      pagination: { size: number };
      filters: { contacts: { include: { jobTitles: string[] } }; companies: { include: unknown } };
    };
  };
  test("on Lusha, a Premium Candidate finds people at a French register company and reveals one's email and phone", async ({ page }) => {
    const { id } = await openApplication(page, { plan: "premium" });
    const requestLog = path.join(mkdtempSync(path.join(os.tmpdir(), "jobhub-e2e-lusha-")), "requests.jsonl");
    const server = await startConfiguredServer(760, {
      CONTACT_ENRICHMENT_PROVIDER: "lusha",
      LUSHA_API_KEY: "e2e-lusha-key",
      CONTACT_ENRICHMENT_DPA_SIGNED: "true",
      E2E_LUSHA_REQUESTS: requestLog,
    });
    const lushaRequests = () =>
      existsSync(requestLog)
        ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LushaRequest)
        : [];
    try {
      await page.goto(`${server.origin}/candidatures/${id}/contacts`);
      await page.waitForLoadState("networkidle");
      const section = page.getByRole("region", { name: t.title });
      await section.getByRole("button", { name: t.find }).click();

      // People come from v3 `results[]`, named from firstName/lastName, titled from jobTitle.title;
      // the result Lusha could not give (error) and the one without an id are left out.
      const found = section.getByRole("group", { name: t.foundTitle });
      await expect(found.getByText("Sophie Lambert · DRH")).toBeVisible();
      await expect(found.getByText("Thomas Moreau · Responsable recrutement")).toBeVisible();
      await expect(found.getByRole("listitem")).toHaveCount(2);
      await expect(found.getByText("Léa Roux")).toHaveCount(0);
      await expect(found.getByText("Paul Durand")).toHaveCount(0);
      await expect(section.getByRole("alert")).toHaveCount(0);

      // The Prospecting request Lusha accepted: no do-not-contact exclusion, which plans without it refuse (#77);
      // do-not-call numbers are left out at reveal instead.
      const prospecting = lushaRequests().filter((r) => r.path === "/v3/contacts/prospecting");
      expect(prospecting).toHaveLength(1);
      const body = prospecting[0]!.body;
      expect(body.options).not.toHaveProperty("excludeDnc");
      expect(body).not.toHaveProperty("excludeDnc");
      expect(body.pagination.size).toBeGreaterThanOrEqual(10);
      expect(body.pagination.size).toBeLessThanOrEqual(100);
      expect(body.filters.contacts.include.jobTitles.length).toBeGreaterThan(0);
      expect(body.filters.companies.include).toBeTruthy();

      // Revealing Sophie goes through v3 Enrich Contacts and shows her email and phone,
      // not the number Lusha flags do-not-call.
      await found.getByRole("button", { name: t.revealFor.replace("{{name}}", "Sophie Lambert") }).click();
      const contacts = section.getByRole("group", { name: t.contactsTitle });
      await expect(contacts.getByRole("link", { name: "sophie.lambert@acme-industrie.example" })).toBeVisible();
      await expect(contacts.getByRole("link", { name: "+33 4 72 10 20 30" })).toHaveAttribute("href", "tel:+33472102030");
      await expect(contacts.getByText("+33 6 99 99 99 99")).toHaveCount(0);
      await expect(contacts.getByText(/Source : Lusha, coordonnées obtenues le \d+/)).toBeVisible();
      const enrich = lushaRequests().filter((r) => r.path === "/v3/contacts/enrich");
      expect(enrich.map((r) => r.body.ids)).toEqual([["e2e-lusha-sophie"]]);

      // Lusha has neither email nor phone for Thomas: nothing counted, he stays among the people found.
      await found.getByRole("button", { name: t.revealFor.replace("{{name}}", "Thomas Moreau") }).click();
      await expect(section.getByRole("alert")).toHaveText(t.noDetails);
      await expect(found.getByText("Thomas Moreau · Responsable recrutement")).toBeVisible();

      const state = await (await page.request.get(`${server.origin}/api/applications/${id}/enriched-contacts`)).json();
      expect(state.contacts).toEqual([
        expect.objectContaining({ name: "Sophie Lambert", jobTitle: "DRH", emails: ["sophie.lambert@acme-industrie.example"], phones: ["+33 4 72 10 20 30"], source: expect.objectContaining({ provider: "lusha" }) }),
      ]);
    } finally {
      server.stop();
    }
  });

  test("the provider is the one configured: on Kaspr, which cannot search by role, the search is not offered", async ({ page }) => {
    const { id } = await openApplication(page, { plan: "premium" });
    const server = await startConfiguredServer(740, { CONTACT_ENRICHMENT_PROVIDER: "kaspr", KASPR_API_KEY: "e2e-kaspr-key", CONTACT_ENRICHMENT_DPA_SIGNED: "true" });
    try {
      const state = await (await page.request.get(`${server.origin}/api/applications/${id}/enriched-contacts`)).json();
      expect(state).toMatchObject({ enabled: true, searchable: false });
      await page.goto(`${server.origin}/candidatures/${id}/contacts`);
      const section = page.getByRole("region", { name: t.title });
      await expect(section.getByText(t.searchUnsupported)).toBeVisible();
      await expect(section.getByRole("button", { name: t.find })).toHaveCount(0);
      const find = await page.request.post(`${server.origin}/api/applications/${id}/enriched-contacts`, { headers: { origin: server.origin } });
      expect(await find.json()).toEqual({ error: "search_unsupported" });
    } finally {
      server.stop();
    }
  });
});

// Issue #95: the people search is narrowed to a country, never a city: the Job Offer's
// location when it names one, else the employer's (the French register means France, a
// web dossier its own country), else not narrowed at all. Lusha takes the ISO code in
// filters.contacts.include.countries, Apollo the English name in person_locations[];
// what each provider was sent is logged by the fake (e2e/support/fake-contact-provider.mjs).
// Kaspr cannot search by role, so it has no search to narrow (covered above).
test.describe("Enriched Contacts people search country (#95)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  /** Where the Job Offer is, who the employer is, and the country the search must then be narrowed to (none: not narrowed). */
  const cases = [
    { name: "the Job Offer names no country and the employer is on the French register: France", employer: "Acme Industrie", location: "Lyon", country: "FR", apollo: "france" },
    { name: "the Job Offer's country wins over the employer's: Londres, Royaume-Uni", employer: "Acme Industrie", location: "Londres, Royaume-Uni", country: "GB", apollo: "united kingdom" },
    { name: "the Job Offer names no country and the web dossier gives Germany", employer: "Globex Robotics", location: "Lyon", country: "DE", apollo: "germany" },
    { name: "no country anywhere: the search is not narrowed", employer: "Atlantis Labs", location: "Lyon", country: undefined, apollo: undefined },
  ];

  /** A new Candidate (a page of their own) saves the Job Offer and starts the search on `server`; returns once the server has answered. */
  async function search(browser: Browser, server: { origin: string }, where: { employer: string; location: string }) {
    const page = await browser.newPage({ baseURL: origin, locale: "en-US" });
    try {
      const { id } = await openApplication(page, { plan: "premium", ...where });
      const found = await page.request.post(`${server.origin}/api/applications/${id}/enriched-contacts`, { headers: { origin: server.origin } });
      expect(found.status(), await found.text()).toBe(200);
    } finally {
      await page.close();
    }
  }

  const readLog = <T>(file: string) =>
    existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T) : [];

  test("on Lusha, the country goes to filters.contacts.include.countries, and a city never does", async ({ browser }) => {
    const log = path.join(mkdtempSync(path.join(os.tmpdir(), "jobhub-e2e-lusha-country-")), "requests.jsonl");
    const server = await startConfiguredServer(795, {
      CONTACT_ENRICHMENT_PROVIDER: "lusha",
      LUSHA_API_KEY: "e2e-lusha-key",
      CONTACT_ENRICHMENT_DPA_SIGNED: "true",
      E2E_LUSHA_REQUESTS: log,
    });
    type Prospecting = { path: string; body: { filters: { contacts: { include: { jobTitles: string[]; countries?: string[] } } } } };
    try {
      for (const { name, employer, location, country } of cases) {
        const before = readLog<Prospecting>(log).filter((r) => r.path === "/v3/contacts/prospecting").length;
        await search(browser, server, { employer, location });
        const sent = readLog<Prospecting>(log).filter((r) => r.path === "/v3/contacts/prospecting");
        expect(sent, name).toHaveLength(before + 1);
        const request = sent.at(-1)!;
        const include = request.body.filters.contacts.include;
        expect(include.jobTitles.length, name).toBeGreaterThan(0);
        if (country) expect(include.countries, name).toEqual([country]);
        else expect(include, name).not.toHaveProperty("countries");
        expect(JSON.stringify(request.body), name).not.toMatch(/Lyon|Londres|London/i);
      }
    } finally {
      server.stop();
    }
  });

  test("on Apollo, the country's English name goes to person_locations[], and a city never does", async ({ browser }) => {
    const log = path.join(mkdtempSync(path.join(os.tmpdir(), "jobhub-e2e-apollo-country-")), "requests.jsonl");
    const server = await startConfiguredServer(790, {
      CONTACT_ENRICHMENT_PROVIDER: "apollo",
      APOLLO_API_KEY: "e2e-apollo-key",
      CONTACT_ENRICHMENT_DPA_SIGNED: "true",
      E2E_APOLLO_REQUESTS: log,
    });
    type Search = { path: string; query: Record<string, string[]> };
    try {
      for (const { name, employer, location, apollo } of cases) {
        const before = readLog<Search>(log).length;
        await search(browser, server, { employer, location });
        const sent = readLog<Search>(log);
        expect(sent, name).toHaveLength(before + 1);
        const { query } = sent.at(-1)!;
        expect(query["person_titles[]"]?.length, name).toBeGreaterThan(0);
        if (apollo) expect(query["person_locations[]"], name).toEqual([apollo]);
        else expect(query, name).not.toHaveProperty("person_locations[]");
        // The employer's headquarters is not where the people are: never filtered on.
        expect(query, name).not.toHaveProperty("organization_locations[]");
        expect(JSON.stringify(query), name).not.toMatch(/Lyon|Londres|London/i);
      }
    } finally {
      server.stop();
    }
  });
});

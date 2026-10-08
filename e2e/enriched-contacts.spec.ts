import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect as baseExpect, test, type Page } from "@playwright/test";
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

/** Signs a new Candidate in (on `plan`), saves a Job Offer from Acme Industrie, builds its Company Dossier unless told not to, and opens the Application page. */
async function openApplication(page: Page, { plan, dossier = true }: { plan: "free" | "premium"; dossier?: boolean }) {
  const email = newAddress("enriched-contacts");
  await signInWithMagicLink(page, email);
  if (plan === "premium") await subscribe(page, email, "premium");
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const offer = await page.request.post("/api/job-offers", {
    data: { title: "DAF H/F", content: `(réf. ${unique()}) Poste de DAF.`, employer: "Acme Industrie", location: "Lyon" },
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
  await page.goto(`/candidatures/${id}`);
  await page.waitForLoadState("networkidle");
  return { id, section: page.getByRole("region", { name: t.title }) };
}

test.describe("Enriched Contacts", () => {
  test("a Premium Candidate finds people at the employer, gets one's details with their source and date, and addresses the Outreach Message to them", async ({ page }) => {
    const { section } = await openApplication(page, { plan: "premium" });

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
    await page.reload();
    const message = page.getByRole("group", { name: td.outreachMessage.title });
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
        await page.goto(`${server.origin}/candidatures/${id}`);
        await expect(page.getByRole("group", { name: td.outreachMessage.title })).toBeVisible();
        await expect(page.getByRole("region", { name: t.title })).toHaveCount(0);
      } finally {
        server.stop();
      }
    });
  }

  test("the provider is the one configured: on Kaspr, which cannot search by role, the search is not offered", async ({ page }) => {
    const { id } = await openApplication(page, { plan: "premium" });
    const server = await startConfiguredServer(740, { CONTACT_ENRICHMENT_PROVIDER: "kaspr", KASPR_API_KEY: "e2e-kaspr-key", CONTACT_ENRICHMENT_DPA_SIGNED: "true" });
    try {
      const state = await (await page.request.get(`${server.origin}/api/applications/${id}/enriched-contacts`)).json();
      expect(state).toMatchObject({ enabled: true, searchable: false });
      await page.goto(`${server.origin}/candidatures/${id}`);
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

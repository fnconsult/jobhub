import { readFileSync } from "node:fs";
import { chromium, expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import pg from "pg";
import {
  COMPANY_PAGE_HTML,
  COMPANY_PAGE_URL,
  JOB_PAGE_HTML,
  JOB_PAGE_URL,
  PEOPLE_PAGE_HTML,
  PEOPLE_PAGE_URL,
  PROFILE_PAGE_HTML,
  PROFILE_PAGE_URL,
} from "../apps/extension/src/linkedin-page.fixtures";
import { signInWithMagicLink } from "./support/candidate";
import { buildE2eExtension, e2eExtensionDir, unpackedExtensionId } from "./support/extension";
import { newAddress } from "./support/mailbox";

// Issue #1164 (ADR-0119 « LinkedIn, through the extension only »): on the Candidate's click on « Lire cette page LinkedIn »,
// the extension reads, in their own browser, a LinkedIn page they opened, and Jobbbox keeps of each person their name, role
// and company only, as contacts « LinkedIn » of the Application at that employer. The pages are invented, their structure
// LinkedIn's (apps/extension/src/linkedin-page.fixtures.ts), and served by this browser: LinkedIn itself is never reached.
// The acceptance criteria:
//  1. e2e of the extension on an invented test page that follows the structure: only the name, role and company are kept;
//  2. no request to linkedin.com: the browser's requests there are the Candidate's own tab's, never the extension's, and
//     the server's code reaches no network (apps/web/src/linkedin-readings/no-linkedin-request.test.ts).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.extension.linkedIn;
const origin = process.env.E2E_WEB_ORIGIN!;
const SETTING = "LINKEDIN_READING_ENABLED";
const tr = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

/** A Platform Setting as the Back Office saves it (null: back to its default), then the notification the server listens to. */
async function setSetting(name: string, value: string | null) {
  if (value === null) await query("DELETE FROM platform_setting WHERE name = $1", [name]);
  else
    await query(`INSERT INTO platform_setting (name, value, updated_by_email) VALUES ($1, $2, 'e2e@jobbbox.ai') ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()`, [
      name,
      value,
    ]);
  await query("SELECT pg_notify('platform_settings_changed', '')");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

const masterCv = {
  fullName: "Nathalie Fictive",
  headline: "Acheteuse industrielle",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["Achats"],
  languages: [],
};

const LINKEDIN = /^https:\/\/([a-z]+\.)?linkedin\.com\//;

test.describe("the extension reads a LinkedIn page the Candidate opened: name, role and company only (ADR-0119, #1164)", () => {
  let context: BrowserContext;
  /** Every request the browser sent to LinkedIn, and from which page. */
  const toLinkedIn: { url: string; page: Page | null }[] = [];

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    buildE2eExtension();
    await setSetting(SETTING, "true");
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      locale: "fr-FR",
      baseURL: origin,
      args: [`--disable-extensions-except=${e2eExtensionDir}`, `--load-extension=${e2eExtensionDir}`],
    });
    // The invented pages, at LinkedIn's addresses, served here: LinkedIn is never reached.
    const pages: Record<string, string> = {
      [new URL(PEOPLE_PAGE_URL).pathname]: PEOPLE_PAGE_HTML,
      [new URL(JOB_PAGE_URL).pathname]: JOB_PAGE_HTML,
      [new URL(COMPANY_PAGE_URL).pathname]: COMPANY_PAGE_HTML,
      [new URL(PROFILE_PAGE_URL).pathname]: PROFILE_PAGE_HTML,
    };
    await context.route(LINKEDIN, (route) => {
      const html = pages[new URL(route.request().url()).pathname];
      return html ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html }) : route.fulfill({ status: 404, body: "" });
    });
    await context.route(/^https:\/\/media\.licdn\.example\//, (route) => route.abort());
    context.on("request", (request: Request) => {
      if (LINKEDIN.test(request.url())) toLinkedIn.push({ url: request.url(), page: request.frame()?.page() ?? null });
    });
  });

  test.afterAll(async () => {
    await context?.close();
    await setSetting(SETTING, null);
  });

  /** The Side Panel's page, opened in a tab: Playwright cannot drive the browser's Side Panel itself. */
  async function openPanel(): Promise<Page> {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${unpackedExtensionId(e2eExtensionDir)}/sidepanel.html`);
    await expect(panel.getByRole("heading", { level: 1 })).toBeVisible();
    return panel;
  }

  /** A new signed-in Candidate with one Profile, on the web app's page `web`. */
  async function candidateWithProfile(): Promise<{ web: Page; profileId: string }> {
    // Each test's Candidate is new: the earlier one's session is forgotten first (the browser's cookies, not the extension's).
    await context.clearCookies();
    const web = await context.newPage();
    await signInWithMagicLink(web, newAddress("extension-linkedin"));
    const profile = await web.request.post(`${origin}/api/profiles`, { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Acheteuse industrielle", locations: ["Lyon"] } } });
    expect(profile.status(), await profile.text()).toBe(201);
    return { web, profileId: (await profile.json()).id };
  }

  /** A signed-in Candidate with an Application at « Exemple Industrie Fictive », on the web app's page `web`. */
  async function candidateApplyingThere(): Promise<{ web: Page; applicationId: string }> {
    const { web, profileId } = await candidateWithProfile();
    const jobOffer = await web.request.post(`${origin}/api/job-offers`, {
      headers: { origin },
      data: { source: { url: `https://www.welcometothejungle.com/fr/companies/exemple-industrie-fictive/jobs/acheteur-${Date.now()}` }, title: "Acheteur industriel H/F", content: "Vous négociez avec nos fournisseurs de pièces usinées.", employer: "Exemple Industrie Fictive", location: "Lyon" },
    });
    expect(jobOffer.status(), await jobOffer.text()).toBe(200);
    const application = await web.request.post(`${origin}/api/applications`, { headers: { origin }, data: { jobOfferId: (await jobOffer.json()).id, profileId } });
    expect([200, 201]).toContain(application.status());
    return { web, applicationId: (await application.json()).id };
  }

  test("a company's people filtered by department: on the click, each person's name, role and company are kept as contacts « LinkedIn » of the Application, nothing else", async () => {
    const { web, applicationId } = await candidateApplyingThere();
    const panel = await openPanel();
    const sent: string[] = [];
    panel.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/linkedin-readings" && request.method() === "POST") sent.push(request.postData() ?? "");
    });

    const linkedIn = await context.newPage();
    await linkedIn.goto(PEOPLE_PAGE_URL);
    await linkedIn.bringToFront();
    const read = panel.getByRole("button", { name: texts.read });
    await expect(read).toBeVisible();
    await expect(panel.getByText(texts.hint)).toBeVisible();
    // Nothing is read nor sent before the click.
    expect(sent).toEqual([]);
    expect(await query(`SELECT 1 FROM linkedin_reading r JOIN candidate c ON c.id = r.candidate_id JOIN application a ON a.candidate_id = c.id WHERE a.id = $1`, [applicationId])).toEqual([]);

    await read.click();
    await expect(panel.getByText(tr(texts.kept_other, { count: 3, company: "Exemple Industrie Fictive", places: tr(texts.application, { name: "Acheteur industriel H/F" }) }))).toBeVisible();

    // What the extension sent: the page, its company and department, and of each person their name, role and company.
    expect(sent).toHaveLength(1);
    const reading = JSON.parse(sent[0]!);
    expect(reading).toEqual({
      page: { kind: "people", url: "https://www.linkedin.com/company/exemple-industrie-fictive/people/" },
      company: "Exemple Industrie Fictive",
      department: "Achats",
      people: [
        { name: "Camille Fictive", role: "Responsable achats chez Exemple Industrie Fictive", company: "Exemple Industrie Fictive" },
        { name: "Lou Inventé", role: "Acheteur projets | Métallurgie", company: "Exemple Industrie Fictive" },
        { name: "Sacha Exemple", role: "Directrice des achats", company: "Exemple Industrie Fictive" },
      ],
    });
    // Not a profile's address, a photo, a place, a degree of connection, nor LinkedIn's anonymous member.
    for (const never of ["/in/", "licdn", "Auvergne", "2e niveau", "Voir le profil", "Membre LinkedIn"]) expect(sent[0], never).not.toContain(never);

    // What Jobbbox keeps: the three people, their name, role and company only, on the Application, marked LinkedIn.
    const kept = await query<Record<string, unknown>>(`SELECT * FROM linkedin_contact WHERE application_id = $1 ORDER BY position`, [applicationId]);
    expect(kept.map(({ name, role, company }) => ({ name, role, company }))).toEqual(reading.people);
    expect(Object.keys(kept[0]!).sort()).toEqual(["application_id", "candidate_id", "company", "id", "name", "name_key", "position", "read_at", "reading_id", "role", "target_company_id"]);
    await web.goto(`/candidatures/${applicationId}/contacts`);
    const contacts = web.getByRole("region", { name: fr.linkedInContacts.title });
    await expect(contacts.getByRole("listitem")).toHaveCount(3);
    await expect(contacts.getByRole("listitem").first()).toContainText("Camille Fictive");
    await expect(contacts.getByRole("listitem").first()).toContainText(fr.linkedInContacts.source);

    // Read again, nobody is doubled.
    await linkedIn.bringToFront();
    await read.click();
    await expect.poll(() => sent.length).toBe(2);
    await expect.poll(async () => (await query(`SELECT 1 FROM linkedin_contact WHERE application_id = $1`, [applicationId])).length).toBe(3);

    // The Data export holds them, with their name, role and company only.
    const exported = await (await web.request.get(`${origin}/api/account/export`)).json();
    const contactKeys = exported.linkedInReadings.flatMap((each: { contacts: object[] }) => each.contacts.map((contact) => Object.keys(contact).sort()));
    expect(new Set(contactKeys.map((keys: string[]) => keys.join(",")))).toEqual(new Set(["applicationId,company,name,readAt,role,targetCompanyId"]));
    await Promise.all([web.close(), panel.close(), linkedIn.close()]);
  });

  test("a company the Candidate targets, with no Application there: its people are on its card, marked « LinkedIn », and go with the Spontaneous Application prepared there", async () => {
    const { web, profileId } = await candidateWithProfile();
    // Added as the Candidate adds one by name (the company register is not reached here).
    const [{ id: targetCompanyId }] = await query<{ id: string }>(
      `INSERT INTO target_company (profile_id, candidate_id, company_key, name, origin) SELECT id, candidate_id, 'name:exemple industrie fictive', 'Exemple Industrie Fictive', 'candidate' FROM profile WHERE id = $1 RETURNING id`,
      [profileId],
    );
    const panel = await openPanel();
    const linkedIn = await context.newPage();

    await linkedIn.goto(PEOPLE_PAGE_URL);
    await linkedIn.bringToFront();
    await panel.getByRole("button", { name: texts.read }).click();
    await expect(panel.getByText(tr(texts.kept_other, { count: 3, company: "Exemple Industrie Fictive", places: tr(texts.targetCompany, { name: "Exemple Industrie Fictive" }) }))).toBeVisible();
    expect(await query(`SELECT name FROM linkedin_contact WHERE target_company_id = $1 ORDER BY position`, [targetCompanyId])).toEqual([
      { name: "Camille Fictive" },
      { name: "Lou Inventé" },
      { name: "Sacha Exemple" },
    ]);

    // Where the panel and the AI Coach's Provenance send the Candidate: the Profile's « Entreprises cibles », on its card.
    await web.goto(`/profils/${profileId}/entreprises-cibles`);
    const onCard = web.getByRole("list", { name: tr(fr.targetCompanies.linkedInLabel, { name: "Exemple Industrie Fictive" }) });
    await expect(onCard.getByRole("listitem")).toHaveCount(3);
    await expect(onCard.getByRole("listitem").first()).toContainText("Camille Fictive");
    await expect(onCard.getByRole("listitem").first()).toContainText(fr.linkedInContacts.source);

    // The Spontaneous Application prepared there takes them with it, in its « Contacts ».
    await web.getByRole("button", { name: fr.targetCompanies.prepareApplication }).click();
    await web.waitForURL(/\/candidatures\/[0-9a-f-]{36}/);
    const applicationId = new URL(web.url()).pathname.split("/")[2]!;
    await web.goto(`/candidatures/${applicationId}/contacts`);
    const contacts = web.getByRole("region", { name: fr.linkedInContacts.title });
    await expect(contacts.getByRole("listitem")).toHaveCount(3);
    await expect(contacts.getByRole("listitem").first()).toContainText(fr.linkedInContacts.source);
    await Promise.all([web.close(), panel.close(), linkedIn.close()]);
  });

  test("a Job Offer's hiring team: the recruiter's name, role and company; a company page that names no one", async () => {
    const { web, applicationId } = await candidateApplyingThere();
    const panel = await openPanel();
    const linkedIn = await context.newPage();

    await linkedIn.goto(JOB_PAGE_URL);
    await linkedIn.bringToFront();
    await panel.getByRole("button", { name: texts.read }).click();
    await expect(panel.getByText(tr(texts.kept_one, { count: 1, company: "Exemple Industrie Fictive", places: tr(texts.application, { name: "Acheteur industriel H/F" }) }))).toBeVisible();
    expect(await query(`SELECT name, role, company FROM linkedin_contact WHERE application_id = $1`, [applicationId])).toEqual([
      { name: "Dominique Fictif", role: "Talent Acquisition chez Exemple Industrie Fictive", company: "Exemple Industrie Fictive" },
    ]);

    await linkedIn.goto(COMPANY_PAGE_URL);
    await expect(panel.getByRole("button", { name: texts.read })).toBeVisible();
    await panel.getByRole("button", { name: texts.read }).click();
    await expect(panel.getByText(tr(texts.nobodyNamed, { company: "Exemple Industrie Fictive" }))).toBeVisible();
    await Promise.all([web.close(), panel.close(), linkedIn.close()]);
  });

  test("a person's profile is never offered for reading, and no request of the extension goes to linkedin.com", async () => {
    const { web } = await candidateApplyingThere();
    const panel = await openPanel();
    const fromPanel: string[] = [];
    panel.on("request", (request) => void (LINKEDIN.test(request.url()) && fromPanel.push(request.url())));
    const linkedIn = await context.newPage();

    await linkedIn.goto(PEOPLE_PAGE_URL);
    await linkedIn.bringToFront();
    await expect(panel.getByRole("button", { name: texts.read })).toBeVisible();
    await linkedIn.goto(PROFILE_PAGE_URL);
    await expect(panel.getByRole("button", { name: texts.read })).toHaveCount(0);

    // Every request to LinkedIn in this browser was a page the Candidate's own tab opened; none is the extension's.
    expect(fromPanel).toEqual([]);
    expect(toLinkedIn.length).toBeGreaterThan(0);
    for (const request of toLinkedIn) expect(request.page, request.url).not.toBe(panel);
    expect(toLinkedIn.every((request) => request.page !== null && !request.page.url().startsWith("chrome-extension://")), JSON.stringify(toLinkedIn.map((r) => r.url))).toBe(true);
    await Promise.all([web.close(), panel.close(), linkedIn.close()]);
  });

  test("with LINKEDIN_READING_ENABLED off (and in Production until #1160), the extension offers no reading", async () => {
    await setSetting(SETTING, "false");
    try {
      const { web } = await candidateApplyingThere();
      const panel = await openPanel();
      const linkedIn = await context.newPage();
      await linkedIn.goto(PEOPLE_PAGE_URL);
      await linkedIn.bringToFront();
      await expect(panel.getByRole("button", { name: fr.extension.capturePage })).toBeVisible();
      await expect(panel.getByRole("button", { name: texts.read })).toHaveCount(0);
      await Promise.all([web.close(), panel.close(), linkedIn.close()]);
    } finally {
      await setSetting(SETTING, "true");
    }
  });
});

import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #1079: every change of a Tailored Document (Cover Letter, Outreach Message, Tailored CV) keeps the version before it.
// Each version has its date, origin, Document Language and (letter, message) subject; one save is one version, not one per
// keystroke; the last 20 are kept; « Versions » in each tab lists them, opens one read-only and restores it as a new
// version; the versions are in the Data export, seen read-only by a Human Coach with Coach Access, and go with the account.
// The « Remplacer et rédiger » round trip and the AI Coach's Coach Actions are in coach-document-actions.spec.ts.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const td = fr.tailoredDocuments;
const dv = fr.documentVersions;
const origin = process.env.E2E_WEB_ORIGIN!;
const database = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
const ADMINISTRATOR = "document-versions-office@e2e.jobbbox.test";

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [],
};
const OFFER = { title: "Directeur administratif et financier (H/F)", content: "Acme Industrie recrute son DAF. Vous pilotez la clôture des comptes et vous encadrez une équipe de 12 personnes." };

/** A Profile and an Application for the Candidate signed in on `page`. */
async function newApplication(page: Page): Promise<string> {
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, ...OFFER, employer: "Acme Industrie", location: "Lyon" },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id as string;
}

async function candidate(page: Page, label: string): Promise<{ email: string; applicationId: string }> {
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  return { email, applicationId: await newApplication(page) };
}

const draft = async (page: Page, id: string, data: object) => {
  const response = await page.request.post(`/api/applications/${id}/tailored-documents`, { data, headers: { origin } });
  expect(response.ok(), await response.text()).toBe(true);
};
const edit = async (page: Page, id: string, data: object) => {
  const response = await page.request.patch(`/api/applications/${id}/tailored-documents`, { data, headers: { origin } });
  expect(response.ok(), await response.text()).toBe(true);
};
/** A Tailored CV proposed and saved as proposed. */
async function saveTailoredCv(page: Page, id: string) {
  const proposed = await page.request.post(`/api/applications/${id}/tailored-cv`, { data: { language: "fr" }, headers: { origin } });
  expect(proposed.ok(), await proposed.text()).toBe(true);
  const { revision, changes } = (await proposed.json()).proposal as { revision: string; changes: { id: string }[] };
  const saved = await page.request.post(`/api/applications/${id}/tailored-cv/save`, { data: { revision, accepted: changes.map((change) => change.id) }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
}
const versionRows = async (applicationId: string, document: string) =>
  (await database.query<{ version: number; source: string; language: string; subject: string | null; restored_from: number | null }>(
    "SELECT version, source, language, snapshot->>'subject' AS subject, restored_from FROM tailored_document_version WHERE application_id = $1 AND document = $2 ORDER BY version",
    [applicationId, document],
  )).rows;

const documents = (page: Page) => page.getByRole("region", { name: fr.application.documentsTitle });
async function tab(page: Page, name: string) {
  await documents(page).getByRole("tab", { name, exact: true }).click();
  return documents(page).getByRole("tabpanel", { name, exact: true });
}

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

test.describe("Tailored Document Versions (#1079)", () => {
  test("an Outreach Message keeps a version per change, with its origin, language and subject; typing makes none, a save makes one, an unchanged save none", async ({ page }) => {
    const { applicationId } = await candidate(page, "versions-outreach");
    await draft(page, applicationId, { document: "outreach_message", channel: "email" });
    await page.goto(`/candidatures/${applicationId}/documents`);
    const panel = await tab(page, td.outreachMessage.title);

    // Typing alone keeps nothing: only the save does.
    await panel.getByLabel(td.outreachMessage.subjectLabel).fill("Mon objet retouché");
    await panel.getByLabel(td.outreachMessage.textLabel).pressSequentially("Bonjour, ", { delay: 5 });
    await panel.getByLabel(td.outreachMessage.textLabel).fill("Bonjour,\nMon message retouché.");
    expect(await versionRows(applicationId, "outreach_message")).toHaveLength(1);
    await panel.getByRole("button", { name: td.save }).click();
    await expect(panel.getByRole("status")).toHaveText(td.saved);
    expect(await versionRows(applicationId, "outreach_message")).toEqual([
      expect.objectContaining({ version: 1, source: "drafted", language: "fr" }),
      expect.objectContaining({ version: 2, source: "candidate", language: "fr", subject: "Mon objet retouché" }),
    ]);
    // Saving the same text again changes nothing, so keeps nothing.
    await panel.getByRole("button", { name: td.save }).click();
    await expect(panel.getByRole("status")).toHaveText(td.saved);
    expect(await versionRows(applicationId, "outreach_message")).toHaveLength(2);

    await panel.getByRole("button", { name: dv.toggle, exact: true }).click();
    const items = panel.getByRole("list", { name: dv.listLabel }).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(`${tr(dv.version, { version: "2" })} · ${dv.current}`);
    await expect(items.nth(0)).toContainText(dv.sources.candidate);
    await expect(items.nth(0)).toContainText(td.languages.fr);
    await expect(items.nth(1)).toContainText(dv.sources.drafted);
    // A version opens read-only with its subject, and the Restore brings it back as version 3.
    await panel.getByRole("button", { name: tr(dv.open, { version: "1" }) }).click();
    const shown = panel.getByRole("region", { name: tr(dv.readOnly, { version: "1" }) });
    await expect(shown).toContainText(tr(dv.subject, { subject: `Candidature (fr) : ${OFFER.title}` }));
    await expect(shown.getByRole("textbox")).toHaveCount(0);
    await shown.getByRole("button", { name: dv.restore }).click();
    await expect(panel.getByRole("status").filter({ hasText: tr(dv.restored, { version: "1" }) })).toBeVisible();
    await expect(panel.getByLabel(td.outreachMessage.subjectLabel)).toHaveValue(`Candidature (fr) : ${OFFER.title}`);
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText(tr(dv.sources.restored, { version: "1" }));
    expect((await versionRows(applicationId, "outreach_message")).map((row) => [row.version, row.source, row.restored_from])).toEqual([
      [1, "drafted", null],
      [2, "candidate", null],
      [3, "restored", 1],
    ]);
  });

  test("the Tailored CV tab has « Versions »: a saved proposal is version 1, current, announced in words, read-only", async ({ page }) => {
    const { applicationId } = await candidate(page, "versions-cv");
    await saveTailoredCv(page, applicationId);
    expect(await versionRows(applicationId, "tailored_cv")).toEqual([expect.objectContaining({ version: 1, source: "drafted", language: "fr" })]);

    await page.goto(`/candidatures/${applicationId}/documents`);
    const panel = await tab(page, fr.tailoredCv.tailored);
    await panel.getByRole("button", { name: dv.toggle, exact: true }).click();
    const list = panel.getByRole("list", { name: dv.listLabel });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByRole("listitem")).toContainText(`${tr(dv.version, { version: "1" })} · ${dv.current}`);
    await expect(list.getByRole("listitem")).toContainText(dv.sources.draftedCv);
    await expect(list.getByRole("listitem")).toHaveAttribute("aria-current", "true");
    await panel.getByRole("button", { name: tr(dv.open, { version: "1" }) }).click();
    const shown = panel.getByRole("region", { name: tr(dv.readOnly, { version: "1" }) });
    await expect(shown).toContainText("Marie Dupont");
    await expect(shown.getByRole("textbox")).toHaveCount(0);
    // The current version needs no Restore.
    await expect(shown.getByRole("button", { name: dv.restore })).toHaveCount(0);
  });

  test("a document keeps its last 20 versions: the oldest goes first, and the Help Article says so", async ({ page }) => {
    const { applicationId } = await candidate(page, "versions-limit");
    await draft(page, applicationId, { document: "cover_letter" });
    for (let n = 1; n <= 22; n += 1) await edit(page, applicationId, { document: "cover_letter", text: `Ma lettre, état ${n}.` });

    const versions = (await (await page.request.get(`/api/applications/${applicationId}/document-versions`)).json()).cover_letter as { version: number; current: boolean }[];
    expect(versions).toHaveLength(20);
    expect(versions.map((v) => v.version)).toEqual(Array.from({ length: 20 }, (_, i) => 23 - i));
    expect(versions[0]).toMatchObject({ version: 23, current: true });
    expect((await versionRows(applicationId, "cover_letter")).map((row) => row.version)).not.toContain(3);
    // The Candidate is told, on the page and in the Help Article.
    await page.goto(`/candidatures/${applicationId}/documents`);
    const panel = await tab(page, td.coverLetter.title);
    await panel.getByRole("button", { name: dv.toggle, exact: true }).click();
    await expect(panel).toContainText(tr(dv.intro, { max: "20" }));
    await expect(panel.getByRole("list", { name: dv.listLabel }).getByRole("listitem")).toHaveCount(20);
    const article = readFileSync("packages/help/articles/fr/glossary-document-version.md", "utf8");
    expect(article).toMatch(/\b20\b/);
  });

  test("the lists are reachable and operable by keyboard, announce the current version in words, and meet the accessibility floor", async ({ page }) => {
    const { applicationId } = await candidate(page, "versions-a11y");
    await draft(page, applicationId, { document: "cover_letter" });
    await edit(page, applicationId, { document: "cover_letter", text: "Ma lettre, revue." });
    await page.goto(`/candidatures/${applicationId}/documents`);
    const panel = await tab(page, td.coverLetter.title);
    const toggle = panel.getByRole("button", { name: dv.toggle, exact: true });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const items = panel.getByRole("list", { name: dv.listLabel }).getByRole("listitem");
    await expect(items.nth(0)).toHaveAttribute("aria-current", "true");
    await expect(items.nth(0)).toContainText(dv.current);
    await expect(items.nth(1)).not.toHaveAttribute("aria-current", "true");
    await expect(items.nth(1)).not.toContainText(dv.current);
    await panel.getByRole("button", { name: tr(dv.open, { version: "1" }) }).focus();
    await page.keyboard.press("Space");
    await expect(panel.getByRole("region", { name: tr(dv.readOnly, { version: "1" }) })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: dv.restore })).toBeFocused();
    // The versions' own text (the rest of the page is the other specs') meets the accessibility floor (ADR-0009).
    const own = (await renderedTexts(page)).filter((t) => [dv.toggle, dv.current, dv.restore, dv.intro.slice(0, 20), tr(dv.version, { version: "1" })].some((word) => t.text.includes(word)));
    expect(own.length).toBeGreaterThan(0);
    for (const t of own) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the Data export holds every version; the Human Coach with Coach Access sees them read-only; deleting the account deletes them", async ({ page, browser }) => {
    // A Human Coach, added in the Back Office.
    const admin = await personPage(browser, ADMINISTRATOR);
    const coachEmail = newAddress("versions-coach");
    const coachName = `Sophie Martin ${unique()}`;
    await admin.goto("/admin/coachs");
    await admin.getByLabel(fr.admin.humanCoaches.name).fill(coachName);
    await admin.getByLabel(fr.admin.humanCoaches.email).fill(coachEmail);
    await admin.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/sophie-${unique()}/seance`);
    await admin.getByLabel(fr.admin.humanCoaches.bio).fill("Ancienne DRH.");
    await admin.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
    await expect(admin.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name: coachName }));
    await admin.context().close();

    const { email, applicationId } = await candidate(page, "versions-export");
    await draft(page, applicationId, { document: "cover_letter" });
    await edit(page, applicationId, { document: "cover_letter", text: "Ma lettre, retouchée à la main." });
    await draft(page, applicationId, { document: "outreach_message", channel: "email" });
    await saveTailoredCv(page, applicationId);

    // Export (GDPR art. 15 and 20).
    await page.goto("/compte/donnees");
    const section = page.getByRole("region", { name: fr.accountData.title });
    const [file] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: fr.accountData.export }).click()]);
    const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
    const versions = exported.applications[0].tailoredDocuments.versions;
    expect(versions.cover_letter.map((v: { version: number; source: string; current: boolean }) => [v.version, v.source, v.current])).toEqual([
      [2, "candidate", true],
      [1, "drafted", false],
    ]);
    expect(versions.cover_letter[0]).toMatchObject({ text: "Ma lettre, retouchée à la main.", language: "fr", savedAt: expect.any(String) });
    expect(versions.outreach_message).toHaveLength(1);
    expect(versions.outreach_message[0].subject).toEqual(expect.any(String));
    expect(versions.tailored_cv).toHaveLength(1);
    expect(versions.tailored_cv[0].cv).toMatchObject({ fullName: "Marie Dupont" });

    // Coach Access: the same versions, read-only.
    await page.goto("/coachs");
    await page.getByRole("button", { name: tr(fr.humanCoaches.grant, { name: coachName }) }).click();
    await expect(page.getByText(tr(fr.humanCoaches.accessGranted, { name: coachName }))).toBeVisible();
    const coachPage = await personPage(browser, coachEmail);
    await coachPage.goto("/espace-coach");
    await coachPage.getByRole("link", { name: email }).click();
    await coachPage.getByRole("link", { name: /DAF|Directeur/ }).first().click();
    await expect(coachPage).toHaveURL(new RegExp(`/candidatures/${applicationId}$`));
    const toggles = coachPage.getByRole("button", { name: dv.toggle, exact: true });
    await expect(toggles).toHaveCount(3);
    await toggles.nth(1).click();
    await expect(coachPage.getByRole("listitem").filter({ hasText: dv.current }).first()).toBeVisible();
    await expect(coachPage.getByRole("button", { name: dv.restore })).toHaveCount(0);
    await coachPage.getByRole("button", { name: tr(dv.open, { version: "1" }) }).first().click();
    await expect(coachPage.getByRole("button", { name: dv.restore })).toHaveCount(0);
    // And no way to restore through the API either.
    const refused = await coachPage.request.post(`/api/applications/${applicationId}/document-versions`, { data: { document: "cover_letter", version: 1 }, headers: { origin } });
    expect(refused.ok()).toBe(false);
    expect((await versionRows(applicationId, "cover_letter")).length).toBe(2);
    await coachPage.context().close();

    // Deleted with the account.
    expect((await versionRows(applicationId, "cover_letter")).length).toBeGreaterThan(0);
    await page.goto("/compte/donnees");
    await section.getByLabel(fr.accountData.confirmLabel).fill(email);
    await section.getByRole("button", { name: fr.accountData.delete }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.accountDeleted.title);
    const left = await database.query("SELECT 1 FROM tailored_document_version WHERE application_id = $1", [applicationId]);
    expect(left.rowCount).toBe(0);
  });

  test("another Candidate's versions are out of reach", async ({ page, browser }) => {
    const { applicationId } = await candidate(page, "versions-private");
    await draft(page, applicationId, { document: "cover_letter" });
    const other = await personPage(browser, newAddress("versions-stranger"));
    expect((await other.request.get(`/api/applications/${applicationId}/document-versions`)).status()).toBe(404);
    expect((await other.request.post(`/api/applications/${applicationId}/document-versions`, { data: { document: "cover_letter", version: 1 }, headers: { origin } })).status()).toBe(404);
    await other.context().close();
    expect((await new Page_(page).anonymous(applicationId)).status()).toBe(401);
  });
});

/** The same request with no session. */
class Page_ {
  constructor(private readonly page: Page) {}
  async anonymous(applicationId: string) {
    const context = await this.page.context().browser()!.newContext({ baseURL: origin });
    try {
      return await context.request.get(`/api/applications/${applicationId}/document-versions`);
    } finally {
      await context.close();
    }
  }
}

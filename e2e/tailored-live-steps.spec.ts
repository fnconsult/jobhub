import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { applicationDocumentsPage } from "../apps/web/src/ai-activity";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #334: a Tailored CV proposed and a Cover Letter or Outreach Message drafted keep their Provenance (ADR-0034): the line
// under each says the model, tokens and time, and the `/candidatures/[id]/documents` loader AI Activity's pane reads gives
// each document with it. Each runs in its own request and shows its step live beside « Arrêter »; a Stop aborts the AI call
// (AI Usage records it `stopped`), keeps no document and says « Arrêtée à 10:42 » in light red. The AI is faked inside the
// server (fake-mistral.mjs): "E2E_WRITING_SLOW=<ms>" in the Job Offer makes the writing take that long.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const td = fr.tailoredDocuments;
const tc = fr.tailoredCv;
const origin = process.env.E2E_WEB_ORIGIN!;

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

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** Signs a new Candidate in and opens the documents of a new Application on a Job Offer with this text. */
async function openApplication(page: Page, content: string): Promise<string> {
  await signInWithMagicLink(page, newAddress("tailored-live"));
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, title: "DAF (H/F)", content, employer: "Acme Industrie", location: "Lyon" },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  await page.goto(`/candidatures/${id}/documents`);
  return id;
}

const documents = (page: Page) => page.getByRole("region", { name: fr.application.documentsTitle });
async function tab(page: Page, name: string): Promise<Locator> {
  await documents(page).getByRole("tab", { name, exact: true }).click();
  return documents(page).getByRole("tabpanel", { name, exact: true });
}

/** The loader AI Activity's pane reads for `/candidatures/[id]/documents`, fed by the page's own API. */
async function loadedPage(page: Page, id: string) {
  const read = async (path: string) => (await page.request.get(`/api/applications/${id}/${path}`)).json();
  const [tailoredCv, drafts] = await Promise.all([read("tailored-cv"), read("tailored-documents")]);
  return applicationDocumentsPage({ get: async () => tailoredCv }, { get: async () => drafts }, "the Candidate", id);
}

/** The color `--color-danger-surface` resolves to, next to `element`. */
const dangerSurface = (element: Locator) =>
  element.evaluate((node) => {
    const probe = document.createElement("div");
    probe.style.background = "var(--color-danger-surface)";
    node.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });

test.describe("Tailored CV and Tailored Documents: Provenance, live steps and Stop (#334)", () => {
  test("a new Tailored CV and Cover Letter show their model, tokens and time, and the documents page gives each to AI Activity", async ({ page }) => {
    const id = await openApplication(page, "Acme Industrie recrute son DAF. Vous pilotez la clôture des comptes. E2E_WRITING_SLOW=1500");

    const cv = await tab(page, tc.tailored);
    await cv.getByRole("button", { name: tc.propose, exact: true }).click();
    // While it is written: the step live, its glyph beside its label, and « Arrêter ».
    const step = cv.locator(".live-action-step");
    await expect(step).toContainText(fr.aiActivity.steps.write);
    await expect(step.locator("svg.activity-glyph")).toBeVisible();
    expect(await step.evaluate((element) => element.closest("[aria-live], [role=status], [role=alert]"))).toBeNull();
    await expect(cv.getByRole("button", { name: fr.aiActivity.stop, exact: true })).toBeVisible();
    const axe = await new AxeBuilder({ page }).include("section.section").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id: rule }) => rule)).toEqual([]);

    await expect(cv.getByRole("status")).toHaveText(tc.proposed);
    await expect(cv.getByRole("button", { name: fr.aiActivity.stop, exact: true })).toHaveCount(0);
    const cvLine = cv.locator(".provenance-line").first();
    await expect(cvLine).toContainText("Mistral");
    await expect(cvLine).toContainText(/· \d+(,\d)? s/);

    const letter = await tab(page, td.coverLetter.title);
    await letter.getByRole("button", { name: td.coverLetter.draft }).click();
    await expect(letter.locator(".live-action-step")).toContainText(fr.aiActivity.steps.write);
    await expect(letter.getByRole("status")).toHaveText(td.drafted);
    const letterLine = letter.locator(".provenance-line");
    await expect(letterLine).toContainText("Mistral");
    await expect(letterLine).toContainText(/· \d+(,\d)? s/);

    // The pane's loader: each document with the model that wrote it, its tokens and time; no internal id.
    const elements = await loadedPage(page, id);
    expect(elements.map((element) => element.kind)).toEqual(["tailored_cv", "tailored_documents"]);
    for (const element of elements) {
      expect(element.served).not.toBeNull();
      const { models, tokens, ms } = element.served!;
      expect(models[0]!.name).toMatch(/^Mistral/);
      expect(models[0]!.tokens).toBeGreaterThan(0);
      expect(tokens).toBeGreaterThan(0);
      expect(ms).toBeGreaterThanOrEqual(1500);
    }
    expect(JSON.stringify(elements)).not.toContain(id);

    // Saved, the Tailored CV keeps the proposal's Provenance.
    await cv.page().getByRole("tab", { name: tc.tailored, exact: true }).click();
    await cv.getByRole("button", { name: tc.save, exact: true }).click();
    await expect(cv.getByRole("status")).toHaveText(tc.saved);
    const saved = await loadedPage(page, id);
    expect(saved.map((element) => element.kind)).toEqual(["tailored_cv", "tailored_documents"]);
    expect(saved[0]!.served).toEqual(elements[0]!.served);
  });

  test("Stop mid-writing: no document is kept, AI Usage records it stopped, and the action says « Arrêtée à » in light red", async ({ page }) => {
    const id = await openApplication(page, "Acme Industrie recrute son DAF. E2E_WRITING_SLOW=30000");
    const startedAt = new Date();

    const letter = await tab(page, td.coverLetter.title);
    await letter.getByRole("button", { name: td.coverLetter.draft }).click();
    await expect(letter.locator(".live-action-step")).toContainText(fr.aiActivity.steps.write);
    await letter.getByRole("button", { name: fr.aiActivity.stop, exact: true }).click();

    const stopped = letter.locator(".live-action-stopped");
    await expect(stopped).toHaveText(new RegExp(`^${fr.aiActivity.stoppedAt.replace("{{time}}", "\\d{2}:\\d{2}")} · \\d+ .*· \\d+(,\\d)? m?s$`));
    await expect(stopped).toHaveAttribute("role", "status");
    expect(await stopped.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(stopped));
    // Nothing kept: the Cover Letter is still to draft, and there is no Tailored Document row.
    await expect(letter.getByText(td.coverLetter.none)).toBeVisible();
    await expect(letter.getByRole("button", { name: td.coverLetter.draft })).toBeEnabled();
    expect(await query(`SELECT 1 FROM tailored_document WHERE application_id = $1`, [id])).toEqual([]);
    await expect
      .poll(async () => (await query(`SELECT 1 FROM ai_usage WHERE task = 'writing' AND at >= $1 AND reason = 'stopped'`, [startedAt])).length)
      .toBeGreaterThan(0);

    // The Tailored CV too: stopped, no proposal kept.
    const cv = await tab(page, tc.tailored);
    await cv.getByRole("button", { name: tc.propose, exact: true }).click();
    await expect(cv.locator(".live-action-step")).toContainText(fr.aiActivity.steps.write);
    await cv.getByRole("button", { name: fr.aiActivity.stop, exact: true }).click();
    await expect(cv.locator(".live-action-stopped")).toBeVisible();
    await expect(cv.getByText(tc.none)).toBeVisible();
    expect(await query(`SELECT 1 FROM tailored_cv WHERE application_id = $1 AND proposal IS NOT NULL`, [id])).toEqual([]);
    expect(await loadedPage(page, id)).toEqual([]);
  });
});

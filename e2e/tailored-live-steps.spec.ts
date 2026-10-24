import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #334: a Tailored CV proposed and a Cover Letter or Outreach Message drafted keep their Provenance (ADR-0034): the line
// under each says the model, tokens and time, and AI Activity's « Cette page » pane on `/candidatures/[id]/documents` lists
// each document with the model that wrote it, as soon as it is written. Each runs in its own request and shows its step live
// beside « Arrêter », and in AI Activity (the top bar's button, a stop icon beside it); a Stop, from the page or from AI
// Activity, aborts the AI call (AI Usage records it `stopped`), keeps no document, says « Arrêtée à 10:42 » in light red, and
// the pane shows the stopped action. The AI is faked inside the
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

const aiActivityButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });
const paneOf = (page: Page) => page.getByRole("complementary", { name: fr.aiActivity.label });
/** The pane's « Par élément » entry of an element kind. */
const elementOf = (page: Page, kind: "tailored_cv" | "tailored_documents") => paneOf(page).locator(".ai-activity-element").filter({ hasText: fr.aiActivity.kinds[kind] });

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

    // AI Activity's pane, without loading the page again: each document with the model that wrote it, its tokens and time.
    await expect(aiActivityButton(page)).toContainText(/\d+ modèles? · /);
    await aiActivityButton(page).click();
    for (const kind of ["tailored_cv", "tailored_documents"] as const) {
      await expect(elementOf(page, kind)).toContainText("Mistral");
      await expect(elementOf(page, kind)).not.toContainText(fr.aiActivity.modelNotRecorded);
    }
    const models = paneOf(page).locator(".ai-activity-section").filter({ has: page.getByRole("button", { name: fr.aiActivity.sections.models }) });
    await expect(models.locator(".ai-activity-row").filter({ hasText: "Mistral" })).toContainText(/\d · \d+(,\d)? s/);
    await expect(paneOf(page).locator(".ai-activity-total")).toContainText(/\d+(,\d)?k? tokens · \d+(,\d)? s/);
    // Done, each action left AI Activity's live sections: its document says it.
    await expect(paneOf(page).locator(".ai-activity-live")).toHaveCount(0);
    expect(await paneOf(page).innerHTML()).not.toContain(id);
    await paneOf(page).getByRole("button", { name: fr.aiActivity.close }).click();

    // Saved, the Tailored CV keeps the proposal's Provenance.
    await cv.page().getByRole("tab", { name: tc.tailored, exact: true }).click();
    await cv.getByRole("button", { name: tc.save, exact: true }).click();
    await expect(cv.getByRole("status")).toHaveText(tc.saved);
    await page.reload();
    await aiActivityButton(page).click();
    await expect(elementOf(page, "tailored_cv")).toHaveCount(1);
    await expect(elementOf(page, "tailored_cv")).toContainText("Mistral");
    await expect(elementOf(page, "tailored_documents")).toContainText("Mistral");
  });

  test("Stop mid-writing: no document is kept, AI Usage records it stopped, and the action says « Arrêtée à » in light red", async ({ page }) => {
    const id = await openApplication(page, "Acme Industrie recrute son DAF. E2E_WRITING_SLOW=30000");
    const startedAt = new Date();

    // AI Activity's pane open beside the page, the Cover Letter drafted then stopped from the page.
    await aiActivityButton(page).click();
    const letter = await tab(page, td.coverLetter.title);
    await letter.getByRole("button", { name: td.coverLetter.draft }).click();
    await expect(letter.locator(".live-action-step")).toContainText(fr.aiActivity.steps.write);
    const action = paneOf(page).locator(".ai-activity-live");
    await expect(action).toContainText(fr.aiActivity.kinds.tailored_documents);
    await expect(action.getByRole("list", { name: fr.aiActivity.live.steps })).toContainText(fr.aiActivity.steps.write);
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
    // The pane shows the stopped action, in light red, and no Cover Letter among the page's elements.
    await expect(action).toContainText(/Arrêtée à \d{2}:\d{2}/);
    expect(await action.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(action));
    await expect(elementOf(page, "tailored_documents")).toHaveCount(0);
    await paneOf(page).getByRole("button", { name: fr.aiActivity.close }).click();

    // The Tailored CV too, stopped from AI Activity's button: no proposal kept.
    const cv = await tab(page, tc.tailored);
    await cv.getByRole("button", { name: tc.propose, exact: true }).click();
    await expect(cv.locator(".live-action-step")).toContainText(fr.aiActivity.steps.write);
    await expect(aiActivityButton(page)).toContainText(fr.aiActivity.steps.write);
    await page.getByRole("banner").getByRole("button", { name: fr.aiActivity.live.stop.tailored_cv, exact: true }).click();
    await expect(cv.locator(".live-action-stopped")).toBeVisible();
    await expect(cv.getByText(tc.none)).toBeVisible();
    expect(await query(`SELECT 1 FROM tailored_cv WHERE application_id = $1 AND proposal IS NOT NULL`, [id])).toEqual([]);
    await aiActivityButton(page).click();
    await expect(paneOf(page).locator(".ai-activity-live").filter({ hasText: fr.aiActivity.kinds.tailored_cv })).toContainText(/Arrêtée à \d{2}:\d{2}/);
    await expect(paneOf(page).locator(".ai-activity-element").filter({ hasText: /CV adapté|Documents adaptés/ })).toHaveCount(0);
  });
});

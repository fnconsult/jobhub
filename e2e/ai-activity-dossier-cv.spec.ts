import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #335: a Company Dossier and the reading of an uploaded CV keep their Provenance, show their steps live (on their
// page beside « Arrêter », and in AI Activity) and can be stopped. A new dossier lists its Provenance sites in AI Activity,
// their links filtered (no person's profile, no query string); one built before shows « modèle non enregistré » with the
// sites its own source names. Stopped mid-dossier, what was finished is kept (the facts, the news not searched); stopped
// mid-reading, no Master CV Version is made. The register, the web search and the AI are faked inside the server
// (fake-company-sources.mjs: "E2E_SLOW_NEWS" makes the news search take 30 s; fake-mistral.mjs: "E2E_CV_SLOW" makes the
// CV reading take 30 s; "E2E_AI_DOWN" in the Job Offer makes Mistral answer 503, #367).
const expect = baseExpect.configure({ timeout: 15_000 });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const REGISTER_PAGE = "https://annuaire-entreprises.data.gouv.fr/entreprise/552100554";

const aiActivityButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });
const paneOf = (page: Page) => page.getByRole("complementary", { name: fr.aiActivity.label });
const elementOf = (page: Page, kind: string) => paneOf(page).locator(".ai-activity-element").filter({ hasText: fr.aiActivity.kinds[kind] });
const dossierOf = (page: Page) => page.getByRole("region", { name: fr.companyDossier.title });
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

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

/** The signed-in Candidate's Profile, made the first time. */
async function profileId(page: Page): Promise<string> {
  const [first] = (await (await page.request.get("/api/profiles")).json()) as { id: string }[];
  if (first) return first.id;
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  return (await profile.json()).id;
}

/** The signed-in Candidate's new Application on a Job Offer from `employer`; its id. */
async function newApplication(page: Page, employer: string): Promise<string> {
  const offer = await page.request.post("/api/job-offers", { data: { title: "DAF H/F", content: `(réf. ${unique()}) Poste de DAF.`, employer, location: "Lyon" }, headers: { origin } });
  expect(offer.status(), await offer.text()).toBe(200);
  const application = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: await profileId(page) }, headers: { origin } });
  expect(application.ok(), await application.text()).toBe(true);
  return (await application.json()).id;
}

/** Opens an Application's Company Dossier, once the page is hydrated. */
async function openDossier(page: Page, applicationId: string): Promise<Locator> {
  await page.goto(`/candidatures/${applicationId}/dossier`);
  await page.waitForLoadState("networkidle");
  return dossierOf(page);
}

async function dangerSurface(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const probe = document.createElement("div");
    probe.style.background = "var(--color-danger-surface)";
    element.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("AI Activity: Company Dossier and reading an uploaded CV (#335)", () => {
  test("a new dossier lists its sites with filtered links; one built before shows « non enregistré » with the sites its source names", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-dossier"));
    // The web search cites a LinkedIn profile and a script address besides the company's page: neither is a site.
    const dossier = await openDossier(page, await newApplication(page, "PersonLeak Inc"));

    await dossier.getByRole("button", { name: fr.companyDossier.build }).click();
    await expect(dossier.getByText(fr.companyDossier.reliability.less_reliable)).toBeVisible();

    await aiActivityButton(page).click();
    const built = elementOf(page, "company_dossier");
    await expect(built).toBeVisible();
    await expect(built).not.toContainText(fr.aiActivity.modelNotRecorded);
    const sources = paneOf(page).locator(".ai-activity-section").filter({ has: page.getByRole("button", { name: fr.aiActivity.sections.sources }) });
    await sources.getByRole("button", { name: "personleak.example" }).click();
    await expect(sources.getByRole("link", { name: /^personleak\.example\/about/ })).toHaveAttribute("href", "https://personleak.example/about");
    await sources.getByRole("button", { name: "news.example" }).click();
    await expect(sources.getByRole("link", { name: /^news\.example\/nouvelle-usine/ })).toHaveAttribute("href", "https://news.example/nouvelle-usine");
    await expect(paneOf(page)).not.toContainText("linkedin");
    await expect(paneOf(page)).not.toContainText("javascript");
    await expect(paneOf(page)).not.toContainText("news.example/depart");
    await expectNoAxeViolations(page, "aside.ai-activity-pane");

    // A dossier built before its Provenance was kept: « modèle non enregistré », the register's page as its site.
    const old = await newApplication(page, "Acme Industrie");
    await query(`INSERT INTO company_dossier (application_id, dossier) VALUES ($1, $2)`, [
      old,
      {
        source: "french_register",
        reliability: "official",
        employer: "Acme Industrie",
        builtAt: "2026-01-05T09:00:00.000Z",
        suggestedContactRoles: [],
        siren: "552100554",
        name: "ACME INDUSTRIE",
        financials: [],
        executiveRoles: [],
      },
    ]);
    await openDossier(page, old);
    await aiActivityButton(page).click();
    await expect(elementOf(page, "company_dossier")).toContainText(fr.aiActivity.modelNotRecorded);
    const oldSources = paneOf(page).locator(".ai-activity-section").filter({ has: page.getByRole("button", { name: fr.aiActivity.sections.sources }) });
    await oldSources.getByRole("button", { name: "annuaire-entreprises.data.gouv.fr" }).click();
    await expect(oldSources.getByRole("link", { name: /^annuaire-entreprises\.data\.gouv\.fr\/entreprise\/552100554/ })).toHaveAttribute("href", REGISTER_PAGE);
  });

  test("stopped mid-dossier from its page, the dossier keeps what was finished: its facts, its news not searched", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-dossier-stop"));
    const applicationId = await newApplication(page, "Globex E2E_SLOW_NEWS");
    const dossier = await openDossier(page, applicationId);
    const startedAt = new Date();

    await dossier.getByRole("button", { name: fr.companyDossier.build }).click();

    // The step under way, beside « Arrêter », on the page and on the closed AI Activity button.
    await expect(dossier.locator(".streamed-action-step")).toContainText(fr.aiActivity.steps.web_search);
    await expect(aiActivityButton(page)).toContainText(fr.aiActivity.steps.web_search);
    // The pane: the facts' web search ended (« 1 requête »), the news' under way.
    await aiActivityButton(page).click();
    const live = paneOf(page).locator(".ai-activity-live");
    await expect(live).toContainText(fr.aiActivity.kinds.company_dossier);
    await expect(live.getByRole("list", { name: fr.aiActivity.live.steps })).toContainText("1 requête");
    await paneOf(page).getByRole("button", { name: fr.aiActivity.close }).click();

    await dossier.getByRole("button", { name: fr.aiActivity.live.stop.company_dossier, exact: true }).click();

    await expect(dossier.getByText(/^Arrêté à \d{2}:\d{2} : ce qui était terminé est gardé\.$/)).toBeVisible();
    // Kept: the facts found; the news, never searched, to add by updating the dossier.
    await expect(dossier.getByText(fr.companyDossier.reliability.less_reliable)).toBeVisible();
    await expect(dossier.getByText("Robotique industrielle")).toBeVisible();
    await expect(dossier.getByText(fr.companyDossier.newsNotSearched)).toBeVisible();
    const [row] = await query<{ steps: { kind: string; task?: string; outcome: string }[] }>(`SELECT provenance->'steps' AS steps FROM company_dossier WHERE application_id = $1`, [applicationId]);
    expect(row!.steps.at(-1)).toMatchObject({ kind: "ai", task: "web_search", outcome: "stopped" });
    await expect.poll(async () => (await query(`SELECT 1 FROM ai_usage WHERE task = 'web_search' AND at >= $1 AND reason = 'stopped'`, [startedAt])).length).toBeGreaterThan(0);

    // AI Activity: the action stopped, in light red, in words; the dossier, with the sites of its finished parts.
    await aiActivityButton(page).click();
    const stopped = paneOf(page).locator(".ai-activity-live");
    await expect(stopped).toContainText(/Arrêtée à \d{2}:\d{2}/);
    expect(await stopped.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(stopped));
    await expect(elementOf(page, "company_dossier")).not.toContainText(fr.aiActivity.modelNotRecorded);
    await expect(paneOf(page).getByRole("button", { name: "globex-robotics.example" })).toBeVisible();
    await expectNoAxeViolations(page, "aside.ai-activity-pane");
  });

  test("a dossier whose provider fails shows its Failure Reason in AI Activity, in light red; a network cut, that it could not finish (#367)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-dossier-fail"));
    // Its offer analysis goes to Mistral, which answers 503 for "E2E_AI_DOWN".
    const dossier = await openDossier(page, await newApplication(page, "Globex E2E_AI_DOWN"));

    await dossier.getByRole("button", { name: fr.companyDossier.build }).click();
    await expect(dossier.getByRole("alert")).toHaveText(fr.companyDossier.unavailable);

    await aiActivityButton(page).click();
    const failed = paneOf(page).locator(".ai-activity-live");
    await expect(failed).toContainText(fr.aiActivity.kinds.company_dossier);
    await expect(failed).toContainText(/Échec à \d{2}:\d{2}/);
    await expect(failed.locator(".ai-activity-live-reason")).toHaveText(fr.failureReasons.provider_unavailable);
    expect(await failed.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(failed));
    // Never the provider's words nor its status.
    await expect(failed).not.toContainText("upstream");
    await expect(failed).not.toContainText("503");
    await expectNoAxeViolations(page, "aside.ai-activity-pane");
    await paneOf(page).getByRole("button", { name: fr.aiActivity.close }).click();

    // The network cut: no reason to give, « Elle n'a pas pu aboutir. ».
    await page.route("**/company-dossier", (route) => route.abort("internetdisconnected"));
    await dossier.getByRole("button", { name: fr.companyDossier.build }).click();
    await expect(dossier.getByRole("alert")).toBeVisible();
    await aiActivityButton(page).click();
    const cut = paneOf(page).locator(".ai-activity-live");
    await expect(cut).toHaveCount(1);
    await expect(cut.locator(".ai-activity-live-reason")).toHaveText(fr.aiActivity.live.unknownReason);
  });

  test("stopped mid-reading from the closed AI Activity button, an uploaded CV makes no Master CV Version", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-cv-stop"));
    await page.goto("/profils/nouveau");
    await page.waitForLoadState("networkidle");
    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv([...MARIE_DUPONT_CV, "Divers", "E2E_CV_SLOW"])) });
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();

    // The reading, live: on the page beside « Arrêter », and on the closed button with its stop icon.
    await expect(page.locator(".streamed-action-step")).toContainText(fr.aiActivity.steps.read);
    await expect(aiActivityButton(page)).toContainText(fr.aiActivity.steps.read);
    await page.getByRole("banner").getByRole("button", { name: fr.aiActivity.live.stop.cv_reading, exact: true }).click();

    await expect(page.getByText(/^Lecture arrêtée à \d{2}:\d{2} : rien n'a été lu ni enregistré\.$/)).toBeVisible();
    await expect(page.getByRole("heading", { name: fr.cvReview.title })).toHaveCount(0);
    await expect(page.getByRole("button", { name: fr.cvUpload.submit })).toBeEnabled();
    const profiles = await page.request.get("/api/profiles");
    expect(await profiles.json()).toEqual([]);
    await aiActivityButton(page).click();
    await expect(paneOf(page).locator(".ai-activity-live")).toContainText(fr.aiActivity.kinds.cv_reading);
    await expect(paneOf(page).locator(".ai-activity-live")).toContainText(/Arrêtée à \d{2}:\d{2}/);
  });

  test("a Master CV read from an uploaded CV lists what read it on its Profile's pages", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ai-activity-cv-read"));
    await page.goto("/profils/nouveau");
    await page.waitForLoadState("networkidle");
    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV)) });
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
    await page.getByRole("button", { name: fr.cvReview.save }).click();
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}/);

    await aiActivityButton(page).click();
    const read = elementOf(page, "master_cv");
    await expect(read).toBeVisible();
    await expect(read).not.toContainText(fr.aiActivity.modelNotRecorded);
    await expect(read).toContainText("Mistral");
    await expect(paneOf(page)).toContainText(fr.aiActivity.yourData);
  });
});

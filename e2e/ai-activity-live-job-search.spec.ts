import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #333: AI Activity live, for a Job Search. Started, then left for another page, the search keeps its Activity's glyph
// and its step under way on the top bar's button, a stop icon beside it, and shows under « En cours ailleurs » in the pane,
// with a link to its page and its own stop icon. Stopped from the closed button or from the pane, it is stopped (status
// `stopped`); failed, it is shown in light red, in words, with the step it failed in. Its steps come from the page's poll of
// its Run progress (ADR-0034). Driven through the built web app in a browser and the real worker (apps/worker), with
// Perplexity, Mistral and the job sites faked inside the worker (e2e/support/fake-job-sites.mjs), in volume mode with a
// delay on every page so the run lasts long enough to watch and stop.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-ai-activity-live-${tag}`);
/** While this file exists, the faked Perplexity fails every web search (e2e/support/fake-job-sites.mjs). */
const searchDownFlag = path.join(workDir, "perplexity-down");
const STEP_LABELS: string[] = Object.values(fr.aiActivity.steps);
/** All AI Activity's live region may say: an action's start and its end, never a step. */
const ANNOUNCEMENTS: string[] = Object.values(fr.aiActivity.live.announce as Record<string, Record<string, string>>).flatMap((byKind) => Object.values(byKind));

const masterCv = {
  fullName: "Séraphin Lampion",
  headline: "Directeur administratif et financier",
  email: "seraphin.lampion@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe d'assurances.",
  experience: [{ title: "Directeur financier", employer: "Mondass", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};
const searchCriteria = { targetRole: "Directeur administratif et financier", locations: ["Lyon"], contractTypes: ["cdi"] };

test.use({ baseURL: origin });

let worker: ChildProcess | undefined;
let workerOutput = "";
let profileId = "";
let scenario = 0;

/** A worker for a fresh set of postings, each page taking 2.5 s to answer. */
async function freshWorker() {
  await stopWorker();
  workerOutput = "";
  worker = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: path.resolve("apps/worker"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      AI_FAKE: "",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_WEB_SEARCH_PROVIDER: "perplexity",
      MISTRAL_API_KEY: "e2e-mistral-key",
      PERPLEXITY_API_KEY: "e2e-perplexity-key",
      JOB_DISCOVERY_BUDGET_JOB_OFFERS: "",
      JOB_DISCOVERY_BUDGET_EUR: "",
      JOB_DISCOVERY_BUDGET_SECONDS: "",
      E2E_DISCOVERY_TAG: `${tag}s${++scenario}`,
      E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
      E2E_SEARCH_DOWN_FLAG: searchDownFlag,
      E2E_DISCOVERY_VOLUME_COUNT: "4",
      E2E_DISCOVERY_VOLUME_KIND: "jsonld",
      E2E_DISCOVERY_VOLUME_DELAY_MS: "2500",
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
  await expect.poll(() => workerOutput, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
}

async function stopWorker() {
  if (worker && worker.exitCode === null) {
    const exited = new Promise((resolve) => worker!.once("exit", resolve));
    worker.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    if (worker.exitCode === null) worker.kill("SIGKILL");
  }
}

async function statusOf(jobSearchId: string): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ status: string }>("SELECT status FROM job_search WHERE id = $1", [jobSearchId]);
    return rows[0]!.status;
  } finally {
    await client.end();
  }
}

/** Clicks « Chercher des offres » for the Profile and returns the Job Search's id once on its page. */
async function startSearch(page: Page): Promise<string> {
  await page.goto(`/recherches?profil=${profileId}`);
  await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Leaves the Job Search's page for another, by the sidebar (the app is not loaded again). */
async function toApplications(page: Page) {
  await page.getByRole("navigation", { name: fr.sidebar.label }).getByRole("link", { name: fr.nav.applications }).click();
  await expect(page).toHaveURL(/\/candidatures$/);
}

const aiActivityButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });
const stopIconOf = (region: Locator) => region.getByRole("button", { name: fr.aiActivity.live.stop.job_search, exact: true });
const paneOf = (page: Page) => page.getByRole("complementary", { name: fr.aiActivity.label });
const announcerOf = (page: Page) => page.locator(".ai-activity-announcer");

/** Records everything AI Activity's live region says from now on, while the app is not loaded again. */
async function listenToAnnouncements(page: Page) {
  await page.evaluate(() => {
    const said: string[] = [];
    (window as unknown as { said: string[] }).said = said;
    const region = document.querySelector(".ai-activity-announcer")!;
    if (region.textContent) said.push(region.textContent);
    new MutationObserver(() => region.textContent && said.push(region.textContent)).observe(region, { childList: true, characterData: true, subtree: true });
  });
}
const announcements = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said);

/** The background a light-red action must have: --color-danger-surface. */
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

test.describe("AI Activity live: a Job Search (#333)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    mkdirSync(workDir, { recursive: true });
    // A context of its own: axe needs one (@axe-core/playwright).
    page = await (await browser.newContext({ baseURL: origin })).newPage();
    const email = newAddress("ai-activity-live-search");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;
  });

  test.afterAll(async () => {
    await page?.context().close();
    await stopWorker();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("on another page the button keeps its glyph and step, « En cours ailleurs » links to it; stopped from the closed button", async () => {
    await freshWorker();
    const jobSearchId = await startSearch(page);
    await listenToAnnouncements(page);
    await toApplications(page);

    // The closed button: the Activity's glyph and the step under way, a stop icon beside it.
    const button = aiActivityButton(page);
    await expect(button.locator("svg.activity-glyph")).toBeVisible({ timeout: 30_000 });
    await expect(button).toContainText(new RegExp(STEP_LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")), { timeout: 30_000 });
    const glyph = button.locator("svg.activity-glyph");
    expect(await glyph.getAttribute("aria-hidden")).toBe("true");
    // It breathes while the step runs.
    expect(await glyph.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);
    const banner = page.getByRole("banner");
    const stopIcon = stopIconOf(banner);
    await expect(stopIcon).toBeVisible();
    await expect(stopIcon).toHaveAttribute("title", fr.aiActivity.live.stop.job_search);
    // Start announced, never a step.
    await expect(announcerOf(page)).toHaveText(fr.aiActivity.live.announce.started.job_search);

    // The pane: « En cours ailleurs », the search with its steps, a link to its page and its stop icon.
    await button.click();
    const pane = paneOf(page);
    const elsewhere = pane.locator(".ai-activity-elsewhere");
    await expect(elsewhere.getByRole("heading", { name: fr.aiActivity.live.elsewhere })).toBeVisible();
    const search = elsewhere.locator(".ai-activity-live");
    await expect(search).toContainText(`${fr.aiActivity.kinds.job_search} · `);
    await expect(search).toContainText(/En cours · \d/);
    await expect(search.getByRole("list", { name: fr.aiActivity.live.steps }).getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
    await expect(search.getByRole("link", { name: fr.aiActivity.live.open.job_search })).toHaveAttribute("href", `/recherches/${jobSearchId}`);
    await expect(stopIconOf(search)).toBeVisible();
    await expectNoAxeViolations(page, "aside.ai-activity-pane");
    await pane.getByRole("button", { name: fr.aiActivity.close }).click();
    await expectNoAxeViolations(page, "header.topbar");

    // Stop from the closed button: the search is stopped.
    await stopIcon.click();
    await expect.poll(() => statusOf(jobSearchId), { timeout: 90_000, message: workerOutput }).toBe("stopped");
    await expect(stopIconOf(banner)).toHaveCount(0, { timeout: 10_000 });
    await button.click();
    const stopped = paneOf(page).locator(".ai-activity-live");
    await expect(stopped).toContainText(/Arrêtée à \d{2}:\d{2}/);
    expect(await stopped.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(stopped));
    await expect(stopIconOf(stopped)).toHaveCount(0);
    // Its start was said, never a step.
    const said = await announcements(page);
    expect(said).toContain(fr.aiActivity.live.announce.started.job_search);
    for (const text of said) expect(ANNOUNCEMENTS).toContain(text);
  });

  test("stopped from the pane, on its own page; under reduced motion the glyph holds still", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    try {
      await freshWorker();
      const jobSearchId = await startSearch(page);
      const button = aiActivityButton(page);
      const glyph = button.locator("svg.activity-glyph");
      await expect(glyph).toBeVisible({ timeout: 30_000 });
      expect(await glyph.evaluate((element) => element.getAnimations().length)).toBe(0);

      await button.click();
      // On its own page it is this page's action, not « En cours ailleurs ».
      const pane = paneOf(page);
      await expect(pane.locator(".ai-activity-elsewhere")).toHaveCount(0);
      const search = pane.locator(".ai-activity-live");
      await expect(search).toBeVisible();
      await expect(search.getByRole("list", { name: fr.aiActivity.live.steps }).locator("svg.activity-glyph").first()).toBeVisible({ timeout: 30_000 });
      expect(await search.evaluate((element) => [...element.querySelectorAll("svg.activity-glyph")].flatMap((svg) => svg.getAnimations()).length)).toBe(0);

      await stopIconOf(search).click();
      await expect(search).toContainText(fr.aiActivity.live.stopping);
      await expect.poll(() => statusOf(jobSearchId), { timeout: 90_000, message: workerOutput }).toBe("stopped");
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }
  });

  test("failed, it is shown in light red, in words, with the step it failed in", async () => {
    await freshWorker();
    const jobSearchId = await startSearch(page);
    await toApplications(page);
    const button = aiActivityButton(page);
    await button.click();
    const search = paneOf(page).locator(".ai-activity-live");
    // Once a posting is read, Perplexity goes down: the run's next web search fails.
    await expect(search.getByRole("listitem").filter({ hasText: fr.aiActivity.steps.read }).first()).toBeVisible({ timeout: 60_000 });
    writeFileSync(searchDownFlag, "down");
    try {
      await expect.poll(() => statusOf(jobSearchId), { timeout: 90_000, message: workerOutput }).toBe("failed");
      await expect(search).toContainText(/Échec à \d{2}:\d{2}, pendant l'étape « Recherche web »/, { timeout: 10_000 });
      await expect(search).toContainText(fr.jobSearch.failureReasons.discovery_failed);
      expect(await search.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(search));
      await expectNoAxeViolations(page, "aside.ai-activity-pane");
    } finally {
      rmSync(searchDownFlag, { force: true });
    }
  });
});

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { activityOf, activityUnderWayOf, openActivity } from "./support/conversation";
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
      // One query per call (#398 batches up to 5): the run has a next web search, after the first one's postings are read.
      PERPLEXITY_QUERIES_PER_CALL: "1",
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

/** Clicks « Lancer une recherche », Recherches d'offres' suggestion (#606), and returns the Job Search's id once on its page. */
async function startSearch(page: Page): Promise<string> {
  await page.goto("/recherches");
  await page.getByRole("navigation", { name: fr.quickActions.label }).getByRole("button", { name: fr.jobSearchesMenu.start, exact: true }).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Leaves the Job Search's page for another, by the sidebar (the app is not loaded again). */
async function toApplications(page: Page) {
  await page.getByRole("navigation", { name: fr.sidebar.label }).getByRole("link", { name: fr.nav.applications }).click();
  await expect(page).toHaveURL(/\/candidatures$/);
}

const stopIconOf = (region: Locator) => region.getByRole("button", { name: fr.aiActivity.live.stop.job_search, exact: true });
/** Where the page's AI Activity shows: an object's Fiche, in its Activity group, or the Activité column. */
const paneOf = (page: Page) => activityOf(page);
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

/** The glyph's strokes as drawn: while its step runs they move, drawn from JavaScript (ActivityGlyph); still, they stay. */
const strokesOf = (glyph: Locator) => glyph.evaluate((svg) => [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d") ?? "").join("|"));

/** « Activité »'s live glyph in the Top Bar: the button's on a wider screen, the compact Top Bar's on a phone (#897). */
const BUTTON_GLYPH = {
  wide: "header .topbar-activity .activity-glyph[data-live]",
  compact: "header .topbar-compact-actions:not(.topbar-first-paint) .activity-glyph[data-live]",
} as const;

/**
 * Samples, every 50 ms in the page, « Activité »'s glyph in the Top Bar and the glyph of « En ce moment »'s action under
 * way: their Activity, whether the button's moves (its strokes drawn from JavaScript) and whether it stays the same
 * element (it morphs into the next step rather than being drawn anew).
 */
async function sampleGlyphs(page: Page, button: string) {
  await page.evaluate((selector) => {
    const state = { samples: [] as Array<{ button: string | null; now: string | null; moving: boolean; same: boolean }>, first: null as Element | null };
    (window as unknown as { glyphs: typeof state }).glyphs = state;
    setInterval(() => {
      const glyph = document.querySelector(selector);
      const now = document.querySelector('.en-ce-moment-action:is([data-status="running"], [data-status="stopping"]) > .activity-glyph');
      if (!glyph && !now) return;
      state.first ??= glyph;
      state.samples.push({
        button: glyph?.getAttribute("data-activity") ?? null,
        now: now?.getAttribute("data-activity") ?? null,
        moving: Boolean(glyph?.querySelector("path[opacity]")),
        same: glyph === state.first,
      });
    }, 50);
  }, button);
}
const glyphSamples = (page: Page) =>
  page.evaluate(() => (window as unknown as { glyphs: { samples: Array<{ button: string | null; now: string | null; moving: boolean; same: boolean }> } }).glyphs.samples);

/**
 * While a Job Search runs on its page, Activity shown: « Activité »'s glyph in the Top Bar is always « En ce moment »'s,
 * the step under way (the last one between two steps, never the brain of before the first), live, moving, and one
 * element that morphs from step to step; it follows at least two of the run's Activities. Then the search is stopped.
 */
async function expectButtonGlyphFollowsTheRun(page: Page, button: string) {
  await freshWorker();
  const jobSearchId = await startSearch(page);
  await openActivity(page);
  await expect(page.locator(button)).toBeVisible({ timeout: 30_000 });
  await sampleGlyphs(page, button);
  await expect
    .poll(async () => new Set((await glyphSamples(page)).map((sample) => sample.button).filter(Boolean)).size, { timeout: 90_000, message: workerOutput })
    .toBeGreaterThanOrEqual(2);
  const samples = await glyphSamples(page);
  const both = samples.filter((sample) => sample.button && sample.now);
  expect(both.length).toBeGreaterThan(20);
  expect(both.filter((sample) => sample.button !== sample.now)).toEqual([]);
  expect(samples.every((sample) => sample.same)).toBe(true);
  expect(samples.filter((sample) => sample.button && !sample.moving).length).toBeLessThan(samples.length / 10);

  await stopIconOf(paneOf(page).locator(".ai-activity-live")).click();
  await expect.poll(() => statusOf(jobSearchId), { timeout: 90_000, message: workerOutput }).toBe("stopped");
  // Nothing runs: the tasks icon, still.
  await expect(page.locator(button)).toHaveCount(0, { timeout: 10_000 });
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
  });

  test.afterAll(async () => {
    await page?.context().close();
    await stopWorker();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("on another page « Activité » keeps its glyph live, « En cours ailleurs » links to it; stopped from there", async () => {
    await freshWorker();
    const jobSearchId = await startSearch(page);
    await listenToAnnouncements(page);
    await toApplications(page);

    // The closed button: the Activity's glyph, live (#603). It moves while the step runs: its strokes are drawn anew.
    const glyph = activityUnderWayOf(page);
    await expect(glyph).toBeVisible({ timeout: 30_000 });
    expect(await glyph.getAttribute("aria-hidden")).toBe("true");
    const drawn = await strokesOf(glyph);
    await expect.poll(() => strokesOf(glyph), { timeout: 5_000 }).not.toBe(drawn);
    // Start announced, never a step.
    await expect(announcerOf(page)).toHaveText(fr.aiActivity.live.announce.started.job_search);
    await expectNoAxeViolations(page, "header.topbar");

    // « En ce moment » (#806): « En cours ailleurs », the search with its step under way in words, the steps it finished and
    // its time so far, a link to its page and its stop icon.
    await openActivity(page);
    const pane = paneOf(page);
    const elsewhere = pane.locator(".ai-activity-elsewhere");
    await expect(elsewhere.getByRole("heading", { name: fr.aiActivity.live.elsewhere })).toBeVisible();
    const search = elsewhere.locator(".ai-activity-live");
    await expect(search).toContainText(`${fr.aiActivity.kinds.job_search} · `);
    await expect(search).toContainText(/\d+ étapes? finies? · \d/);
    await expect(search.locator(".ai-activity-live-status")).toHaveText(new RegExp(`^(${STEP_LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`), { timeout: 30_000 });
    await expect(search.getByRole("link", { name: fr.aiActivity.live.open.job_search })).toHaveAttribute("href", `/recherches/${jobSearchId}`);
    const stopIcon = stopIconOf(search);
    await expect(stopIcon).toBeVisible();
    await expect(stopIcon).toHaveAttribute("title", fr.aiActivity.live.stop.job_search);
    await expectNoAxeViolations(page, ".fiche-activity");

    // Stopped from there: the search is stopped.
    await stopIcon.click();
    await expect.poll(() => statusOf(jobSearchId), { timeout: 90_000, message: workerOutput }).toBe("stopped");
    await expect(glyph).toHaveCount(0, { timeout: 10_000 });
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
      const glyph = activityUnderWayOf(page);
      await expect(glyph).toBeVisible({ timeout: 30_000 });
      expect(await glyph.evaluate((element) => element.getAnimations().length)).toBe(0);
      // Its still drawing: React's paths, none drawn from JavaScript (those carry an opacity), even a while later.
      expect(await strokesOf(glyph)).not.toMatch(/^\|*$/);
      await page.waitForTimeout(800);
      expect(await glyph.evaluate((svg) => svg.querySelectorAll("path[opacity], path:not([d])").length)).toBe(0);

      await openActivity(page);
      // On its own page it is this page's action, not « En cours ailleurs ».
      const pane = paneOf(page);
      await expect(pane.locator(".ai-activity-elsewhere")).toHaveCount(0);
      const search = pane.locator(".ai-activity-live");
      await expect(search).toBeVisible();
      await expect(search.locator("svg.activity-glyph")).toBeVisible({ timeout: 30_000 });
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
    await openActivity(page);
    const search = paneOf(page).locator(".ai-activity-live");
    // Once a posting is being read, Perplexity goes down: the run's next web search fails.
    await expect(search.locator(".ai-activity-live-status")).toHaveText(fr.aiActivity.steps.read, { timeout: 60_000 });
    writeFileSync(searchDownFlag, "down");
    try {
      await expect.poll(() => statusOf(jobSearchId), { timeout: 90_000, message: workerOutput }).toBe("failed");
      await expect(search).toContainText(/Échec à \d{2}:\d{2}, pendant l'étape « Recherche web »/, { timeout: 10_000 });
      await expect(search).toContainText(fr.jobSearch.failureReasons.discovery_failed);
      expect(await search.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await dangerSurface(search));
      await expectNoAxeViolations(page, ".fiche-activity");
    } finally {
      rmSync(searchDownFlag, { force: true });
    }
  });

  test("at 1280px, « Activité »'s glyph is the step « En ce moment » shows, live, morphing from one step to the next", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expectButtonGlyphFollowsTheRun(page, BUTTON_GLYPH.wide);
  });

  test("at 390px, the compact Top Bar's « Activité » is the step « En ce moment » shows, live, morphing from one step to the next (#897)", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await expectButtonGlyphFollowsTheRun(page, BUTTON_GLYPH.compact);
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });

  test("done, it leaves « En ce moment » (#806); its end is its notification's to say, never a step", async () => {
    await freshWorker();
    const jobSearchId = await startSearch(page);
    await toApplications(page);
    await listenToAnnouncements(page);
    await openActivity(page);
    const search = paneOf(page).locator(".ai-activity-live");
    await expect(search).toBeVisible({ timeout: 30_000 });

    await expect.poll(() => statusOf(jobSearchId), { timeout: 120_000, message: workerOutput }).toBe("done");
    await expect(search).toHaveCount(0, { timeout: 10_000 });
    await expect(paneOf(page).locator(".ai-activity-elsewhere")).toHaveCount(0);
    await expect(paneOf(page).getByRole("region", { name: fr.aiActivity.live.now })).toContainText(fr.aiActivity.live.nothing);
    // On another page than its own, its end is its notification's to say, not AI Activity's; never a step.
    const said = await announcements(page);
    expect(said).not.toContain(fr.aiActivity.live.announce.done.job_search);
    for (const text of said) expect(ANNOUNCEMENTS).toContain(text);
    await expectNoAxeViolations(page, ".fiche-activity");
  });
});

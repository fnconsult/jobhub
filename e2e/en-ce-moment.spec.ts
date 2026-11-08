import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { activityOf, conversationOf, openActivity } from "./support/conversation";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";
import { showInTheme, THEMES } from "./support/theme";

// Issue #806 (ADR-0086): « En ce moment », at the top of Activity under the Context bar. A Job Search launched, then a
// question to the AI Coach on its page: the block shows both, each with its step under way, the steps it finished and its
// time so far; the search is stopped from the block. An action of another page shows under « En cours ailleurs », with a
// link to its page. Driven through the built web app and the real worker (apps/worker), the job sites, Perplexity and
// Mistral faked inside the worker (e2e/support/fake-job-sites.mjs), each page slow to answer so the run lasts; the AI
// Coach's Mistral faked inside the web server (fake-mistral.mjs), "E2E_COACH_SLOW=<ms>" keeping its reply on its way.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-en-ce-moment-${tag}`);
const STEP_LABELS: string[] = Object.values(fr.aiActivity.steps);
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Its step under way, in words: one of the Step labels, or « Démarrage » before the first. */
const A_STEP = new RegExp(`^(${[...STEP_LABELS, fr.aiActivity.live.starting].map(escaped).join("|")})$`);
/** « 2 étapes finies · 12 s »: the steps an action finished, and its time so far. */
const FINISHED_SO_FAR = /\d+ étapes? finies? · \d/;

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

/** A worker for a set of postings, each page taking 2.5 s to answer. */
async function startWorker() {
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
      PERPLEXITY_QUERIES_PER_CALL: "1",
      JOB_DISCOVERY_BUDGET_JOB_OFFERS: "",
      JOB_DISCOVERY_BUDGET_EUR: "",
      JOB_DISCOVERY_BUDGET_SECONDS: "",
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
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

/** Asks the AI Coach in the page's own conversation, the reply left on its way. */
async function ask(page: Page, message: string) {
  const conversation = conversationOf(page);
  await conversation.getByLabel(fr.coachPanel.messageLabel).fill(message);
  await conversation.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
  await expect(conversation.getByRole("button", { name: fr.coachPanel.stop, exact: true })).toBeVisible();
}

/** « En ce moment », at the top of the page's Activity (the Fiche's Activity group, or the Activité column). */
const enCeMomentOf = (page: Page) => activityOf(page).getByRole("region", { name: fr.aiActivity.live.now, exact: true });
const actionOf = (region: Locator, kind: "job_search" | "coach_reply") => region.locator(".ai-activity-live").filter({ hasText: fr.aiActivity.kinds[kind] });

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

/** axe on `selector` in the light theme then the dark one, its colour contrast included (ADR-0009); left in light. */
async function expectNoAxeViolations(page: Page, selector: string) {
  for (const theme of THEMES) {
    await showInTheme(page, theme);
    const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ theme, id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
  }
  await showInTheme(page, "light");
}

test.describe("« En ce moment » (#806, ADR-0086)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    mkdirSync(workDir, { recursive: true });
    page = await (await browser.newContext({ baseURL: origin })).newPage();
    const email = newAddress("en-ce-moment");
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

  test("a Job Search launched, then a question to the coach: « En ce moment » shows both, each with its step; the search is stopped from the block", async () => {
    await startWorker();
    const jobSearchId = await startSearch(page);
    await openActivity(page);
    const block = enCeMomentOf(page);
    // Under the Context bar, at the top of Activity.
    await expect(block.getByRole("heading", { name: fr.aiActivity.live.now })).toBeVisible();

    const search = actionOf(block, "job_search");
    await expect(search.locator(".ai-activity-live-status")).toHaveText(A_STEP, { timeout: 30_000 });

    await ask(page, "Que penses-tu de cette recherche ? E2E_COACH_SLOW=30000");
    const reply = actionOf(block, "coach_reply");
    await expect(reply).toBeVisible();

    // Both on this page, each with its live glyph, its step in words, the steps it finished, its time so far, its stop icon.
    await expect(block.locator(".ai-activity-elsewhere")).toHaveCount(0);
    await expect(block.getByText(fr.aiActivity.live.nothing)).toHaveCount(0);
    for (const [action, kind] of [
      [search, "job_search"],
      [reply, "coach_reply"],
    ] as const) {
      await expect(action.locator(".ai-activity-live-status")).toHaveText(A_STEP);
      await expect(action).toContainText(FINISHED_SO_FAR);
      await expect(action.locator("svg.activity-glyph[data-live]")).toHaveCount(1);
      await expect(action.getByRole("button", { name: fr.aiActivity.live.stop[kind], exact: true })).toBeVisible();
    }
    await expect(reply.locator(".ai-activity-live-status")).toHaveText(fr.aiActivity.steps.think_write);
    await expectNoAxeViolations(page, ".en-ce-moment");

    // The search stopped from the block: « Arrêt en cours… », then the worker stops it; the reply runs on.
    await search.getByRole("button", { name: fr.aiActivity.live.stop.job_search, exact: true }).click();
    await expect(search.locator(".ai-activity-live-status")).toHaveText(fr.aiActivity.live.stopping);
    await expect.poll(() => statusOf(jobSearchId), { timeout: 90_000, message: workerOutput }).toBe("stopped");
    // On its own page, the page refreshes itself and shows it stopped: AI Activity's history takes it back (« Arrêtée à
    // 10:42 » on its row, #808), and the block lets it go (#806: « jusqu'à ce que l'historique la reprenne »). How long
    // it shows in light red in the block meanwhile is the refresh's timing, so it is not asserted here; the reply's is below.
    const searchInHistory = activityOf(page).locator(".activity-entry").filter({ has: page.locator(".activity-entry-title").getByText(fr.aiActivity.kinds.job_search, { exact: true }) });
    await expect(searchInHistory).toContainText(/Arrêtée à \d{2}:\d{2}/, { timeout: 15_000 });
    await expect(search).toHaveCount(0);
    await expect(reply.getByRole("button", { name: fr.aiActivity.live.stop.coach_reply, exact: true })).toBeVisible();
    await expectNoAxeViolations(page, ".en-ce-moment");

    // The reply stopped too, from the block: it stays, in light red, in words, with no stop icon left.
    await reply.getByRole("button", { name: fr.aiActivity.live.stop.coach_reply, exact: true }).click();
    await expect(reply).toContainText(/Arrêtée à \d{2}:\d{2}/);
    await expect(reply).toHaveAttribute("data-status", "stopped");
    const lightRed = await dangerSurface(reply);
    await expect.poll(() => reply.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(lightRed);
    await expect(reply.getByRole("button")).toHaveCount(0);
    await expectNoAxeViolations(page, ".en-ce-moment");
  });

  test("an action of another page shows under « En cours ailleurs », with a link to its page", async () => {
    await page.goto("/candidatures");
    await ask(page, "Comment relancer une candidature ? E2E_COACH_SLOW=30000");

    await page.getByRole("navigation", { name: fr.sidebar.label }).getByRole("link", { name: fr.sidebar.agenda }).click();
    await expect(page).toHaveURL(/\/agenda/);
    await openActivity(page);
    const block = enCeMomentOf(page);
    // Nothing on the Agenda itself.
    await expect(block.getByText(fr.aiActivity.live.nothing)).toBeVisible();
    const elsewhere = block.getByRole("region", { name: fr.aiActivity.live.elsewhere });
    const reply = actionOf(elsewhere, "coach_reply");
    await expect(reply.locator(".ai-activity-live-status")).toHaveText(A_STEP);
    await expect(reply.getByRole("link", { name: fr.aiActivity.live.open.coach_reply })).toHaveAttribute("href", "/candidatures");
    await expectNoAxeViolations(page, ".en-ce-moment");

    // Followed, the link leads back to its page, where it is this page's action.
    await reply.getByRole("link", { name: fr.aiActivity.live.open.coach_reply }).click();
    await expect(page).toHaveURL(/\/candidatures$/);
    await openActivity(page);
    const here = enCeMomentOf(page);
    await expect(here.locator(".ai-activity-elsewhere")).toHaveCount(0);
    await actionOf(here, "coach_reply").getByRole("button", { name: fr.aiActivity.live.stop.coach_reply, exact: true }).click();
    await expect(actionOf(here, "coach_reply")).toContainText(/Arrêtée à \d{2}:\d{2}/);
  });
});

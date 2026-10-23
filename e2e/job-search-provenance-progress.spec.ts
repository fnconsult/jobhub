import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { jobSearchPage } from "../apps/web/src/ai-activity";
import { createJobOffers } from "../apps/web/src/job-offers";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #330: a Job Search shows its steps while it runs, and keeps its Provenance (ADR-0034). Driven through
// the public entry points: the built web app in a browser (the « Chercher des offres » button, then the
// pages' own polling of GET /api/job-searches/notifications), and the real worker (apps/worker, `tsx src/main.ts`)
// running Job discovery on the same database. Perplexity, Mistral and the job sites are faked inside the worker
// by e2e/support/fake-job-sites.mjs, in volume mode with a delay on every page so the run lasts a few seconds.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-search-progress-${tag}`);
/** While this file exists, the faked Perplexity fails every web search (e2e/support/fake-job-sites.mjs). */
const searchDownFlag = path.join(workDir, "perplexity-down");

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice administrative et financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};
const searchCriteria = { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] };

type Step = { kind: string; activity: string; tool?: string; task?: string; rule?: string; ms: number; at: string; outcome: string; count: number };
type Event = { type: "step_started" | "step_ended"; id: number; step: Step };
type Notifications = { notifications: unknown[]; searching: boolean; running: { jobSearchId: string; profile: { id: string; name: string }; startedAt: string; steps: Event[] }[] };
type StoredProvenance = { v: number; steps: Step[]; sites: { kind: string; domain?: string }[]; startedAt: string; wallMs: number };
type Row = { status: string; failure: string | null; provenance: StoredProvenance | null; progress: Event[] | null; job_offer_ids: string[]; text: string | null };

test.use({ baseURL: origin });

let worker: ChildProcess | undefined;
let workerOutput = "";
let candidateId = "";
let profileId = "";

let scenario = 0;

/**
 * A worker for a fresh set of postings: the faked job sites tag every posting, and a Job Search finding only
 * Job Offers already known runs in no time, so each scenario starts a worker with a tag of its own.
 */
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
      // Four postings, each page taking 2.5 s to answer: the run lasts long enough to watch.
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

const withClient = async <T>(use: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
};

const rowOf = (jobSearchId: string) =>
  withClient(async (client) => {
    const { rows } = await client.query("SELECT status, failure, provenance, progress, job_offer_ids, provenance::text AS text FROM job_search WHERE id = $1", [jobSearchId]);
    return rows[0] as Row;
  });

const notificationsOf = async (page: Page): Promise<Notifications> => {
  const response = await page.request.get("/api/job-searches/notifications");
  expect(response.status()).toBe(200);
  return response.json();
};

/** Starts a worker with fresh postings, then clicks « Chercher des offres » for the Profile and returns the Job Search's id once on its page. */
async function startSearch(page: Page): Promise<string> {
  await freshWorker();
  await page.goto(`/recherches?profil=${profileId}`);
  await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/**
 * Asks the notifications as the pages do, every 100 ms, until the Job Search is no longer searching. For each step
 * seen ended, the delay between its end (its start plus its duration, the worker's own clock, the same machine)
 * and the first poll that returned it.
 */
async function watchUntilOver(page: Page, jobSearchId: string, timeoutMs = 120_000) {
  const firstSeen = new Map<number, { delayMs: number; seenAt: number; step: Step }>();
  const searchingSamples: Notifications[] = [];
  const begun = Date.now();
  let overAt = 0;
  while (Date.now() - begun < timeoutMs) {
    const state = await notificationsOf(page);
    const now = Date.now();
    const running = state.running.find((search) => search.jobSearchId === jobSearchId);
    if (!running) {
      overAt = now;
      expect(state.searching, "nothing else is searching").toBe(false);
      break;
    }
    searchingSamples.push(state);
    for (const event of running.steps) {
      if (event.type === "step_ended" && !firstSeen.has(event.id)) firstSeen.set(event.id, { delayMs: now - (Date.parse(event.step.at) + event.step.ms), seenAt: now, step: event.step });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(overAt, `the Job Search is over within ${timeoutMs} ms\n${workerOutput}`).toBeGreaterThan(0);
  return { firstSeen, searchingSamples, overAt };
}

/** Counts the page's own requests to the notifications from now on. */
function countNotificationRequests(page: Page) {
  const state = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/job-searches/notifications") state.count += 1;
  });
  return state;
}

test.describe("A Job Search shows its steps while it runs and keeps its Provenance (#330)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    mkdirSync(workDir, { recursive: true });
    page = await browser.newPage({ baseURL: origin });
    const email = newAddress("search-progress");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;
  });

  test.afterAll(async () => {
    await page?.close();
    await stopWorker();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("a running search exposes each step within 2 s of its end, over the notifications every page polls", async () => {
    const jobSearchId = await startSearch(page);
    const { firstSeen, searchingSamples, overAt } = await watchUntilOver(page, jobSearchId);

    // While it searched, the notifications said so, with this search and its profile.
    expect(searchingSamples.length).toBeGreaterThan(5);
    for (const state of searchingSamples) expect(state.searching).toBe(true);
    const first = searchingSamples[0]!.running.find((search) => search.jobSearchId === jobSearchId)!;
    expect(first.profile.id).toBe(profileId);
    expect(Number.isNaN(Date.parse(first.startedAt))).toBe(false);

    // Steps came while it ran, not all at once at the end: the first ended step was seen well before the search was over.
    expect(firstSeen.size, workerOutput).toBeGreaterThanOrEqual(3);
    const earliest = Math.min(...[...firstSeen.values()].map((seen) => seen.seenAt));
    expect(overAt - earliest, "the first ended step was visible while the search still ran").toBeGreaterThan(2000);
    // Each ended step was exposed within 2 s of its end.
    for (const [id, { delayMs, step }] of firstSeen) expect(delayMs, `step ${id} (${step.kind} ${step.activity}) exposed ${delayMs} ms after its end`).toBeLessThan(2000);
    // The steps tell the run's kinds of work: the web search and the page reads.
    const activities = [...firstSeen.values()].map(({ step }) => step.activity);
    expect(activities).toContain("web_search");
    expect(activities).toContain("read");
  });

  test("the finished search has its Provenance, folded with its wall-clock time, and its Job Offers have theirs", async () => {
    const jobSearchId = await startSearch(page);
    await watchUntilOver(page, jobSearchId);
    const row = await rowOf(jobSearchId);
    expect(row.status).toBe("done");
    const provenance = row.provenance!;
    expect(provenance, "the finished search has a Provenance").not.toBeNull();
    expect(provenance.wallMs).toBeGreaterThan(5000);
    expect(Number.isNaN(Date.parse(provenance.startedAt))).toBe(false);

    // The run: the job titles (an AI step), the web search, the page reads, the Match Scores (rules).
    const has = (predicate: (step: Step) => boolean) => provenance.steps.some(predicate);
    expect(has((s) => s.kind === "ai" && s.activity !== "web_search"), JSON.stringify(provenance.steps)).toBe(true);
    expect(has((s) => s.activity === "web_search")).toBe(true);
    expect(has((s) => s.kind === "tool" && s.activity === "read")).toBe(true);
    expect(has((s) => s.kind === "rules" && s.rule === "match_score")).toBe(true);
    // Folded: the four page reads of one site are one step with a count, not four steps.
    const reads = provenance.steps.filter((s) => s.kind === "tool" && s.activity === "read");
    expect(reads.reduce((sum, s) => sum + s.count, 0)).toBeGreaterThanOrEqual(4);
    expect(reads.length).toBeLessThan(4);
    expect(provenance.sites.map((site) => site.domain)).toContain("volume-e2e.example");

    // No Candidate id, Profile id or name in it.
    for (const personal of [candidateId, profileId, "Castafiore", "Bérénice", "berenice"]) expect(row.text, `"${personal}" in a Job Search's Provenance`).not.toContain(personal);

    // What AI Activity reads for the Job Search's page: the run, then each Job Offer with its own Provenance.
    expect(row.job_offer_ids.length).toBeGreaterThanOrEqual(1);
    const pool = new pg.Pool({ connectionString: databaseUrl });
    try {
      const elements = await jobSearchPage(
        { jobOffers: createJobOffers(pool), coachReplies: { repliesAbout: async () => [] } },
        [{ startedAt: new Date(), provenance, results: row.job_offer_ids.map((offerId) => ({ jobOffer: { id: offerId, title: "Offer" } })) }],
      );
      expect(elements[0]!.kind).toBe("job_search");
      expect(elements[0]!.served, "the search's Provenance is read").not.toBeNull();
      expect(elements.length).toBe(1 + row.job_offer_ids.length);
      for (const element of elements.slice(1)) {
        expect(element.kind).toBe("job_offer");
        expect(element.served, "each Job Offer keeps its own Provenance (#329)").not.toBeNull();
      }
    } finally {
      await pool.end();
    }
  });

  test("polling runs only while searching: the pages ask every 1.5 s, then no more once the search is done, with its progress cleared", async () => {
    const jobSearchId = await startSearch(page);
    // Another page: the Job Search's own page leaves its notification out.
    await page.goto("/abonnement");
    const requests = countNotificationRequests(page);
    const before = requests.count;
    await page.waitForTimeout(6000);
    const whileSearching = requests.count - before;
    // About 4 asks in 6 s at 1.5 s: more than a poll every 5 s would make, fewer than a busy loop.
    expect(whileSearching, "asks in 6 s while searching").toBeGreaterThanOrEqual(3);
    expect(whileSearching).toBeLessThanOrEqual(6);

    const { overAt } = await watchUntilOver(page, jobSearchId);
    expect(overAt).toBeGreaterThan(0);
    // Once over: nothing searching, nothing running, the progress cleared.
    const state = await notificationsOf(page);
    expect(state.searching).toBe(false);
    expect(state.running).toEqual([]);
    expect((await rowOf(jobSearchId)).progress).toBeNull();
    // The page's last ask sees it over; after that, none: the interval is gone.
    await page.waitForTimeout(3500);
    const settled = requests.count;
    await page.waitForTimeout(6000);
    expect(requests.count, "asks in 6 s once the search is over").toBe(settled);
  });

  test("a failed search keeps its Provenance, clears its progress and stops the polling", async () => {
    writeFileSync(searchDownFlag, "down");
    const jobSearchId = await startSearch(page);
    await page.goto("/abonnement");
    const requests = countNotificationRequests(page);
    await watchUntilOver(page, jobSearchId);
    const row = await rowOf(jobSearchId);
    expect(row.status, workerOutput).toBe("failed");
    expect(row.progress).toBeNull();
    expect(row.provenance, "a failed search keeps the run it made").not.toBeNull();
    expect(row.provenance!.wallMs).toBeGreaterThanOrEqual(0);
    expect(row.provenance!.steps.length).toBeGreaterThan(0);
    const state = await notificationsOf(page);
    expect(state.searching).toBe(false);
    expect(state.running).toEqual([]);
    await page.waitForTimeout(3500);
    const settled = requests.count;
    await page.waitForTimeout(5000);
    expect(requests.count, "asks in 5 s once the search failed").toBe(settled);
    rmSync(searchDownFlag, { force: true });
  });

  test("a search that timed out has its progress cleared, and nothing is running", async () => {
    const jobSearchId = await startSearch(page);
    // Wait for its first live steps, so there is progress to clear.
    await expect
      .poll(async () => (await notificationsOf(page)).running.find((search) => search.jobSearchId === jobSearchId)?.steps.length ?? 0, { timeout: 60_000 })
      .toBeGreaterThan(0);
    expect((await rowOf(jobSearchId)).progress).not.toBeNull();
    // It has been searching for over 15 minutes, the worker never answered.
    await withClient((client) => client.query("UPDATE job_search SET started_at = now() - interval '20 minutes' WHERE id = $1", [jobSearchId]));
    const state = await notificationsOf(page);
    expect(state.searching).toBe(false);
    expect(state.running).toEqual([]);
    const row = await rowOf(jobSearchId);
    expect(row.status).toBe("failed");
    expect(row.failure).toBe("timeout");
    expect(row.progress).toBeNull();
    // The worker's late steps do not bring it back.
    await page.waitForTimeout(4000);
    expect((await rowOf(jobSearchId)).progress).toBeNull();
    expect((await notificationsOf(page)).running).toEqual([]);
  });
});

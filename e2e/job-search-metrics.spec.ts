import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe as subscribeToPlan } from "./support/plan";

// Issue #109: every finished or failed Job Search keeps what Job discovery
// measured (funnel, skipped pages by reason, cost in €) and its duration; each
// Job Digest run logs the same. Driven through the public entry points: a Job
// Search started over the web app's HTTP API, worked by the real worker
// (apps/worker, `tsx src/main.ts`) on the same database; a Job Digest made by
// the worker's `job-digest.schedule` job. The outside world is played by
// e2e/support/fake-job-sites.mjs: 10 result URLs, of which
//   - 2 are refused by robots.txt, 1 by the site's terms (LinkedIn),
//     2 are behind bot protection, 1 behind a login wall: 6 skipped;
//   - 1 was already captured as a Job Offer: not read again;
//   - 3 are read (JSON-LD careers page, its mirror, a plain page the LLM reads);
//     the mirror is the careers page's Job Offer again.
// The Job Search's metrics are in the `job_search.metrics` column.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-job-search-metrics-${tag}`);
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
const searchCriteria = { targetRole: "Directrice administrative et financière", location: "Lyon", contractType: "cdi" };
const knownUrl = `https://deja-vu-e2e.example/offre/${tag}`;

test.use({ baseURL: origin });

let worker: ChildProcess | undefined;
let workerOutput = "";

function startWorker() {
  worker = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: path.resolve("apps/worker"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      APP_URL: origin,
      MAIL_TRANSPORT: "console",
      AI_FAKE: "",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_WEB_SEARCH_PROVIDER: "perplexity",
      MISTRAL_API_KEY: "e2e-mistral-key",
      PERPLEXITY_API_KEY: "e2e-perplexity-key",
      JOB_DIGEST_FIRST_LOOK_BACK_DAYS: "0",
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
      E2E_SEARCH_DOWN_FLAG: searchDownFlag,
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
}

interface Metrics {
  funnel: { providerUrls: number; fetched: number; extracted: number; alreadyStored: number; afterDedup: number; matched: number };
  skipped: Record<string, number>;
  costEur: number;
  durationMs: number;
}
const SKIP_REASONS = ["robots", "site_terms", "bot_protection", "login_wall", "not_public", "gone", "unreachable", "not_a_job_offer", "invalid"];

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

async function signInWithProfile(page: Page, label: string, plan?: "standard") {
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  if (plan) await subscribeToPlan(page, email, plan);
  const session = await (await page.request.get("/api/auth/get-session")).json();
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  return { candidateId: session.user.id as string, profileId: (await created.json()).id as string };
}

/** Starts a Job Search over HTTP and waits for the worker's outcome; returns its id and stored row. */
async function runJobSearch(page: Page, profileId: string, status: "done" | "failed") {
  const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
  expect(started.status(), await started.text()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  await expect
    .poll(async () => (await query<{ status: string }>("SELECT status FROM job_search WHERE id = $1", [id]))[0]?.status, { timeout: 90_000, message: workerOutput })
    .toBe(status);
  const [row] = await query<{ metrics: Metrics | null; elapsed_ms: number }>(
    "SELECT metrics, extract(epoch FROM finished_at - started_at) * 1000 AS elapsed_ms FROM job_search WHERE id = $1",
    [id],
  );
  return { id, ...row! };
}

/** The Match Scores of the Job Offers a finished Job Search lists, as its page shows them. */
async function shownScores(page: Page, jobSearchId: string): Promise<number[]> {
  await page.goto(`/recherches/${jobSearchId}`);
  await expect(page.getByText(/^Score de correspondance : \d+ \/ 100$/).first()).toBeVisible({ timeout: 30_000 });
  const texts = await page.getByText(/^Score de correspondance : \d+ \/ 100$/).allTextContents();
  return texts.map((text) => Number(/(\d+) \//.exec(text)![1]));
}

test.describe("Job Search metrics (#109)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let search: Awaited<ReturnType<typeof runJobSearch>>;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(workDir, { recursive: true });
    startWorker();
    await expect.poll(() => workerOutput, { timeout: 90_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
    // A Job Offer already captured from one of the pages the search will find.
    const page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("metrics-known"));
    const known = await page.request.post("/api/job-offers", {
      headers: { origin },
      data: { source: { url: knownUrl }, title: `Contrôleur de gestion – réf. ${tag}`, content: `Déjà capturée (réf. ${tag}).`, location: "Lyon" },
    });
    expect(known.status(), await known.text()).toBe(200);
    await page.close();
  });

  test.afterAll(async () => {
    if (worker && worker.exitCode === null) {
      const exited = new Promise((resolve) => worker!.once("exit", resolve));
      worker.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  test("a finished Job Search keeps its funnel: provider URLs, pages read, Job Offers extracted, after deduplication, scoring 60 or more", async ({ page }) => {
    const { profileId } = await signInWithProfile(page, "metrics-funnel");
    search = await runJobSearch(page, profileId, "done");

    expect(search.metrics, workerOutput).not.toBeNull();
    const { funnel } = search.metrics!;
    expect(funnel.providerUrls).toBe(10); // the 10 distinct URLs the fake web search returns
    expect(funnel.alreadyStored).toBe(1); // the captured Job Offer is not read again
    expect(funnel.fetched).toBe(3); // careers page, its mirror, the plain page: the 6 others gave no page
    expect(funnel.extracted).toBe(3); // JSON-LD, mirror's JSON-LD, the plain page read by the LLM
    expect(funnel.afterDedup).toBe(3); // the mirror is the careers page's Job Offer again; plus the one already stored

    // The last stage agrees with the Match Scores the Candidate sees on the Job Search page.
    const scores = await shownScores(page, search.id);
    expect(scores).toHaveLength(funnel.afterDedup);
    expect(funnel.matched).toBe(scores.filter((score) => score >= 60).length);
    expect(funnel.matched).toBeGreaterThanOrEqual(1);
  });

  test("counts the pages skipped, by reason, on the Job Search itself", () => {
    const { skipped } = search.metrics!;
    expect(Object.keys(skipped).sort()).toEqual([...SKIP_REASONS].sort());
    expect(skipped).toEqual({
      robots: 2, // a disallowed page and a private one
      site_terms: 1, // LinkedIn
      bot_protection: 2, // Cloudflare challenge, CAPTCHA
      login_wall: 1,
      not_public: 0,
      gone: 0,
      unreachable: 0,
      not_a_job_offer: 0,
      invalid: 0,
    });
    // Every result is accounted for: skipped, already stored, or read.
    const total = Object.values(skipped).reduce((sum, count) => sum + count, 0);
    expect(total + search.metrics!.funnel.alreadyStored + search.metrics!.funnel.fetched).toBe(search.metrics!.funnel.providerUrls);
  });

  test("records the cost in € (web search and the LLM reading one page) and the duration", () => {
    const { costEur, durationMs } = search.metrics!;
    // Perplexity: 20 input + 40 output tokens at 0.2 / 1.2 $ per million, plus 0.0025 $ per search, at 0.86 €/$ = 0.0021947 €.
    // Mistral reads one page (100 + 50 tokens): at most 0.0001075 € at its dearest list price.
    expect(costEur).toBeGreaterThanOrEqual(0.0021947 - 1e-6);
    expect(costEur).toBeLessThanOrEqual(0.0021947 + 0.0001075 + 1e-6);
    // From the Candidate starting it to its outcome.
    expect(durationMs).toBeGreaterThan(0);
    expect(Math.abs(durationMs - search.elapsed_ms)).toBeLessThanOrEqual(2);
    expect(durationMs).toBeLessThan(90_000);
  });

  test("a failed Job Search keeps metrics too: nothing found, nothing skipped, its duration", async ({ page }) => {
    const { profileId } = await signInWithProfile(page, "metrics-failed");
    writeFileSync(searchDownFlag, "");
    let failed: Awaited<ReturnType<typeof runJobSearch>>;
    try {
      failed = await runJobSearch(page, profileId, "failed");
    } finally {
      rmSync(searchDownFlag, { force: true });
    }
    expect(failed.metrics, workerOutput).not.toBeNull();
    expect(failed.metrics!.funnel).toEqual({ providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0, afterDedup: 0, matched: 0 });
    expect(failed.metrics!.skipped).toEqual(Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])));
    expect(failed.metrics!.costEur).toBe(0);
    expect(failed.metrics!.durationMs).toBeGreaterThan(0);
    expect(Math.abs(failed.metrics!.durationMs - failed.elapsed_ms)).toBeLessThanOrEqual(2);
  });

  test("every finished or failed Job Search row carries metrics", async () => {
    const rows = await query<{ n: string }>("SELECT count(*) AS n FROM job_search WHERE status IN ('done', 'failed') AND metrics IS NULL");
    expect(Number(rows[0]!.n)).toBe(0);
  });

  test("a Job Digest run records the same metrics in the worker's log", async ({ page }) => {
    const { profileId } = await signInWithProfile(page, "metrics-digest", "standard");
    const subscribed = await page.request.put(`/api/profiles/${profileId}/job-digest`, { headers: { origin }, data: { frequency: "weekly" } });
    expect(subscribed.status(), await subscribed.text()).toBeLessThan(300);
    // As if opted in more than a week ago, so the next 07:00 tick finds a Job Digest due.
    await query("UPDATE job_digest_subscription SET subscribed_at = subscribed_at - interval '8 days' WHERE profile_id = $1", [profileId]);
    const boss = new PgBoss({ connectionString: databaseUrl });
    await boss.start();
    try {
      await boss.send("job-digest.schedule", {});
    } finally {
      await boss.stop({ graceful: false });
    }

    const runs = () =>
      workerOutput
        .split("\n")
        .filter((line) => line.startsWith("{") && line.includes('"job_digest_run"') && line.includes(profileId))
        .map((line) => JSON.parse(line) as { event: string; profileId: string; discovery: string; sent: number; metrics: Metrics });
    await expect.poll(() => runs().length, { timeout: 90_000, message: workerOutput }).toBe(1);
    const [run] = runs();
    expect(run).toMatchObject({ event: "job_digest_run", profileId, discovery: "ran" });
    expect(run!.metrics.funnel.providerUrls).toBe(10);
    // The pages the sites refuse are refused again on every run.
    expect(run!.metrics.skipped).toEqual({
      robots: 2, site_terms: 1, bot_protection: 2, login_wall: 1, not_public: 0, gone: 0, unreachable: 0, not_a_job_offer: 0, invalid: 0,
    });
    expect(run!.metrics.funnel.afterDedup).toBeGreaterThanOrEqual(3);
    expect(run!.metrics.funnel.matched).toBeLessThanOrEqual(run!.metrics.funnel.afterDedup);
    expect(run!.metrics.costEur).toBeGreaterThanOrEqual(0.0021947 - 1e-6);
    expect(run!.metrics.durationMs).toBeGreaterThan(0);
    expect(run!.sent).toBeGreaterThan(0);
  });
});

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #113: a Job discovery run is bounded by a budget, not by a count of result pages: it
// keeps reading pages until it holds 30 Job Offers, has spent EUR 0.08 on AI calls, or has run
// 90 s, whichever comes first (each limit configurable by env), and the 15-minute Job Search
// timeout stays the safety net. Driven through the public entry point: the worker
// (apps/worker, `tsx src/main.ts`) working the "job-discovery.run" queue on the app's database,
// started with the budget's env variables, plus the built web app for the timeout. The outside
// world is e2e/support/fake-job-sites.mjs in volume mode: the web search returns many postings,
// and the fake logs every request the worker sends.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-discovery-budget-${runId}`);

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation"],
  languages: [],
};
const searchCriteria = { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] };

let candidateId = "";
let profileId = "";
let scenario = 0;

interface Volume {
  count: number;
  /** "jsonld": pages with JobPosting data (no LLM call); "llm": pages only an LLM can read (one call each). */
  kind: "jsonld" | "llm";
  delayMs?: number;
}

type LoggedRequest = { url: string; method: string; body: string };

/** A worker started with `budgetEnv`, and the volume postings the fake web search returns to it. */
function startWorker(tag: string, volume: Volume, budgetEnv: Record<string, string>) {
  const requestLog = path.join(workDir, `requests-${tag}.jsonl`);
  const child: ChildProcess = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
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
      // Whatever the machine's .env sets must not leak into the scenario.
      JOB_DISCOVERY_BUDGET_JOB_OFFERS: "",
      JOB_DISCOVERY_BUDGET_EUR: "",
      JOB_DISCOVERY_BUDGET_SECONDS: "",
      ...budgetEnv,
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: requestLog,
      E2E_DISCOVERY_VOLUME_COUNT: String(volume.count),
      E2E_DISCOVERY_VOLUME_KIND: volume.kind,
      E2E_DISCOVERY_VOLUME_DELAY_MS: String(volume.delayMs ?? 0),
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const run = { child, output: "" };
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", (chunk) => (run.output += chunk));
  return {
    ...run,
    get output() {
      return run.output;
    },
    requests: (): LoggedRequest[] =>
      existsSync(requestLog) ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [],
    async stop() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

async function enqueueDiscovery() {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  try {
    await boss.send("job-discovery.run", { candidateId, profileId });
  } finally {
    await boss.stop({ graceful: false });
  }
}

/** Stored Job Offers whose source is one of this scenario's postings. */
async function storedJobOffers(tag: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT source_url FROM job_offer WHERE source_url LIKE $1", [`%volume-e2e.example/%${tag}`]);
    return rows.map((row) => row.source_url as string);
  } finally {
    await client.end();
  }
}

/**
 * One whole Job discovery run in a fresh worker started with `budgetEnv`: what it reported,
 * the pages and AI calls it requested, the Job Offers it stored, and how long it took.
 */
async function discoveryRun(volume: Volume, budgetEnv: Record<string, string>, { timeoutMs = 90_000 }: { timeoutMs?: number } = {}) {
  const tag = `${runId}s${++scenario}`;
  const worker = startWorker(tag, volume, budgetEnv);
  try {
    await expect.poll(() => worker.output, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
    const startedAt = Date.now();
    await enqueueDiscovery();
    const reportLine = () => worker.output.split("\n").find((line) => line.startsWith(`[job-discovery] profile ${profileId}:`));
    await expect.poll(reportLine, { timeout: timeoutMs, message: worker.output }).toBeDefined();
    const elapsedMs = Date.now() - startedAt;
    const requests = worker.requests();
    return {
      report: reportLine()!,
      elapsedMs,
      pagesRead: requests.filter((r) => r.url.startsWith("https://volume-e2e.example/offre/")).length,
      // The LLM reading a page, not the run's job title step (#112).
      llmCalls: requests.filter((r) => r.url.startsWith("https://api.mistral.ai/") && !r.body.includes("autres intitulés")).length,
      stored: await storedJobOffers(tag),
    };
  } finally {
    await worker.stop();
  }
}

test.describe("Job discovery budget (#113)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async ({ browser }) => {
    mkdirSync(workDir, { recursive: true });
    const page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("discovery-budget"));
    candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;
    await page.close();
  });

  test.afterAll(() => {
    if (!process.env.E2E_KEEP) rmSync(workDir, { recursive: true, force: true });
  });

  test("by default, stops reading result pages once it holds 30 Job Offers, not after 10 pages", async () => {
    const run = await discoveryRun({ count: 40, kind: "jsonld" }, {});

    expect(run.report).toMatch(/: 30 Job Offer\(s\), 0 page\(s\) skipped/);
    expect(run.stored).toHaveLength(30);
    // The 31st to 40th results are never requested.
    expect(run.pagesRead).toBe(30);
  });

  test("JOB_DISCOVERY_BUDGET_JOB_OFFERS sets the number of Job Offers a run stops at", async () => {
    const run = await discoveryRun({ count: 20, kind: "jsonld" }, { JOB_DISCOVERY_BUDGET_JOB_OFFERS: "4" });

    expect(run.report).toMatch(/: 4 Job Offer\(s\), 0 page\(s\) skipped/);
    expect(run.stored).toHaveLength(4);
    expect(run.pagesRead).toBe(4);
  });

  test("JOB_DISCOVERY_BUDGET_EUR sets what a run may spend on AI calls before it stops", async () => {
    // The web search and the job title step cost about EUR 0.0023 and each page the LLM reads about EUR 0.0001.
    const tight = await discoveryRun({ count: 60, kind: "llm" }, { JOB_DISCOVERY_BUDGET_EUR: "0.0025" });

    expect(tight.llmCalls).toBeGreaterThanOrEqual(1);
    expect(tight.llmCalls).toBeLessThan(10);
    // It stopped on spend: nowhere near the 30 Job Offers, nor the 60 pages.
    expect(tight.stored).toHaveLength(tight.llmCalls);
    expect(tight.pagesRead).toBe(tight.llmCalls);

    // A bigger budget reads more of the same pages.
    const roomy = await discoveryRun({ count: 60, kind: "llm" }, { JOB_DISCOVERY_BUDGET_EUR: "0.0035" });
    expect(roomy.llmCalls).toBeGreaterThan(tight.llmCalls);
    expect(roomy.llmCalls).toBeLessThan(30);
  });

  test("by default, stops once a run has spent EUR 0.08 on AI calls", async () => {
    // Job Offers capped far above what EUR 0.08 buys, so only the spend can stop this run.
    const run = await discoveryRun({ count: 1000, kind: "llm" }, { JOB_DISCOVERY_BUDGET_JOB_OFFERS: "1000" }, { timeoutMs: 150_000 });

    expect(run.llmCalls).toBeGreaterThan(100);
    expect(run.llmCalls).toBeLessThan(1000);
    expect(run.stored).toHaveLength(run.llmCalls);
  });

  test("JOB_DISCOVERY_BUDGET_SECONDS sets how long a run may last before it stops", async () => {
    // Each page takes 1 s to answer: a 3 s budget reads a few of the 40 pages, never all of them.
    const run = await discoveryRun({ count: 40, kind: "jsonld", delayMs: 1000 }, { JOB_DISCOVERY_BUDGET_SECONDS: "3" });

    expect(run.pagesRead).toBeGreaterThanOrEqual(2);
    expect(run.pagesRead).toBeLessThanOrEqual(5);
    expect(run.stored).toHaveLength(run.pagesRead);
    expect(run.elapsedMs).toBeLessThan(15_000);
  });

  test("by default, stops once a run has lasted 90 s", async () => {
    test.setTimeout(240_000);
    // Each page takes 10 s to answer; the run is cut off after the page being read at 90 s.
    const run = await discoveryRun({ count: 40, kind: "jsonld", delayMs: 10_000 }, {}, { timeoutMs: 180_000 });

    expect(run.pagesRead).toBeGreaterThanOrEqual(8);
    expect(run.pagesRead).toBeLessThanOrEqual(11);
    expect(run.stored).toHaveLength(run.pagesRead);
    expect(run.elapsedMs).toBeGreaterThanOrEqual(85_000);
    expect(run.elapsedMs).toBeLessThan(130_000);
  });

  test("a budget the 15-minute Job Search timeout could not contain is refused when the worker starts", async () => {
    const result = spawnSync(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
      cwd: path.resolve("apps/worker"),
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        AI_FAKE: "",
        AI_WEB_SEARCH_PROVIDER: "perplexity",
        PERPLEXITY_API_KEY: "e2e-perplexity-key",
        MISTRAL_API_KEY: "e2e-mistral-key",
        AI_SCORING_PROVIDER: "mistral",
        AI_WRITING_PROVIDER: "mistral",
        AI_COACHING_PROVIDER: "mistral",
        AI_CV_PARSING_PROVIDER: "mistral",
        AI_OFFER_ANALYSIS_PROVIDER: "mistral",
        JOB_DISCOVERY_BUDGET_SECONDS: "601",
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("JOB_DISCOVERY_BUDGET_SECONDS must be a whole number above 0, up to 600");
  });

  test("a Job Search the worker never answered still fails after 15 minutes, giving its use back", async ({ browser }) => {
    // No worker is running: the Job Search stays "searching" until the safety net fires.
    const page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("discovery-budget-timeout"));
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    const timeoutProfileId = (await created.json()).id as string;
    await page.goto(`/recherches?profil=${timeoutProfileId}`);
    await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
    await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
    const jobSearchId = new URL(page.url()).pathname.split("/").pop()!;

    // Nobody works that queued job, and a later spec's worker must not find it left behind.
    const dropQueuedDiscovery = async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query("DELETE FROM pgboss.job WHERE name = 'job-discovery.run' AND data->>'profileId' = $1", [timeoutProfileId]);
      } finally {
        await client.end();
      }
    };

    const startedMinutesAgo = async (minutes: number) => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query("UPDATE job_search SET started_at = now() - make_interval(mins => $2) WHERE id = $1", [jobSearchId, minutes]);
      } finally {
        await client.end();
      }
    };
    const failure = page.getByText("La recherche n'a pas abouti. Réessayez dans quelques instants.");

    await dropQueuedDiscovery();
    await startedMinutesAgo(10);
    await page.goto(`/recherches/${jobSearchId}`);
    await expect(page.getByText("Votre coach cherche des offres")).toBeVisible();
    await expect(failure).toHaveCount(0);

    await startedMinutesAgo(16);
    await page.goto(`/recherches/${jobSearchId}`);
    await expect(failure).toBeVisible();
    await page.goto("/abonnement");
    await expect(page.locator("dl > div").filter({ has: page.getByText("Recherches d'offres", { exact: true }) }).locator("dd")).toHaveText("0 sur 3");
    await page.close();
  });
});

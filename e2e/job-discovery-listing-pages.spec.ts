import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #114: Job discovery follows a listing page (a job board's search results, a careers
// site's openings) to the individual postings it links to, and each followed link counts
// against the run's budget. Driven through the public entry point: the worker
// (apps/worker, `tsx src/main.ts`) working the "job-discovery.run" queue on the app's database.
// The outside world is e2e/support/fake-job-sites.mjs in listing mode: the web search returns
// one listing page (7 postings plus a link to another site) then one separate posting, and the
// fake logs every request the worker sends.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-discovery-listing-${runId}`);

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

type LoggedRequest = { url: string; method: string; body: string };

async function enqueueDiscovery() {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  try {
    await boss.send("job-discovery.run", { candidateId, profileId });
  } finally {
    await boss.stop({ graceful: false });
  }
}

async function storedJobOffers(tag: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT source_url FROM job_offer WHERE source_url LIKE $1 ORDER BY source_url", [`%-e2e.example/%${tag}%`]);
    return rows.map((row) => row.source_url as string);
  } finally {
    await client.end();
  }
}

/** One whole Job discovery run in a fresh worker started with `budgetEnv`. */
async function discoveryRun(budgetEnv: Record<string, string>) {
  const tag = `${runId}l${++scenario}`;
  const requestLog = path.join(workDir, `requests-${tag}.jsonl`);
  let output = "";
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
      JOB_DISCOVERY_BUDGET_JOB_OFFERS: "",
      JOB_DISCOVERY_BUDGET_EUR: "",
      JOB_DISCOVERY_BUDGET_SECONDS: "",
      ...budgetEnv,
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: requestLog,
      E2E_DISCOVERY_LISTING: "1",
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", (chunk) => (output += chunk));
  try {
    await expect.poll(() => output, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
    await enqueueDiscovery();
    const reportLine = () => output.split("\n").find((line) => line.startsWith(`[job-discovery] profile ${profileId}:`));
    await expect.poll(reportLine, { timeout: 60_000, message: output }).toBeDefined();
    const requests: LoggedRequest[] = existsSync(requestLog)
      ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [];
    return {
      tag,
      report: reportLine()!,
      fetched: (url: string) => requests.filter((r) => r.url === url).length,
      requested: (prefix: string) => requests.filter((r) => r.url.startsWith(prefix)).length,
      // The LLM reading a page, not the run's job title step (#112).
      llmCalls: requests.filter((r) => r.url.startsWith("https://api.mistral.ai/") && !r.body.includes("autres intitulés")).length,
      stored: await storedJobOffers(tag),
    };
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}

const listed = (tag: string, n: number) => `https://listing-e2e.example/offres-emploi/${n}-daf-${tag}`;

test.describe("Job discovery follows listing pages (#114)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async ({ browser }) => {
    mkdirSync(workDir, { recursive: true });
    const page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("discovery-listing"));
    candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;
    await page.close();
  });

  test.afterAll(() => {
    if (!process.env.E2E_KEEP) rmSync(workDir, { recursive: true, force: true });
  });

  test("detects the listing page and follows its first 5 same-site postings, once each, without the LLM reading the listing", async () => {
    const run = await discoveryRun({});

    for (const n of [1, 2, 3, 4, 5]) expect(run.fetched(listed(run.tag, n)), `posting ${n}`).toBe(1);
    // Only 5 of the 7 are followed, and a link to another site is never followed from a listing.
    for (const n of [6, 7]) expect(run.fetched(listed(run.tag, n)), `posting ${n}`).toBe(0);
    expect(run.requested("https://autre-e2e.example/offres-emploi/99-")).toBe(0);
    // Postings carry JobPosting data and the listing is no posting: no LLM call at all.
    expect(run.llmCalls).toBe(0);
    // 5 followed postings + the later result; the listing page itself is skipped, not stored.
    expect(run.stored).toHaveLength(6);
    expect(run.stored).toContain(listed(run.tag, 1));
    expect(run.report).toMatch(/: 6 Job Offer\(s\), 1 page\(s\) skipped/);
  });

  test("counts followed links against the budget: a run holding its Job Offers stops following and reads no later result", async () => {
    const run = await discoveryRun({ JOB_DISCOVERY_BUDGET_JOB_OFFERS: "3" });

    expect(run.stored).toEqual([1, 2, 3].map((n) => listed(run.tag, n)));
    for (const n of [4, 5, 6, 7]) expect(run.fetched(listed(run.tag, n)), `posting ${n}`).toBe(0);
    expect(run.requested("https://autre-e2e.example/offres-emploi/42-")).toBe(0);
    expect(run.report).toMatch(/: 3 Job Offer\(s\)/);
  });
});

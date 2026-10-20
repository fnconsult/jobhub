import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #115: a Greenhouse, Lever or Ashby posting found by Job discovery is read through that
// ATS's public JSON API, not its HTML page: the Job Offer carries the posting date the ATS states,
// and a closed posting or one first published more than 30 days ago is dropped. Driven through the
// public entry point: the worker (apps/worker, `tsx src/main.ts`) working the "job-discovery.run"
// queue on the app's database, then the web app's HTTP API (GET /api/job-offers/:id) for the result.
// The outside world is e2e/support/fake-job-sites.mjs in ATS mode, which logs every request.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-discovery-ats-${tag}`);
const requestLog = path.join(workDir, "requests.jsonl");
const DAY = 24 * 60 * 60 * 1000;

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
const searchCriteria = { targetRole: "Directeur financier", locations: ["Lyon"], contractTypes: ["cdi"] };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ghBoard = `acme-gh-${tag}`;
const leverCo = `acme-lever-${tag}`;
const ashbyCo = `acme-ashby-${tag}`;
const posting = {
  ghFresh: `https://job-boards.greenhouse.io/${ghBoard}/jobs/1001`,
  ghOld: `https://job-boards.greenhouse.io/${ghBoard}/jobs/1002`,
  ghClosed: `https://job-boards.greenhouse.io/${ghBoard}/jobs/1003`,
  ghDeadline: `https://job-boards.greenhouse.io/${ghBoard}/jobs/1004`,
  leverFresh: `https://jobs.lever.co/${leverCo}/${uuid(1)}`,
  leverOld: `https://jobs.lever.co/${leverCo}/${uuid(2)}`,
  ashbyFresh: `https://jobs.ashbyhq.com/${ashbyCo}/${uuid(3)}`,
  ashbyOld: `https://jobs.ashbyhq.com/${ashbyCo}/${uuid(4)}`,
  ashbyClosed: `https://jobs.ashbyhq.com/${ashbyCo}/${uuid(5)}`,
};
const fresh = [posting.ghFresh, posting.leverFresh, posting.ashbyFresh];
const dropped = [posting.ghOld, posting.ghClosed, posting.ghDeadline, posting.leverOld, posting.ashbyOld, posting.ashbyClosed];
const ageInDays = { [posting.ghFresh]: 5, [posting.leverFresh]: 3, [posting.ashbyFresh]: 10 } as Record<string, number>;

type LoggedRequest = { url: string; method: string; headers: Record<string, string> };
const requests = (): LoggedRequest[] =>
  existsSync(requestLog) ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

let worker: ChildProcess | undefined;
let workerOutput = "";
let candidateId = "";
let profileId = "";
let report = "";
let startedAt = 0;

async function stored(): Promise<{ id: string; source_url: string }[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT id, source_url FROM job_offer WHERE source_url LIKE $1 ORDER BY source_url", [`%${tag}%`]);
    return rows;
  } finally {
    await client.end();
  }
}

test.describe("Job discovery reads Greenhouse, Lever and Ashby postings through their JSON APIs (#115)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    mkdirSync(workDir, { recursive: true });
    const page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("discovery-ats"));
    candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;
    await page.close();

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
        E2E_DISCOVERY_TAG: tag,
        E2E_DISCOVERY_LOG: requestLog,
        E2E_DISCOVERY_ATS: "1",
        NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
    await expect.poll(() => workerOutput, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);

    startedAt = Date.now();
    const boss = new PgBoss({ connectionString: databaseUrl });
    await boss.start();
    try {
      await boss.send("job-discovery.run", { candidateId, profileId });
    } finally {
      await boss.stop({ graceful: false });
    }
    const line = () => workerOutput.split("\n").find((l) => l.startsWith(`[job-discovery] profile ${profileId}:`));
    await expect.poll(line, { timeout: 60_000, message: workerOutput }).toBeDefined();
    report = line()!;
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

  test("reads each ATS posting through its JSON API and never fetches the posting's HTML page", () => {
    const urls = requests().map((r) => r.url);
    expect(urls).toContain(`https://boards-api.greenhouse.io/v1/boards/${ghBoard}/jobs/1001`);
    expect(urls).toContain(`https://api.lever.co/v0/postings/${leverCo}/${uuid(1)}`);
    expect(urls).toContain(`https://api.ashbyhq.com/posting-api/job-board/${ashbyCo}`);
    for (const url of Object.values(posting)) expect(urls, `HTML page ${url} fetched`).not.toContain(url);
    // The API is asked politely: robots.txt first, as a named bot, asking for JSON.
    for (const host of ["boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com"]) {
      const own = requests().filter((r) => new URL(r.url).hostname === host);
      expect(own[0]!.url, host).toBe(`https://${host}/robots.txt`);
      for (const r of own) expect(r.headers["user-agent"]).toMatch(/bot/i);
      expect(own.at(-1)!.headers.accept).toContain("application/json");
    }
  });

  test("captures the open, recent postings as Job Offers carrying the posting date the ATS states", async ({ request }) => {
    const offers = await stored();
    expect(offers.map((o) => o.source_url).sort()).toEqual([...fresh].sort());

    const expected: Record<string, { title: string; employer?: string }> = {
      [posting.ghFresh]: { title: `Directeur financier GH – ${tag}`, employer: "Acme GH" },
      [posting.leverFresh]: { title: `Directeur financier Lever – ${tag}` },
      [posting.ashbyFresh]: { title: `Directeur financier Ashby – ${tag}` },
    };
    for (const url of fresh) {
      const id = offers.find((o) => o.source_url === url)!.id;
      const offer = await (await request.get(`${origin}/api/job-offers/${id}`)).json();
      expect(offer).toMatchObject({ source: { url }, ...expected[url] });
      expect(offer.content).toContain(tag);
      // The posting date is the ATS's own (days before the run), not the day it was captured.
      const postedAt = Date.parse(offer.postedAt);
      expect(Number.isFinite(postedAt), `postedAt of ${url}: ${offer.postedAt}`).toBe(true);
      const days = (startedAt - postedAt) / DAY;
      expect(days).toBeGreaterThan(ageInDays[url]! - 0.5);
      expect(days).toBeLessThan(ageInDays[url]! + 0.5);
    }
  });

  test("drops closed postings (gone, past deadline, absent from the board) and postings older than 30 days", async () => {
    const stored_ = (await stored()).map((o) => o.source_url);
    for (const url of dropped) expect(stored_, url).not.toContain(url);
    // 3 old postings are too old, 3 are closed: the report accounts for each.
    expect(report).toMatch(/: 3 Job Offer\(s\), 6 page\(s\) skipped/);
    expect(report).toMatch(/too_old: 3/);
    expect(report).toMatch(/gone: 3/);
  });

  test("never crawls an ATS board: only the postings the search found are asked for (Ashby: the one employer board)", () => {
    const ats = requests().filter((r) => /greenhouse\.io|lever\.co|ashbyhq\.com/.test(new URL(r.url).hostname) && !r.url.endsWith("/robots.txt"));
    const allowed = new Set([
      ...[1001, 1002, 1003, 1004].map((id) => `https://boards-api.greenhouse.io/v1/boards/${ghBoard}/jobs/${id}`),
      `https://api.lever.co/v0/postings/${leverCo}/${uuid(1)}`,
      `https://api.lever.co/v0/postings/${leverCo}/${uuid(2)}`,
      `https://api.ashbyhq.com/posting-api/job-board/${ashbyCo}`,
    ]);
    for (const r of ats) {
      expect(allowed.has(r.url), `unexpected ATS request ${r.url}`).toBe(true);
      expect(r.method).toBe("GET");
    }
    // No board listing (Greenhouse /jobs, Lever /postings/<company>), no other employer's board.
    expect(ats.some((r) => /\/boards\/[^/]+\/jobs$/.test(r.url) || /\/postings\/[^/]+$/.test(r.url))).toBe(false);
    expect(ats.every((r) => r.url.includes(tag))).toBe(true);
    // Each posting is asked for once: no retry.
    expect(ats.filter((r) => r.url.includes(`/jobs/1001`))).toHaveLength(1);
  });
});

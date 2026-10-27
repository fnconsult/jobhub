import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #120: Job discovery searches France Travail's Offres d'emploi API by structured filters
// (ROME codes of the Search Criteria title, area, contract type), dates each offer by its creation,
// counts its offers in the search budget, and reports it in the Job Search's metrics. It runs only
// with FRANCE_TRAVAIL_CLIENT_ID and FRANCE_TRAVAIL_CLIENT_SECRET set. Driven through the public entry
// points: a Job Search started over the web app's HTTP API and worked by the real worker
// (apps/worker, `tsx src/main.ts`) on the same database. The outside world, France Travail included,
// is e2e/support/fake-job-sites.mjs (live credentials do not exist yet, #119); every request the
// worker sends is logged, so the test can check what left the worker.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-france-travail-${runId}`);

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
const cfoCriteria = { targetRole: "Directrice administrative et financière", location: "Lyon", contractType: "cdi" };

test.use({ baseURL: origin });

type LoggedRequest = { url: string; method: string; headers: Record<string, string>; body: string };
interface Metrics {
  funnel: { providerUrls: number; fetched: number; afterDedup: number };
  franceTravail?: { status: string; offers: number; calls: number };
}

interface Scenario {
  /** What France Travail's fake does; "" leaves it out of the fake web. */
  ft: "ok" | "search-refused" | "token-refused" | "failed";
  ftCount?: number;
  credentials?: boolean;
  env?: Record<string, string>;
  criteria?: typeof cfoCriteria;
}

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** One Job Search, worked by a fresh worker started as `scenario` says. */
async function jobSearchRun(page: Page, scenario: Scenario, label: string) {
  const tag = `${runId}${label}`;
  const requestLog = path.join(workDir, `requests-${tag}.jsonl`);
  const email = newAddress(`ft-${label}`);
  await signInWithMagicLink(page, email);
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: scenario.criteria ?? cfoCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  const profileId = (await created.json()).id as string;

  let output = "";
  const worker: ChildProcess = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
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
      FRANCE_TRAVAIL_CLIENT_ID: scenario.credentials === false ? "" : "e2e-ft-client-id",
      FRANCE_TRAVAIL_CLIENT_SECRET: scenario.credentials === false ? "" : "e2e-ft-client-secret",
      ...scenario.env,
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: requestLog,
      E2E_DISCOVERY_FT: scenario.ft,
      E2E_DISCOVERY_FT_COUNT: String(scenario.ftCount ?? 3),
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (output += chunk));
  try {
    await expect.poll(() => output, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
    const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
    expect(started.status(), await started.text()).toBe(201);
    const { id } = (await started.json()) as { id: string };
    await expect
      .poll(async () => (await query<{ status: string }>("SELECT status FROM job_search WHERE id = $1", [id]))[0]?.status, { timeout: 90_000, message: output })
      .toBe("done");
    const [row] = await query<{ metrics: Metrics }>("SELECT metrics FROM job_search WHERE id = $1", [id]);
    const requests: LoggedRequest[] = existsSync(requestLog) ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    const stored = await query<{ source_url: string; title: string; employer: string | null; contract_type: string | null; posted_at: Date | null }>(
      "SELECT source_url, title, employer, contract_type, posted_at FROM job_offer WHERE source_url LIKE $1 ORDER BY source_url",
      [`https://candidat.francetravail.fr/offres/recherche/detail/FT${tag}x%`],
    );
    return {
      id,
      tag,
      metrics: row!.metrics,
      requests,
      stored,
      output: () => output,
      // Offres d'emploi's own: a run also asks La Bonne Boite (and ROMEO) for its Target Companies, each with its own token (#406).
      tokenRequests: requests.filter((r) => r.url.startsWith("https://entreprise.francetravail.fr/") && new URLSearchParams(r.body).get("scope")?.includes("api_offresdemploiv2")),
      searchRequests: requests.filter((r) => r.url.startsWith("https://api.francetravail.io/partenaire/offresdemploi/")),
      webSearches: requests.filter((r) => r.url.startsWith("https://api.perplexity.ai")),
      franceTravailPages: requests.filter((r) => r.url.startsWith("https://candidat.francetravail.fr/")),
    };
  } finally {
    if (worker.exitCode === null) {
      const exited = new Promise((resolve) => worker.once("exit", resolve));
      worker.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }
  }
}

test.describe("France Travail adapter for Job discovery (#120)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(() => mkdirSync(workDir, { recursive: true }));
  test.afterAll(() => {
    if (!process.env.E2E_KEEP) rmSync(workDir, { recursive: true, force: true });
  });

  test("searches France Travail by the ROME code of the Search Criteria title, its area and contract type, with the client credentials", async ({ page }) => {
    const run = await jobSearchRun(page, { ft: "ok" }, "rome");

    expect(run.tokenRequests, run.output()).toHaveLength(1);
    const token = new URLSearchParams(run.tokenRequests[0]!.body);
    expect(Object.fromEntries(token)).toMatchObject({ grant_type: "client_credentials", client_id: "e2e-ft-client-id", client_secret: "e2e-ft-client-secret" });
    expect(new URL(run.tokenRequests[0]!.url).searchParams.get("realm")).toBe("/partenaire");

    expect(run.searchRequests).toHaveLength(1);
    const search = run.searchRequests[0]!;
    expect(search.headers.authorization).toBe(`Bearer ft-token-${run.tag}`);
    const params = new URL(search.url).searchParams;
    // "Directrice administrative et financière" is ROME M1205 (Direction administrative et financière).
    expect(params.get("codeROME")).toBe("M1205");
    expect(params.get("motsCles")).toBeNull();
    expect(params.get("departement")).toBe("69"); // Lyon
    expect(params.get("typeContrat")).toBe("CDI");
    // Created in the last 30 days.
    const [min, max] = [Date.parse(params.get("minCreationDate")!), Date.parse(params.get("maxCreationDate")!)];
    expect((max - min) / 86_400_000).toBeCloseTo(30, 1);
    expect(Math.abs(Date.now() - max)).toBeLessThan(120_000);
  });

  test("keeps each offer as a Job Offer at its France Travail page, dated by its creation, and the web search goes on", async ({ page }) => {
    const run = await jobSearchRun(page, { ft: "ok" }, "offers");

    expect(run.stored.map((offer) => offer.source_url)).toEqual([1, 2, 3].map((n) => `https://candidat.francetravail.fr/offres/recherche/detail/FT${run.tag}x${n}`));
    for (const offer of run.stored) {
      expect(offer.title).toContain("Directeur administratif et financier France Travail");
      expect(offer.employer).toBe("INDUSTRIES DU RHONE");
      expect(offer.contract_type).toBe("cdi");
      // Posting date = dateCreation (2 days ago), not dateActualisation (a minute ago).
      const ageDays = (Date.now() - offer.posted_at!.getTime()) / 86_400_000;
      expect(ageDays).toBeGreaterThan(1.9);
      expect(ageDays).toBeLessThan(2.5);
    }
    // The offers are API answers: their pages are never fetched.
    expect(run.franceTravailPages).toHaveLength(0);
    // The web search still runs after France Travail, and its Job Offers join the run's.
    expect(run.webSearches.length).toBeGreaterThanOrEqual(1);
    expect(run.metrics.funnel.providerUrls).toBe(10);
    expect(run.metrics.funnel.afterDedup).toBeGreaterThan(3);
    // The Candidate sees the offers on the Job Search page.
    await page.goto(`/recherches/${run.id}`);
    await expect(page.getByText(`Directeur administratif et financier France Travail 1 – réf. ${run.tag}`)).toBeVisible({ timeout: 30_000 });
  });

  test("counts France Travail in the Job Search's observability: status, Job Offers kept and HTTP calls, also in the worker log", async ({ page }) => {
    const run = await jobSearchRun(page, { ft: "ok" }, "metrics");

    expect(run.metrics.franceTravail).toEqual({ status: "searched", offers: 3, calls: 2 });
    expect(run.output()).toMatch(/\[job-discovery\] profile [0-9a-f-]+: \d+ Job Offer\(s\), \d+ page\(s\) skipped.*, France Travail searched \(3 Job Offer\(s\), 2 call\(s\)\)/);
  });

  test("counts its Job Offers in the search budget: it asks for no more than the budget holds and the run stops there", async ({ page }) => {
    const run = await jobSearchRun(page, { ft: "ok", ftCount: 10, env: { JOB_DISCOVERY_BUDGET_JOB_OFFERS: "2" } }, "budget");

    expect(new URL(run.searchRequests[0]!.url).searchParams.get("range")).toBe("0-1");
    expect(run.stored).toHaveLength(2);
    expect(run.metrics.franceTravail).toEqual({ status: "searched", offers: 2, calls: 2 });
    // The budget is used up: no web search, no page read.
    expect(run.webSearches).toHaveLength(0);
    expect(run.metrics.funnel.afterDedup).toBe(2);
  });

  test("without client credentials, France Travail is off: never contacted, reported as off", async ({ page }) => {
    const run = await jobSearchRun(page, { ft: "ok", credentials: false }, "off");

    expect(run.output()).toContain("France Travail is off");
    expect(run.tokenRequests).toHaveLength(0);
    expect(run.searchRequests).toHaveLength(0);
    expect(run.stored).toHaveLength(0);
    expect(run.metrics.franceTravail).toEqual({ status: "off", offers: 0, calls: 0 });
    expect(run.output()).not.toContain("France Travail searched");
    expect(run.metrics.funnel.afterDedup).toBeGreaterThan(0); // the web search carried on alone
  });

  for (const scenario of [
    { name: "France Travail refusing the search (403)", ft: "search-refused", status: "refused", calls: 2 },
    { name: "France Travail turning the credentials down (401 on the token)", ft: "token-refused", status: "refused", calls: 1 },
    { name: "France Travail failing (500)", ft: "failed", status: "failed", calls: 2 },
  ] as const) {
    test(`${scenario.name} is counted, and never fails the Job Search: the web search goes on`, async ({ page }) => {
      const run = await jobSearchRun(page, { ft: scenario.ft }, `x${scenario.ft}`);

      expect(run.metrics.franceTravail).toEqual({ status: scenario.status, offers: 0, calls: scenario.calls });
      expect(run.stored).toHaveLength(0);
      expect(run.output()).toContain(`France Travail ${scenario.status} (0 Job Offer(s), ${scenario.calls} call(s))`);
      expect(run.webSearches.length).toBeGreaterThanOrEqual(1);
      expect(run.metrics.funnel.afterDedup).toBeGreaterThan(0);
    });
  }

  test("a title that names no ROME job is searched by its keywords instead", async ({ page }) => {
    const run = await jobSearchRun(page, { ft: "ok", criteria: { ...cfoCriteria, targetRole: "Dompteur de zorglubs" } }, "kw");

    const params = new URL(run.searchRequests[0]!.url).searchParams;
    expect(params.get("codeROME")).toBeNull();
    expect(params.get("motsCles")).toBe("dompteur,zorglubs");
    expect(params.get("departement")).toBe("69");
  });
});

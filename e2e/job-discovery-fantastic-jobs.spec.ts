import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #243: Fantastic.jobs is a Job discovery source (its active-ats API of ATS postings) with its own
// Provider Secret, FANTASTIC_JOBS_API_KEY. Driven through the public entry points: the Back Office
// (Clés, Sites de recherche, Consommation IA) of the built web app, a Job Search started over its HTTP API,
// and the real worker (apps/worker, `tsx src/main.ts`) on the same database. The outside world is
// e2e/support/fake-job-sites.mjs (Fantastic.jobs' active-ats, shaped like the real answer captured in
// apps/worker/src/job-discovery/fixtures/fantastic-jobs/active-ats.json; the live API has a trial quota) and,
// for the web server's connection test, e2e/support/fake-contact-provider.mjs. Every request the worker sends
// is logged, so the test can check what left it.
//
// One spec holds the Back Office and the worker scenarios: both change the one FANTASTIC_JOBS_API_KEY row of the
// suite's database and the Fantastic.jobs source's toggle, which no other spec may see change meanwhile.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const keys = admin.providerSecrets;
const sites = admin.searchSites;
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const SUPER_ADMIN = "fantastic-office@e2e.jobbbox.test";
const NAME = "FANTASTIC_JOBS_API_KEY";
const SOURCE_NAME: string = sites.sources.names.fantastic_jobs;
const SECRETS_MASTER_KEYS = "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA="; // as in playwright.config.ts
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-fantastic-jobs-${runId}`);
const ENV_KEY = `e2e-fj-env-${runId}`;
const VALID_KEY = `e2e-fj-valid-${runId}`;

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

test.use({ baseURL: origin });

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
type LoggedRequest = { url: string; method: string; headers: Record<string, string>; body: string };
interface Metrics {
  funnel: { providerUrls: number; fetched: number; extracted: number; alreadyStored: number; afterDedup: number };
  fantasticJobs?: { status: string; offers: number; calls: number; costEur: number };
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

// --- Back Office ---------------------------------------------------------------------------------------------

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, SUPER_ADMIN);
  return page;
}

const keyRow = (page: Page) => page.getByRole("row").filter({ has: page.getByRole("rowheader").filter({ hasText: NAME }) });

async function replaceKey(page: Page, value: string, { saveAnyway = false } = {}) {
  await page.goto("/admin/cles");
  await page.locator("summary", { hasText: tr(keys.replaceLegend, { name: NAME }) }).click();
  await page.getByLabel(tr(keys.newValue, { name: NAME })).fill(value);
  if (saveAnyway) await page.locator(`#anyway-${NAME}`).check();
  await page.getByRole("button", { name: tr(keys.replace, { name: NAME }) }).click();
}

async function clearKey(page: Page) {
  await page.goto("/admin/cles");
  const clear = page.getByRole("button", { name: tr(keys.clear, { name: NAME }) });
  if (await clear.count()) await clear.click();
  await expect(keyRow(page)).toContainText(keys.sources.missing);
}

const sourceRow = (page: Page) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: SOURCE_NAME, exact: true }) });

async function setSource(page: Page, enabled: boolean) {
  await page.goto("/admin/sites");
  const button = sourceRow(page).getByRole("button", { name: tr(enabled ? sites.enable : sites.disable, { name: SOURCE_NAME }), exact: true });
  if (await button.count()) await button.click();
  await expect(sourceRow(page).getByRole("cell").first()).toHaveText(enabled ? sites.enabled : sites.disabled);
}

// --- Job Searches --------------------------------------------------------------------------------------------

interface Scenario {
  /** What Fantastic.jobs' fake does. */
  fj: "ok" | "key-rejected" | "quota" | "failed";
  /** FANTASTIC_JOBS_API_KEY in the worker's environment ("" for none). */
  envKey?: string;
  /** The key the fake accepts. Default: the environment's. */
  acceptedKey?: string;
  count?: number;
  /** Jobs of runs sharing a tag are the same postings. Default: one per run. */
  tag?: string;
  env?: Record<string, string>;
}

/** One Job Search, worked by a fresh worker started as `scenario` says. */
async function jobSearchRun(page: Page, scenario: Scenario, label: string) {
  const tag = scenario.tag ?? `${runId}${label}`;
  const requestLog = path.join(workDir, `requests-${runId}${label}.jsonl`);
  const envKey = scenario.envKey ?? ENV_KEY;
  await signInWithMagicLink(page, newAddress(`fj-${label}`));
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  const profileId = (await created.json()).id as string;

  let output = "";
  const worker: ChildProcess = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: path.resolve("apps/worker"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
      SECRETS_MASTER_KEYS,
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
      FRANCE_TRAVAIL_CLIENT_ID: "",
      FRANCE_TRAVAIL_CLIENT_SECRET: "",
      FANTASTIC_JOBS_API_KEY: envKey,
      FANTASTIC_JOBS_API_URL: "",
      FANTASTIC_JOBS_EUR_PER_JOB: "",
      FANTASTIC_JOBS_MAX_PER_SEARCH: "",
      ...scenario.env,
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: requestLog,
      E2E_DISCOVERY_FJ: scenario.fj,
      E2E_DISCOVERY_FJ_KEY: scenario.acceptedKey ?? envKey,
      E2E_DISCOVERY_FJ_COUNT: String(scenario.count ?? 3),
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
    const stored = await query<{ source_url: string; title: string; employer: string | null; posted_at: Date | null }>(
      "SELECT source_url, title, employer, posted_at FROM job_offer WHERE source_url LIKE $1 ORDER BY source_url",
      [`https://ats-e2e.example/fantastic/${tag}/%`],
    );
    return {
      id,
      tag,
      metrics: row!.metrics,
      requests,
      stored,
      output: () => output,
      fantasticJobsRequests: requests.filter((r) => new URL(r.url).hostname === "data.fantastic.jobs"),
      atsPages: requests.filter((r) => new URL(r.url).hostname === "ats-e2e.example"),
      webSearches: requests.filter((r) => r.url.startsWith("https://api.perplexity.ai")),
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

test.describe("Fantastic.jobs as a Job discovery source with its own Provider Secret (#243)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let office: Page;

  test.beforeAll(async ({ browser }) => {
    mkdirSync(workDir, { recursive: true });
    office = await adminPage(browser);
    await clearKey(office);
    await setSource(office, true);
  });
  test.afterAll(async () => {
    // Leave the suite's server as it found it: no key, the source on.
    try {
      await clearKey(office);
      await setSource(office, true);
    } finally {
      await office.context().close().catch(() => {});
      if (!process.env.E2E_KEEP) rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("Back Office, Clés: Fantastic.jobs and its FANTASTIC_JOBS_API_KEY are listed, with source, fingerprint and who changed it when", async () => {
    await office.goto("/admin/cles");
    await expect(keyRow(office)).toHaveCount(1);
    await expect(keyRow(office)).toContainText(keys.providers["fantastic-jobs"]);
    await expect(keyRow(office)).toContainText(keys.sources.missing);
    await expect(keyRow(office)).toContainText(keys.missingHelp);
    expect(keys.intro).toContain("Fantastic.jobs");

    // A key its provider refuses is not saved, and is shown nowhere.
    const refused = `e2e-fj-refused-${runId}`;
    await replaceKey(office, refused);
    await expect(office.getByRole("main").getByRole("alert").first()).toHaveText(tr(keys.errors.test_failed, { name: NAME }));
    await expect(office.getByRole("main").getByRole("alert").nth(1)).toHaveText(tr(keys.status, { status: "401" }));
    await expect(keyRow(office)).toContainText(keys.sources.missing);
    expect(await office.content()).not.toContain(refused);

    // A key that passes the connection test is saved: source, fingerprint, who and when; never its value.
    await replaceKey(office, VALID_KEY);
    await expect(office.getByRole("main").getByRole("status")).toHaveText(tr(keys.saved, { name: NAME }));
    await expect(keyRow(office)).toContainText(keys.sources.database);
    await expect(keyRow(office)).toContainText(`…${VALID_KEY.slice(-4)}`);
    await expect(keyRow(office)).toContainText(SUPER_ADMIN);
    await expect(keyRow(office).locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
    expect(await office.content()).not.toContain(VALID_KEY);

    // Its connection test, on the key in use.
    await keyRow(office).getByRole("button", { name: tr(keys.test, { name: NAME }) }).click();
    await expect(office.getByRole("main").getByRole("status")).toHaveText(tr(keys.testPassed, { name: NAME }));

    // Replaced by a key the provider refuses, saved anyway: its test now fails.
    await replaceKey(office, refused, { saveAnyway: true });
    await expect(office.getByRole("main").getByRole("status")).toHaveText(tr(keys.savedUntested, { name: NAME }));
    await keyRow(office).getByRole("button", { name: tr(keys.test, { name: NAME }) }).click();
    await expect(office.getByRole("main").getByRole("alert").first()).toHaveText(tr(keys.testFailed, { name: NAME }));

    await office.goto("/admin/journal?section=provider_secrets");
    await expect(office.getByRole("row").filter({ hasText: NAME }).first()).toContainText(SUPER_ADMIN);
    expect(await office.content()).not.toContain(VALID_KEY);

    await clearKey(office);
  });

  test("Back Office, Sites: the Fantastic.jobs source is listed with its toggle", async () => {
    await office.goto("/admin/sites");
    await expect(sourceRow(office)).toHaveCount(1);
    await expect(sourceRow(office).getByRole("cell").first()).toHaveText(sites.enabled);

    await sourceRow(office).getByRole("button", { name: tr(sites.disable, { name: SOURCE_NAME }), exact: true }).click();
    await expect(sourceRow(office).getByRole("cell").first()).toHaveText(sites.disabled);
    expect((await query<{ enabled: boolean }>("SELECT enabled FROM job_discovery_source WHERE source = 'fantastic_jobs'"))[0]?.enabled).toBe(false);

    await sourceRow(office).getByRole("button", { name: tr(sites.enable, { name: SOURCE_NAME }), exact: true }).click();
    await expect(sourceRow(office).getByRole("cell").first()).toHaveText(sites.enabled);
    expect((await query<{ enabled: boolean }>("SELECT enabled FROM job_discovery_source WHERE source = 'fantastic_jobs'"))[0]?.enabled).toBe(true);
  });

  test("with the key set and the source enabled, a Job Search returns Job Offers from Fantastic.jobs, dated by their Posting date", async ({ page }) => {
    const run = await jobSearchRun(page, { fj: "ok" }, "offers");

    expect(run.fantasticJobsRequests).toHaveLength(1);
    const search = run.fantasticJobsRequests[0]!;
    expect(search.headers.authorization).toBe(`Bearer ${ENV_KEY}`);
    expect(new URL(search.url).pathname).toBe("/v1/active-ats");
    const params = new URL(search.url).searchParams;
    expect(params.get("title")).toBe("Directrice administrative et financière");
    expect(params.get("location")).toBe("Lyon");

    expect(run.stored.map((offer) => offer.source_url)).toEqual([1, 2, 3].map((n) => `https://ats-e2e.example/fantastic/${run.tag}/${n}`));
    for (const offer of run.stored) {
      expect(offer.title).toContain(`réf. ${run.tag}`);
      // Posting date = the job's date_posted (2 days ago).
      const ageDays = (Date.now() - offer.posted_at!.getTime()) / 86_400_000;
      expect(ageDays).toBeGreaterThan(1.9);
      expect(ageDays).toBeLessThan(2.5);
    }
    // The jobs are API answers: their ATS pages are never fetched. The web search goes on after them.
    expect(run.atsPages).toHaveLength(0);
    expect(run.webSearches.length).toBeGreaterThanOrEqual(1);
    expect(run.metrics.funnel.afterDedup).toBeGreaterThan(3);

    // The Candidate sees them on the Job Search page.
    await page.goto(`/recherches/${run.id}`);
    await expect(page.getByText(/Chef de projet Assurance Qualité Système \(F\/H\) – Fantastic 1/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("Job Offers already stored are not stored again: a second Job Search over the same postings finds them stored", async ({ page, browser }) => {
    const tag = `${runId}dedup`;
    const first = await jobSearchRun(page, { fj: "ok", tag }, "dedup1");
    expect(first.stored).toHaveLength(3);
    expect(first.metrics.fantasticJobs).toMatchObject({ status: "searched", offers: 3 });

    const second = await browser.newContext({ baseURL: origin, locale: "en-US" });
    try {
      const again = await jobSearchRun(await second.newPage(), { fj: "ok", tag }, "dedup2");
      expect(again.stored).toHaveLength(3);
      expect(again.stored.map((offer) => offer.source_url)).toEqual(first.stored.map((offer) => offer.source_url));
      expect(again.metrics.fantasticJobs).toMatchObject({ status: "searched", offers: 3 });
      expect(again.metrics.funnel.alreadyStored).toBeGreaterThanOrEqual(3);
      expect(again.atsPages).toHaveLength(0);
      const rows = await query<{ n: string }>("SELECT count(*) AS n FROM job_offer WHERE source_url LIKE $1", [`https://ats-e2e.example/fantastic/${tag}/%`]);
      expect(Number(rows[0]!.n)).toBe(3);
    } finally {
      await second.close();
    }
  });

  /** Fantastic.jobs' row of Back Office's Consommation IA (external APIs): calls so far and their estimated cost in €. */
  async function externalUsage(): Promise<{ calls: number; costEur: number }> {
    await office.goto("/admin/consommation-ia");
    const rows = office.getByRole("table", { name: admin.aiUsage.externalCaption }).getByRole("row").filter({ has: office.getByRole("rowheader", { name: "fantastic_jobs" }) });
    if ((await rows.count()) === 0) return { calls: 0, costEur: 0 };
    const cells = await rows.first().getByRole("cell").allInnerTexts();
    // cells: operation, calls, failures, cost ("0,096 €")
    return { calls: Number(cells[1]!.replace(/\D/g, "")), costEur: Number(cells[3]!.replace(/[^\d,.]/g, "").replace(",", ".")) };
  }

  test("the metrics show calls, Job Offers kept and estimated cost: in the Job Search, the worker log and Back Office's Consommation IA", async ({ page }) => {
    const before = await externalUsage();
    const run = await jobSearchRun(page, { fj: "ok", count: 3 }, "metrics");

    // 3 jobs charged at the default 0.008 € each, kept apart from the AI calls' cost.
    expect(run.metrics.fantasticJobs).toEqual({ status: "searched", offers: 3, calls: 1, costEur: 0.024 });
    expect(run.output()).toMatch(/\[job-discovery\] profile [0-9a-f-]+: .*Fantastic\.jobs searched \(3 Job Offer\(s\), 1 call\(s\)/);

    // The call and its estimated cost are in the external APIs of the AI consumption page, under fantastic_jobs.
    await expect.poll(async () => (await externalUsage()).calls - before.calls, { timeout: 15_000 }).toBe(1);
    const after = await externalUsage();
    expect(after.costEur - before.costEur).toBeCloseTo(0.024, 3);
  });

  test("without a key, Fantastic.jobs is off: never called, reported as off, the run goes on", async ({ page }) => {
    const run = await jobSearchRun(page, { fj: "ok", envKey: "" }, "nokey");

    expect(run.fantasticJobsRequests).toHaveLength(0);
    expect(run.stored).toHaveLength(0);
    expect(run.metrics.fantasticJobs).toEqual({ status: "off", offers: 0, calls: 0, costEur: 0 });
    expect(run.output()).not.toContain("Fantastic.jobs searched");
    expect(run.metrics.funnel.afterDedup).toBeGreaterThan(0);
  });

  test("with the key set but the source disabled in the Back Office, Fantastic.jobs is off: no call made", async ({ page }) => {
    await setSource(office, false);
    try {
      const run = await jobSearchRun(page, { fj: "ok" }, "disabled");

      expect(run.fantasticJobsRequests).toHaveLength(0);
      expect(run.stored).toHaveLength(0);
      expect(run.metrics.fantasticJobs).toEqual({ status: "off", offers: 0, calls: 0, costEur: 0 });
      expect(run.metrics.funnel.afterDedup).toBeGreaterThan(0);
    } finally {
      await setSource(office, true);
    }
  });

  for (const scenario of [
    { name: "the key rejected (401)", fj: "key-rejected", status: "refused", offers: 0 },
    { name: "the quota exhausted (429)", fj: "quota", status: "refused", offers: 0 },
    { name: "Fantastic.jobs failing (500)", fj: "failed", status: "failed", offers: 0 },
  ] as const) {
    test(`${scenario.name} is reported as ${scenario.status} and the run goes on with the other sources`, async ({ page }) => {
      const run = await jobSearchRun(page, { fj: scenario.fj }, `x${scenario.fj}`);

      expect(run.fantasticJobsRequests).toHaveLength(1);
      expect(run.metrics.fantasticJobs).toEqual({ status: scenario.status, offers: scenario.offers, calls: 1, costEur: 0 });
      expect(run.stored).toHaveLength(0);
      expect(run.output()).toContain(`Fantastic.jobs ${scenario.status}`);
      // The Job Search is done (jobSearchRun waited for it) and the web search carried on.
      expect(run.webSearches.length).toBeGreaterThanOrEqual(1);
      expect(run.metrics.funnel.afterDedup).toBeGreaterThan(0);
    });
  }

  test("the key entered in the Back Office is used by the worker over the environment's", async ({ page }) => {
    await replaceKey(office, VALID_KEY);
    await expect(office.getByRole("main").getByRole("status")).toHaveText(tr(keys.saved, { name: NAME }));
    try {
      // The fake accepts only the Back Office's key: the environment's is a different, wrong one.
      const run = await jobSearchRun(page, { fj: "ok", envKey: ENV_KEY, acceptedKey: VALID_KEY }, "backoffice");

      expect(run.fantasticJobsRequests).toHaveLength(1);
      expect(run.fantasticJobsRequests[0]!.headers.authorization).toBe(`Bearer ${VALID_KEY}`);
      expect(run.metrics.fantasticJobs).toMatchObject({ status: "searched", offers: 3 });
      expect(run.stored).toHaveLength(3);
      expect(run.output()).not.toContain(VALID_KEY);
    } finally {
      await clearKey(office);
    }
  });

  test("a key entered in the Back Office alone, with none in the environment, turns Fantastic.jobs on", async ({ page }) => {
    await replaceKey(office, VALID_KEY);
    await expect(office.getByRole("main").getByRole("status")).toHaveText(tr(keys.saved, { name: NAME }));
    try {
      const run = await jobSearchRun(page, { fj: "ok", envKey: "", acceptedKey: VALID_KEY }, "bokey");

      expect(run.fantasticJobsRequests).toHaveLength(1);
      expect(run.fantasticJobsRequests[0]!.headers.authorization).toBe(`Bearer ${VALID_KEY}`);
      expect(run.metrics.fantasticJobs).toMatchObject({ status: "searched", offers: 3 });
    } finally {
      await clearKey(office);
    }
  });
});

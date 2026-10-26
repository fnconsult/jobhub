import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #399: Brave's and Tavily's keys are Provider Secrets, and a missing key of the active Search provider only makes
// web search unavailable. Driven through the public entry points: the Back Office's Paramètres of the built web app (Brave's
// and Tavily's sheets on its Recherche web tab, #396)
// (its connection tests answered by e2e/support/fake-search-providers.mjs), a Job Search started over its HTTP API, and
// the real worker (apps/worker, `tsx src/main.ts`) on the same database, its web searches routed to Brave and answered
// by e2e/support/fake-job-sites.mjs, which logs every request the worker sends.
//
// One spec holds the Back Office and the worker scenarios: both change the one BRAVE_SEARCH_API_KEY row of the suite's
// database, which no other spec may see change meanwhile.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const keys = fr.admin.providerSecrets;
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const SUPER_ADMIN = "search-keys-office@e2e.jobbbox.test";
const NAME = "BRAVE_SEARCH_API_KEY";
const SECRETS_MASTER_KEYS = "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA="; // as in playwright.config.ts
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-search-keys-${runId}`);
const VALID_KEY = `e2e-brave-valid-${runId}`;

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

/** A Search provider's sheet, on Paramètres' Recherche web tab (#396, formerly Clés), and a key there. */
const sheetHref = (provider: string) => `/admin/parametres?tab=recherche-web&fournisseur=${provider}`;
const SHEET = sheetHref("brave");
const sheetOf = (page: Page, provider = "brave") => page.locator(`aside[data-sheet="${provider}"]`);
const keyRow = (page: Page, name = NAME, provider = "brave") => sheetOf(page, provider).locator(`[data-key="${name}"]`);

async function replaceKey(page: Page, value: string) {
  await page.goto(SHEET);
  await page.locator("summary", { hasText: tr(keys.replaceLegend, { name: NAME }) }).click();
  await page.getByLabel(tr(keys.newValue, { name: NAME })).fill(value);
  await page.getByRole("button", { name: tr(keys.replace, { name: NAME }) }).click();
}

async function clearKey(page: Page) {
  await page.goto(SHEET);
  const clear = page.getByRole("button", { name: tr(keys.clear, { name: NAME }) });
  if (await clear.count()) await clear.click();
  await expect(keyRow(page)).toContainText(keys.sources.missing);
}

// --- The worker ----------------------------------------------------------------------------------------------

/** The worker, its web searches on Brave, whose key neither its environment nor (yet) the database has. */
function startWorker(requestLog: string) {
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
      AI_WEB_SEARCH_PROVIDER: "brave",
      MISTRAL_API_KEY: "e2e-mistral-key",
      // Whatever the machine's .env sets must not leak into the scenario.
      PERPLEXITY_API_KEY: "",
      BRAVE_SEARCH_API_KEY: "",
      TAVILY_API_KEY: "",
      JOB_DISCOVERY_BUDGET_JOB_OFFERS: "",
      JOB_DISCOVERY_BUDGET_EUR: "",
      JOB_DISCOVERY_BUDGET_SECONDS: "",
      FRANCE_TRAVAIL_CLIENT_ID: "",
      FRANCE_TRAVAIL_CLIENT_SECRET: "",
      FANTASTIC_JOBS_API_KEY: "",
      E2E_DISCOVERY_TAG: runId,
      E2E_DISCOVERY_LOG: requestLog,
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (output += chunk));
  return {
    output: () => output,
    async stop() {
      if (worker.exitCode !== null) return;
      const exited = new Promise((resolve) => worker.once("exit", resolve));
      worker.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    },
  };
}

/** One Job Search of a new Candidate, worked by the running worker until done; the requests the worker sent meanwhile. */
async function jobSearch(page: Page, label: string, requestLog: string, output: () => string) {
  await signInWithMagicLink(page, newAddress(`search-keys-${label}`));
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  const profileId = (await created.json()).id as string;
  const logged = () => (existsSync(requestLog) ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LoggedRequest) : []);
  const before = logged().length;

  const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
  expect(started.status(), await started.text()).toBe(201);
  const { id } = (await started.json()) as { id: string };
  await expect
    .poll(async () => (await query<{ status: string }>("SELECT status FROM job_search WHERE id = $1", [id]))[0]?.status, { timeout: 90_000, message: output() })
    .toBe("done");
  const requests = logged().slice(before);
  return { requests, braveSearches: requests.filter((request) => new URL(request.url).hostname === "api.search.brave.com") };
}

test.describe("Brave's and Tavily's keys as Provider Secrets; a missing search key only disables web search (#399)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  let office: Page;

  test.beforeAll(async ({ browser }) => {
    mkdirSync(workDir, { recursive: true });
    office = await adminPage(browser);
    await clearKey(office);
  });
  test.afterAll(async () => {
    // Leave the suite's server as it found it: no Brave key.
    try {
      await clearKey(office);
    } finally {
      await office.context().close().catch(() => {});
      if (!process.env.E2E_KEEP) rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("Back Office, Paramètres: on Brave's sheet, entering a key tests it with Brave and saves it; Tavily's sheet has its key too", async () => {
    await office.goto(sheetHref("tavily"));
    await expect(sheetOf(office, "tavily").getByRole("heading", { level: 2 })).toHaveText(keys.providers.tavily);
    await expect(keyRow(office, "TAVILY_API_KEY", "tavily")).toContainText(keys.sources.missing);
    await office.goto(SHEET);
    await expect(sheetOf(office).getByRole("heading", { level: 2 })).toHaveText(keys.providers.brave);
    await expect(keyRow(office)).toHaveCount(1);
    await expect(keyRow(office)).toContainText(keys.sources.missing);

    // A key Brave refuses is not saved, and is shown nowhere.
    const refused = `e2e-brave-refused-${runId}`;
    await replaceKey(office, refused);
    await expect(sheetOf(office).getByRole("alert").first()).toHaveText(tr(keys.errors.test_failed, { name: NAME }));
    await expect(sheetOf(office).getByRole("alert").nth(1)).toHaveText(tr(keys.status, { status: "401" }));
    await expect(keyRow(office)).toContainText(keys.sources.missing);
    expect(await office.content()).not.toContain(refused);

    // A key that passes its connection test is saved: source and fingerprint, never its value.
    await replaceKey(office, VALID_KEY);
    await expect(sheetOf(office).getByRole("status")).toHaveText(tr(keys.saved, { name: NAME }));
    await expect(keyRow(office)).toContainText(keys.sources.database);
    await expect(keyRow(office)).toContainText(`…${VALID_KEY.slice(-4)}`);
    expect(await office.content()).not.toContain(VALID_KEY);
    await keyRow(office).getByRole("button", { name: tr(keys.test, { name: NAME }) }).click();
    await expect(sheetOf(office).getByRole("status")).toHaveText(tr(keys.testPassed, { name: NAME }));

    await clearKey(office);
  });

  test("the worker runs Job Searches without the key, its web search skipped, and uses the key once entered, without a restart", async ({ page, browser }) => {
    const requestLog = path.join(workDir, "requests.jsonl");
    const worker = startWorker(requestLog);
    try {
      await expect.poll(worker.output, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);

      // No key anywhere: the Job Search is done, its web search skipped like a disabled source.
      const without = await jobSearch(page, "without", requestLog, worker.output);
      expect(without.braveSearches).toHaveLength(0);
      expect(worker.output()).toContain("the web search is unavailable");
      expect(worker.output()).toContain("[worker] Job discovery runs without the web search");
      expect(worker.output()).not.toContain("Job discovery is unavailable");

      // Entered in the Back Office while the worker runs: in use within seconds (NOTIFY), no restart.
      await replaceKey(office, VALID_KEY);
      await expect(sheetOf(office).getByRole("status")).toHaveText(tr(keys.saved, { name: NAME }));
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      const second = await browser.newContext({ baseURL: origin, locale: "en-US" });
      try {
        const withKey = await jobSearch(await second.newPage(), "with", requestLog, worker.output);
        expect(withKey.braveSearches.length).toBeGreaterThanOrEqual(1);
        for (const search of withKey.braveSearches) expect(search.headers["x-subscription-token"]).toBe(VALID_KEY);
        // The pages Brave found were read: the run searched the web.
        expect(withKey.requests.some((request) => new URL(request.url).hostname.endsWith("e2e.example"))).toBe(true);
      } finally {
        await second.close();
      }
      // The key is never logged.
      expect(worker.output()).not.toContain(VALID_KEY);
    } finally {
      await worker.stop();
    }
  });
});

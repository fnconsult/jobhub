import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #402: the web search's bounded settings are set on Paramètres' Recherche web tab, a value out of its bounds
// refused with the reason, and a running worker's next Job Search searches with them, without a restart. Driven through
// the public entry points: the built web app's Paramètres, then the worker (apps/worker, `tsx src/main.ts`) working the
// "job-discovery.run" queue on the app's database. The outside world is e2e/support/fake-job-sites.mjs, which logs every
// request the worker sends: Perplexity's Search API is asked for as many results as the setting says.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.admin.platformSettings;
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
// Its own permanent super-admin (playwright.config.ts).
const SUPER_ADMIN = "web-search-settings-office@e2e.jobbbox.test";
const SETTING = "JOB_DISCOVERY_RESULTS_PER_QUERY";
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-web-search-settings-${runId}`);
const requestLog = path.join(workDir, "requests.jsonl");

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const row = (page: Page, name: string) => page.locator(`tr[data-setting="${name}"]`);

const masterCv = {
  fullName: "Bianca Castafiore",
  headline: "Directrice financière",
  email: "bianca.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Quinze ans à la tête des finances d'un groupe.",
  experience: [],
  education: [],
  skills: ["Consolidation"],
  languages: [],
};
const searchCriteria = { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] };

let candidateId = "";
let profileId = "";

function startWorker(): { child: ChildProcess; output: () => string; stop: () => Promise<void> } {
  let output = "";
  const child = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
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
      // Whatever the machine's .env sets must not leak into the scenario: the Back Office's value is the one in use.
      [SETTING]: "",
      E2E_DISCOVERY_TAG: runId,
      E2E_DISCOVERY_LOG: requestLog,
      E2E_DISCOVERY_VOLUME_COUNT: "2",
      E2E_DISCOVERY_VOLUME_KIND: "jsonld",
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", (chunk) => (output += chunk));
  return {
    child,
    output: () => output,
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

/** The results each web search asked Perplexity's Search API for. */
function resultsAsked(): number[] {
  if (!existsSync(requestLog)) return [];
  return readFileSync(requestLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { url: string; body: string })
    .filter((request) => request.url.startsWith("https://api.perplexity.ai/"))
    .map((request) => (JSON.parse(request.body) as { max_results: number }).max_results);
}

test.describe("The web search's settings on Paramètres (#402)", () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async ({ browser }) => {
    mkdirSync(workDir, { recursive: true });
    const page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("web-search-settings"));
    candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;
    await page.close();
  });

  test.afterAll(async () => {
    // Whatever happens, the specs sharing this database find the setting as env and the code leave it.
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("DELETE FROM platform_setting WHERE name = $1", [SETTING]);
      await client.query("SELECT pg_notify('platform_settings_changed', '')");
    } finally {
      await client.end();
    }
    if (!process.env.E2E_KEEP) rmSync(workDir, { recursive: true, force: true });
  });

  test("changing results per query is used by the next Job Search; out-of-bounds value refused", async ({ browser }) => {
    // The worker project has no base URL: the Back Office's page names the web app's.
    const page = await browser.newPage({ baseURL: origin });
    const worker = startWorker();
    const reports = () => worker.output().split("\n").filter((line) => line.startsWith(`[job-discovery] profile ${profileId}:`));
    try {
      await expect.poll(() => worker.output(), { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
      // A first Job Search, with the code's default: 20 results a query.
      await enqueueDiscovery();
      await expect.poll(() => reports().length, { timeout: 90_000, message: worker.output() }).toBe(1);
      expect(resultsAsked().length).toBeGreaterThan(0);
      expect(new Set(resultsAsked())).toEqual(new Set([20]));

      // On Paramètres' Recherche web tab: out of its bounds, refused with the reason; within them, saved.
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto("/admin/parametres?tab=recherche-web");
      const setting = row(page, SETTING);
      const field = setting.getByRole("textbox", { name: tr(texts.newValue, { name: SETTING }) });
      await expect(setting).toContainText(tr(texts.accepted, { rule: tr(texts.rules.whole, { min: "5", max: "20" }) }));
      await field.fill("25");
      await setting.getByRole("button", { name: texts.save }).click();
      await expect(page.getByRole("alert").filter({ hasText: SETTING })).toHaveText(tr(texts.notices.invalid, { name: SETTING, rule: tr(texts.rules.whole, { min: "5", max: "20" }) }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText("20");

      await field.fill("8");
      await setting.getByRole("button", { name: texts.save }).click();
      await expect(page.getByRole("status").filter({ hasText: SETTING })).toHaveText(tr(texts.notices.saved, { name: SETTING }));
      await expect(setting.getByRole("cell").nth(0)).toHaveText("8");

      // NOTIFY reaches the worker within seconds; the next Job Search asks for 8 results a query.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const before = resultsAsked().length;
      await enqueueDiscovery();
      await expect.poll(() => reports().length, { timeout: 90_000, message: worker.output() }).toBe(2);
      const next = resultsAsked().slice(before);
      expect(next.length).toBeGreaterThan(0);
      expect(new Set(next)).toEqual(new Set([8]));
    } finally {
      await worker.stop();
      await page.close();
    }
  });
});

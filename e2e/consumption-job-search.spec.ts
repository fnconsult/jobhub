import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { startJobSearch } from "./support/conversation";
import { newAddress } from "./support/mailbox";
import { parisDay } from "./support/paris-days";
import { subscribe } from "./support/plan";

// Issue #799 (ADR-0091), « A Job Search stopped empty, whose quota use is given back, leaves `jobSearch` where it was »:
// driven as e2e/job-search-stop.spec.ts does, through the built web app (« Lancer une recherche », POST
// /api/job-searches/[id]/stop) and the real worker, then read through the Data export (GET /api/account/export).
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-consumption-search-${tag}`);

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
      E2E_DISCOVERY_TAG: `${tag}s`,
      E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
      E2E_SEARCH_DOWN_FLAG: path.join(workDir, "perplexity-down"),
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

async function jobSearchRow(id: string) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT status, job_offer_ids, stop_requested_at FROM job_search WHERE id = $1", [id]);
    return rows[0] as { status: string; job_offer_ids: string[]; stop_requested_at: Date | null };
  } finally {
    await client.end();
  }
}

/** What the Data export's `consumption` section holds for `jobSearch` today. */
async function jobSearchCount(page: Page): Promise<number> {
  const exported = await (await page.request.get("/api/account/export")).json();
  return (exported.consumption as { day: string; tool: string; count: number }[]).filter((row) => row.tool === "jobSearch" && row.day === parisDay(0)).reduce((sum, row) => sum + row.count, 0);
}

test.describe("Consumption: a Job Search stopped empty (#799)", () => {
  test.describe.configure({ timeout: 180_000 });

  test.afterAll(async () => {
    await stopWorker();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("its use is counted when it starts, and given back with its Plan Quota use when it is stopped before finding any offer", async ({ page }) => {
    mkdirSync(workDir, { recursive: true });
    const email = newAddress("consumption-search");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    expect(await jobSearchCount(page)).toBe(0);

    // No worker yet: the Candidate stops the search before Job discovery began.
    const jobSearchId = await startJobSearch(page);
    expect(await jobSearchCount(page)).toBe(1);
    await page.goto(`/recherches/${jobSearchId}`);
    await page.getByRole("button", { name: "Arrêter la recherche", exact: true }).click();
    await expect.poll(async () => (await jobSearchRow(jobSearchId)).stop_requested_at).not.toBeNull();

    await startWorker();
    await expect.poll(async () => (await jobSearchRow(jobSearchId)).status, { timeout: 90_000, message: workerOutput }).toBe("stopped");
    expect((await jobSearchRow(jobSearchId)).job_offer_ids).toEqual([]);

    // The quota use went back, and so did the count: `jobSearch` is where it was.
    expect(await jobSearchCount(page)).toBe(0);
  });
});

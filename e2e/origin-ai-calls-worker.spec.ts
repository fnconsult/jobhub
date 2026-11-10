import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #919: the AI calls the worker makes are recorded with the `worker` Surface (« Tâches de fond » in the « Origine »
// filter of Appels IA). Driven as e2e/job-search-metrics.spec.ts does: a Job Search started over HTTP and worked by the real
// worker (apps/worker), which reads a plain offer page with AI (task offer_analysis, faked in-process by fake-mistral.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const SUPER_ADMIN = "origin-worker-office@e2e.jobbbox.test";
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-origin-worker-${tag}`);

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

let worker: ChildProcess | undefined;
let workerOutput = "";

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

test.describe("Origine of the worker's AI calls (#919)", () => {
  test.describe.configure({ timeout: 180_000 });

  test.afterAll(async () => {
    if (worker && worker.exitCode === null) {
      const exited = new Promise((resolve) => worker!.once("exit", resolve));
      worker.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  test("the AI calls of a Job Search worked by the worker are recorded `worker`, and listed under « Tâches de fond »", async ({ page, browser }) => {
    mkdirSync(workDir, { recursive: true });
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
        E2E_DISCOVERY_TAG: tag,
        E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
        E2E_SEARCH_DOWN_FLAG: path.join(workDir, "perplexity-down"),
        NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
    await expect.poll(() => workerOutput, { timeout: 90_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);

    const email = newAddress("origin-worker");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard");
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    const startedAt = new Date();
    const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId: (await created.json()).id } });
    expect(started.status(), await started.text()).toBe(201);
    const { id } = (await started.json()) as { id: string };
    await expect
      .poll(async () => (await query<{ status: string }>("SELECT status FROM job_search WHERE id = $1", [id]))[0]?.status, { timeout: 120_000, message: workerOutput })
      .toBe("done");

    // The worker's AI calls: read from a page's text (offer_analysis) or scored. Every one carries `worker`, in both tables.
    const calls = await query<{ id: string; task: string; usage_surface: string | null; log_surface: string | null }>(
      `SELECT u.id, u.task, u.surface AS usage_surface, m.surface AS log_surface
         FROM ai_usage u JOIN ai_message_log m ON m.usage_id = u.id JOIN candidate c ON c.id = m.candidate_id
        WHERE lower(c.email) = lower($1) AND u.at >= $2 ORDER BY u.at`,
      [email, startedAt],
    );
    expect(calls.length, workerOutput).toBeGreaterThan(0);
    for (const call of calls) expect([call.task, call.usage_surface, call.log_surface]).toEqual([call.task, "worker", "worker"]);

    // Appels IA, filtered by « Tâches de fond » (and the Candidate): those calls, and only them.
    const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
    const office = await context.newPage();
    await signInWithMagicLink(office, SUPER_ADMIN);
    await office.goto(`/admin/activite/appels-ia?email=${encodeURIComponent(email)}&surface=worker`);
    await expect(office.getByLabel(admin.aiUsage.surface)).toHaveValue("worker");
    const rows = office.getByRole("table", { name: admin.aiMessages.caption }).getByRole("row").filter({ hasText: email });
    await expect(rows).toHaveCount(calls.length);
    await expect(rows.first()).toContainText(admin.aiUsage.surfaces.worker);
    await office.goto(`/admin/activite/appels-ia?email=${encodeURIComponent(email)}&surface=extension`);
    await expect(office.getByRole("table", { name: admin.aiMessages.caption })).toHaveCount(0);
    await context.close();
  });
});

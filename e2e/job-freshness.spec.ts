import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #116: the freshness rule, through the Candidate's public entry point. A Job Search started from
// the Profile page runs Job discovery in the real worker (apps/worker) on the same database; the fake web
// (e2e/support/fake-job-sites.mjs, freshness mode) offers three otherwise identical postings: one dated
// 3 days ago, one dated 45 days ago and one with no date, the undated one found first.
//  - dated within 30 days: kept and shown with its Posting date;
//  - dated older than 30 days: dropped, never shown;
//  - undated: kept, labelled "date inconnue", and ranked below the dated one at an equal Match Score.
// (The Job Digest label and the providers' freshness parameters are covered by job-digest.spec.ts and
// ai.spec.ts.)
const origin = process.env.E2E_WEB_ORIGIN!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-freshness-${tag}`);

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};
const searchCriteria = { targetRole: "Directeur financier", locations: ["Lyon"], contractTypes: ["cdi"] };

test.use({ baseURL: origin });

let worker: ChildProcess | undefined;
let workerOutput = "";

function startWorker() {
  // tsx itself, not `npx tsx`: on Linux npx does not pass SIGTERM on.
  worker = spawn(path.resolve("node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: path.resolve("apps/worker"),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: process.env.E2E_DATABASE_URL!,
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
      E2E_DISCOVERY_FRESHNESS: "1",
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
}

async function searchFromNewProfile(page: Page): Promise<void> {
  await signInWithMagicLink(page, newAddress("freshness"));
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  await page.goto(`/profils/${(await created.json()).id}`);
  await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
}

test.describe("Freshness rule in Job Search results (#116)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    mkdirSync(workDir, { recursive: true });
    startWorker();
    await expect.poll(() => workerOutput, { timeout: 90_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
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

  test("keeps a posting dated within 30 days, drops one dated older, keeps an undated one labelled 'date inconnue', ranked below the dated one at an equal Match Score", async ({ page }) => {
    await searchFromNewProfile(page);
    const results = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
    // Two of the three postings are kept; the page refreshes itself until the worker has finished.
    await expect(results, workerOutput).toHaveCount(2, { timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 2, name: `Directeur financier ancienne – réf. ${tag}` })).toHaveCount(0);

    const dated = results.filter({ hasText: `Directeur financier recente – réf. ${tag}` });
    const undated = results.filter({ hasText: `Directeur financier sansDate – réf. ${tag}` });
    await expect(dated).toHaveCount(1);
    await expect(undated).toHaveCount(1);

    // Dated: its Posting date, no "date inconnue". Undated: the label, no date.
    await expect(dated.getByText(/^Publiée le \d{1,2} \S+ \d{4}$/)).toHaveCount(1);
    await expect(dated).not.toContainText("date inconnue");
    await expect(undated.getByText("date inconnue", { exact: true })).toBeVisible();

    // Equal Match Score (the postings differ only by title and date), found undated first: dated is listed first.
    const scores = (await page.getByText(/^Score de correspondance : \d+ \/ 100(, partiel)?$/).allTextContents()).map((t) => Number(/(\d+) \//.exec(t)![1]));
    expect(scores).toHaveLength(2);
    expect(scores[0], "precondition: equal Match Scores").toBe(scores[1]);
    const headings = await results.getByRole("heading", { level: 2 }).allTextContents();
    expect(headings).toEqual([`Directeur financier recente – réf. ${tag}`, `Directeur financier sansDate – réf. ${tag}`]);
  });
});

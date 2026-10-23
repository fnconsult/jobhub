import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #331: the Candidate stops a Job Search; a stopped or failed one keeps the Job Offers it had found, and one
// stopped before finding any gives its Plan Quota use back. Driven through the public entry points: the built web app
// in a browser (« Chercher des offres », then « Arrêter la recherche » on the Job Search's page, POST
// /api/job-searches/[id]/stop), and the real worker (apps/worker, `tsx src/main.ts`) running Job discovery on the same
// database. Perplexity, Mistral and the job sites are faked inside the worker by e2e/support/fake-job-sites.mjs, in
// volume mode with a delay on every page so the run lasts long enough to be stopped part-way.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-search-stop-${tag}`);
/** While this file exists, the faked Perplexity fails every web search (e2e/support/fake-job-sites.mjs). */
const searchDownFlag = path.join(workDir, "perplexity-down");

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

type Step = { kind: string; activity: string; tool?: string; task?: string; rule?: string; outcome: string; count: number };
type Event = { type: "step_started" | "step_ended"; id: number; step: Step };
type Notifications = { searching: boolean; running: { jobSearchId: string; steps: Event[] }[] };
type Row = { status: string; failure: string | null; provenance: { steps: Step[] } | null; progress: unknown; job_offer_ids: string[]; stop_requested_at: Date | null };

test.use({ baseURL: origin });

let worker: ChildProcess | undefined;
let workerOutput = "";
let profileId = "";
let scenario = 0;

/** A worker for a fresh set of postings (a Job Search finding only Job Offers already known runs in no time). */
async function freshWorker() {
  await stopWorker();
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
      JOB_DISCOVERY_BUDGET_JOB_OFFERS: "",
      JOB_DISCOVERY_BUDGET_EUR: "",
      JOB_DISCOVERY_BUDGET_SECONDS: "",
      E2E_DISCOVERY_TAG: `${tag}s${++scenario}`,
      E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
      E2E_SEARCH_DOWN_FLAG: searchDownFlag,
      // Four postings, each page taking 2.5 s to answer: the run lasts long enough to stop it part-way.
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

const rowOf = async (jobSearchId: string): Promise<Row> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT status, failure, provenance, progress, job_offer_ids, stop_requested_at FROM job_search WHERE id = $1", [jobSearchId]);
    return rows[0] as Row;
  } finally {
    await client.end();
  }
};

/** This week's Job Searches as /abonnement shows them, e.g. "1 sur 7". */
async function jobSearchesUsed(page: Page): Promise<string> {
  await page.goto("/abonnement");
  return (await page.locator("dl > div").filter({ has: page.getByText("Recherches d'offres", { exact: true }) }).locator("dd").innerText()).trim();
}

/** Clicks « Chercher des offres » for the Profile and returns the Job Search's id once on its page. */
async function startSearch(page: Page): Promise<string> {
  await page.goto(`/recherches?profil=${profileId}`);
  await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Waits until the worker has read at least one posting of the running Job Search (its live steps, as the pages poll them). */
async function untilAPostingIsRead(page: Page, jobSearchId: string) {
  await expect
    .poll(
      async () => {
        const state: Notifications = await (await page.request.get("/api/job-searches/notifications")).json();
        const running = state.running.find((search) => search.jobSearchId === jobSearchId);
        return running?.steps.filter((event) => event.type === "step_ended" && event.step.activity === "read" && event.step.outcome === "ok").length ?? 0;
      },
      { timeout: 60_000, message: workerOutput },
    )
    .toBeGreaterThan(0);
}

/** Clicks « Arrêter la recherche » on the Job Search's page, and waits until the stop is asked of the worker. */
async function stopFromItsPage(page: Page, jobSearchId: string) {
  await page.getByRole("button", { name: "Arrêter la recherche" }).click();
  await expect(page.getByRole("button", { name: "Arrêt en cours…" })).toBeVisible();
  await expect.poll(async () => (await rowOf(jobSearchId)).stop_requested_at).not.toBeNull();
}

/** The notifications of finished Job Searches, on a page other than the Job Search's own (which dismisses its notification once over). */
async function notificationsOnAnotherPage(page: Page) {
  await page.goto("/candidatures");
  return page.getByRole("list", { name: "Recherches d'offres terminées" });
}

async function untilOver(jobSearchId: string): Promise<Row> {
  await expect.poll(async () => (await rowOf(jobSearchId)).status, { timeout: 90_000, message: workerOutput }).not.toBe("searching");
  return rowOf(jobSearchId);
}

async function signedInCandidate(browser: Browser, label: string): Promise<Page> {
  const page = await browser.newPage({ baseURL: origin });
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  await subscribe(page, email, "standard");
  return page;
}

test.describe("Stopping a Job Search, and the Job Offers a stopped or failed one keeps (#331)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    mkdirSync(workDir, { recursive: true });
    page = await signedInCandidate(browser, "search-stop");
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;
  });

  test.afterAll(async () => {
    await page?.close();
    await stopWorker();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("Stop mid-search: status stopped, offers found so far linked, steps finished kept in the Provenance", async () => {
    const before = await jobSearchesUsed(page);
    await freshWorker();
    const jobSearchId = await startSearch(page);
    await untilAPostingIsRead(page, jobSearchId);

    await stopFromItsPage(page, jobSearchId);
    const notifications = await notificationsOnAnotherPage(page);

    const row = await untilOver(jobSearchId);
    expect(row.status, workerOutput).toBe("stopped");
    expect(row.stop_requested_at).not.toBeNull();
    expect(row.progress).toBeNull();
    // The offers found so far are linked; the run stopped before reading the four postings.
    expect(row.job_offer_ids.length, workerOutput).toBeGreaterThanOrEqual(1);
    expect(row.job_offer_ids.length).toBeLessThan(4);
    // The steps it finished are kept in its Provenance: the web search and the page reads, and its Match Scores.
    const steps = row.provenance!.steps;
    expect(steps.some((step) => step.activity === "web_search" && step.outcome === "ok"), JSON.stringify(steps)).toBe(true);
    expect(steps.some((step) => step.kind === "tool" && step.activity === "read" && step.outcome === "ok")).toBe(true);
    expect(steps.some((step) => step.kind === "rules" && step.rule === "match_score")).toBe(true);
    expect((await page.request.get("/api/job-searches/notifications").then((response) => response.json())).searching).toBe(false);

    // Any other page tells when it stopped, and that it kept them.
    await expect(notifications.getByText(/^Recherche arrêtée à \d{2}:\d{2} : \d offres? trouvées? pour « Directeur administratif et financier », gardées?\.$/)).toBeVisible({ timeout: 10_000 });

    // Its page shows it stopped, with the Job Offers kept.
    await page.goto(`/recherches/${jobSearchId}`);
    await expect(page.getByText("Arrêtée", { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`Vous avez arrêté cette recherche : (l'offre trouvée jusque-là est gardée|les ${row.job_offer_ids.length} offres trouvées jusque-là sont gardées)\\.`))).toBeVisible();
    await expect(page.getByRole("link", { name: "Lire l'offre" })).toHaveCount(row.job_offer_ids.length);
    await expect(page.getByRole("button", { name: "Arrêter la recherche" })).toHaveCount(0);

    // It counts in the week's Job Searches.
    const [usedBefore, of] = before.split(" sur ");
    expect(await jobSearchesUsed(page)).toBe(`${Number(usedBefore) + 1} sur ${of}`);
  });

  test("A stopped search with no offer gives its quota use back; with offers it counts", async () => {
    // No worker running: the Candidate stops the search before Job discovery began.
    await stopWorker();
    const before = await jobSearchesUsed(page);
    const jobSearchId = await startSearch(page);
    expect(await jobSearchesUsed(page)).not.toBe(before);
    await page.goto(`/recherches/${jobSearchId}`);
    await stopFromItsPage(page, jobSearchId);
    const notifications = await notificationsOnAnotherPage(page);

    await freshWorker();
    const row = await untilOver(jobSearchId);
    expect(row.status, workerOutput).toBe("stopped");
    expect(row.job_offer_ids).toEqual([]);

    await expect(notifications.getByText(/^Recherche arrêtée à \d{2}:\d{2} : aucune offre trouvée pour « Directeur administratif et financier »\.$/)).toBeVisible({ timeout: 10_000 });
    await expect(notifications.getByText("Elle n'est pas comptée dans vos recherches d'offres de la semaine.")).toBeVisible();
    // It kept no Job Offer: not counted. (The one stopped with Job Offers, above, counted.)
    expect(await jobSearchesUsed(page)).toBe(before);
  });

  test("A failed search keeps the offers it found (regression test)", async () => {
    await freshWorker();
    const jobSearchId = await startSearch(page);
    await untilAPostingIsRead(page, jobSearchId);
    // Perplexity goes down: the run's next web search fails, after the postings of the first were read.
    writeFileSync(searchDownFlag, "down");
    try {
      const notifications = await notificationsOnAnotherPage(page);
      const row = await untilOver(jobSearchId);
      expect(row.status, workerOutput).toBe("failed");
      expect(row.failure).toBe("discovery_failed");
      expect(row.job_offer_ids.length, "the Job Offers found before it failed are kept").toBeGreaterThanOrEqual(1);

      await expect(
        notifications.getByText(/^Recherche échouée à \d{2}:\d{2}, pendant la recherche sur le web : votre recherche d'offres pour « Directeur administratif et financier » n'a pas abouti\.$/),
      ).toBeVisible({ timeout: 10_000 });
      await expect(notifications.getByText(/^Les sites d'offres d'emploi n'ont pas pu être consultés\. (L'offre trouvée avant l'échec est gardée|Les \d offres trouvées avant l'échec sont gardées)\./)).toBeVisible();

      // Its page lists them.
      await page.goto(`/recherches/${jobSearchId}`);
      await expect(page.getByRole("link", { name: "Lire l'offre" })).toHaveCount(row.job_offer_ids.length);
    } finally {
      rmSync(searchDownFlag, { force: true });
    }
  });

  test("Another Candidate cannot stop it (403)", async ({ browser }) => {
    await stopWorker();
    const jobSearchId = await startSearch(page);
    const other = await signedInCandidate(browser, "search-stop-other");
    try {
      const refused = await other.request.post(`/api/job-searches/${jobSearchId}/stop`, { headers: { origin } });
      expect(refused.status()).toBe(403);
      const row = await rowOf(jobSearchId);
      expect(row.status).toBe("searching");
      expect(row.stop_requested_at).toBeNull();
    } finally {
      await other.close();
    }
    // Its own Candidate can.
    const stopped = await page.request.post(`/api/job-searches/${jobSearchId}/stop`, { headers: { origin } });
    expect(stopped.status()).toBe(202);
    await freshWorker();
    expect((await untilOver(jobSearchId)).status, workerOutput).toBe("stopped");
  });
});

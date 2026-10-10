import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #14: the Candidate asks the AI Coach to search for Job Offers for a
// Profile, from the Profile page or the Coach Panel, and saves results as
// Applications. Driven through the built web app in a browser, with the real
// worker (apps/worker, `tsx src/main.ts`) running Job discovery on the same
// database. Perplexity, Mistral and the job sites are faked inside the worker
// by e2e/support/fake-job-sites.mjs.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-job-search-${tag}`);
/** While this file exists, the faked Perplexity fails every web search (e2e/support/fake-job-sites.mjs). */
const searchDownFlag = path.join(workDir, "perplexity-down");

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
const searchCriteria = { targetRole: "Directrice administrative et financière", location: "Lyon", contractType: "cdi" };

test.use({ baseURL: origin });

let worker: ChildProcess | undefined;
let workerOutput = "";

function startWorker() {
  // tsx itself, not `npx tsx`: on Linux npx does not pass SIGTERM on, so afterAll would
  // leave this worker running, taking the next spec's jobs from the same queue.
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
      E2E_DISCOVERY_TAG: tag,
      E2E_DISCOVERY_LOG: path.join(workDir, "requests.jsonl"),
      E2E_SEARCH_DOWN_FLAG: searchDownFlag,
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
}

async function signInWithProfile(page: Page): Promise<string> {
  await signInWithMagicLink(page, newAddress("job-search"));
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id as string;
}

async function candidateIdOf(page: Page): Promise<string> {
  return (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
}

/** This month's Job Searches as /abonnement shows them, e.g. "1 sur 3". */
async function jobSearchesUsed(page: Page): Promise<string> {
  await page.goto("/abonnement");
  return (await page.locator("dl > div").filter({ has: page.getByText("Recherches d'offres", { exact: true }) }).locator("dd").innerText()).trim();
}

/** Clicks "Chercher des offres" on the Profile page and returns the Job Search's id once on its page. */
async function searchFromProfile(page: Page, profileId: string): Promise<string> {
  await page.goto(`/profils/${profileId}`);
  await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** The worker's "failed" report lines for this Profile's Job discovery runs. */
const failedRuns = (profileId: string) => workerOutput.split("\n").filter((line) => line.startsWith(`[job-discovery] profile ${profileId}: failed`)).length;

/** The Match Scores shown on a Job Search page, top to bottom. */
async function shownScores(page: Page): Promise<number[]> {
  const texts = await page.getByText(/^Score de correspondance : \d+ \/ 100$/).allTextContents();
  return texts.map((text) => Number(/(\d+) \//.exec(text)![1]));
}

test.describe("On-demand AI Coach job search", () => {
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

  test("starts from a Profile, shows the Job Offers found by Match Score with their key facts, and saves one in one click", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    await page.goto(`/profils/${profileId}`);

    await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();

    await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Offres trouvées pour « ${searchCriteria.targetRole} »`);
    // The page refreshes itself until the worker has finished.
    const results = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(results, workerOutput).toHaveCount(2, { timeout: 90_000 });

    const scores = await shownScores(page);
    expect(scores).toHaveLength(2);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const daf = results.filter({ hasText: `Directeur administratif et financier (H/F) – réf. ${tag}` });
    await expect(daf).toContainText("Acme Industrie");
    await expect(daf).toContainText("Lyon");
    await expect(daf).toContainText("De 110 000 à 130 000 € brut par an");
    await expect(daf).toContainText("carrieres.acme-e2e.example");

    await daf.getByRole("button", { name: "Enregistrer en candidature" }).click();
    await expect(daf.getByText("Enregistrée dans vos candidatures.")).toBeVisible();
    await daf.getByRole("link", { name: "Voir ma candidature" }).click();
    await expect(page).toHaveURL(/\/candidatures\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Directeur administratif et financier (H/F) – réf. ${tag}`);
    await expect(page.getByLabel("Profil utilisé")).toHaveValue(profileId);
  });

  test("starts from the Coach Panel, for the Profile in view", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    await page.goto(`/profils/${profileId}`);
    await page.getByRole("button", { name: "Mon coach" }).click();

    await page.getByRole("complementary").getByRole("button", { name: "Chercher des offres pour ce profil" }).click();

    await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Offres trouvées pour « ${searchCriteria.targetRole} »`);
    await expect(page.getByText(/^Score de correspondance : \d+ \/ 100$/).first()).toBeVisible({ timeout: 90_000 });
  });

  // Issue #74: only a Job Search that can run counts against the Plan Quota.
  test("a Job Search that finds Job Offers uses one Job Search of the Plan Quota", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    expect(await jobSearchesUsed(page)).toBe("0 sur 3");

    await searchFromProfile(page, profileId);
    const results = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(results, workerOutput).toHaveCount(2, { timeout: 90_000 });

    expect(await jobSearchesUsed(page)).toBe("1 sur 3");
  });

  test("a Job Search the worker records as failed gives its use back, once, even if reported failed again", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    const candidateId = await candidateIdOf(page);
    // One search that works, so the count has something to lose if a failure were given back twice.
    await searchFromProfile(page, profileId);
    await expect(page.getByText(/^Score de correspondance : \d+ \/ 100$/).first(), workerOutput).toBeVisible({ timeout: 90_000 });
    expect(await jobSearchesUsed(page)).toBe("1 sur 3");

    writeFileSync(searchDownFlag, "");
    try {
      const jobSearchId = await searchFromProfile(page, profileId);
      await expect(page.getByText("La recherche n'a pas abouti. Réessayez dans quelques instants."), workerOutput).toBeVisible({ timeout: 90_000 });
      await expect.poll(() => failedRuns(profileId), { message: workerOutput }).toBe(1);
      expect(await jobSearchesUsed(page)).toBe("1 sur 3");

      // The same Job discovery runs again (a redelivered job) and fails again: nothing more is given back.
      const boss = new PgBoss({ connectionString: databaseUrl });
      await boss.start();
      try {
        await boss.send("job-discovery.run", { candidateId, profileId, jobSearchId });
      } finally {
        await boss.stop({ graceful: false });
      }
      await expect.poll(() => failedRuns(profileId), { timeout: 60_000, message: workerOutput }).toBe(2);
      expect(await jobSearchesUsed(page)).toBe("1 sur 3");
      await page.goto(`/recherches/${jobSearchId}`);
      await expect(page.getByText("La recherche n'a pas abouti. Réessayez dans quelques instants.")).toBeVisible();
    } finally {
      rmSync(searchDownFlag, { force: true });
    }
  });

  test("a Job Search that cannot be queued for the worker shows as failed and leaves the Plan Quota unchanged", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    const candidateId = await candidateIdOf(page);
    expect(await jobSearchesUsed(page)).toBe("0 sur 3");

    // The job queue refuses this Candidate's Job discovery, as an unreachable queue would.
    const trigger = `e2e_refuse_${tag}`;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`
        CREATE FUNCTION pgboss.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.name = 'job-discovery.run' AND NEW.data->>'candidateId' = '${candidateId}' THEN
            RAISE EXCEPTION 'e2e: job queue unavailable';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER ${trigger} BEFORE INSERT ON pgboss.job FOR EACH ROW EXECUTE FUNCTION pgboss.${trigger}();
      `);

      await searchFromProfile(page, profileId);
      await expect(page.getByText("La recherche n'a pas abouti. Réessayez dans quelques instants.")).toBeVisible();
      expect(await jobSearchesUsed(page)).toBe("0 sur 3");
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON pgboss.job; DROP FUNCTION IF EXISTS pgboss.${trigger}();`);
      await client.end();
    }
  });

  test("stops a Free Candidate at the Plan Quota of Job Searches with an Upgrade Prompt, without searching", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    const searches: string[] = [];
    for (let i = 0; i < 3; i++) {
      const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
      expect(started.status(), await started.text()).toBe(201);
      searches.push((await started.json()).id);
    }
    // Let this worker finish them, so no Job discovery is left queued for the next spec's worker.
    for (const id of searches) {
      await expect
        .poll(async () => (await (await page.request.get(`/recherches/${id}`)).text()).includes("Votre coach cherche des offres"), { timeout: 90_000 })
        .toBe(false);
    }
    await page.goto(`/profils/${profileId}`);

    await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();

    const prompt = page.getByRole("alert").filter({ hasText: "Vous avez atteint la limite de votre offre" });
    await expect(prompt).toContainText("Vous avez utilisé les 3 recherches d'offres comprises ce mois-ci dans l'offre Gratuite.");
    await expect(prompt.getByRole("link", { name: "Découvrir l'offre Standard" })).toHaveAttribute("href", "/abonnement");
    await expect(page).toHaveURL(new RegExp(`/profils/${profileId}$`));
  });
});

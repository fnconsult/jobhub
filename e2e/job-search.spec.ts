import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { placeInput, placeNames, placeOptions, removePlace, typePlace } from "./support/locations";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

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
const searchCriteria = { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] };

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

/** Signs a new Candidate in with one Profile; on the Free Plan (1 Job Search a week) unless `plan` says otherwise. */
async function signInWithProfile(page: Page, plan?: "standard"): Promise<string> {
  const email = newAddress("job-search");
  await signInWithMagicLink(page, email);
  if (plan) await subscribe(page, email, plan);
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id as string;
}

async function candidateIdOf(page: Page): Promise<string> {
  return (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
}

/** This week's Job Searches as /abonnement shows them, e.g. "1 sur 7". */
async function jobSearchesUsed(page: Page): Promise<string> {
  await page.goto("/abonnement");
  return (await page.locator("dl > div").filter({ has: page.getByText("Recherches d'offres", { exact: true }) }).locator("dd").innerText()).trim();
}

/** Clicks "Chercher des offres" on Recherches d'offres for the Profile and returns the Job Search's id once on its page. */
async function searchFromProfile(page: Page, profileId: string): Promise<string> {
  await page.goto(`/recherches?profil=${profileId}`);
  await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** The worker's "failed" report lines for this Profile's Job discovery runs. */
const failedRuns = (profileId: string) => workerOutput.split("\n").filter((line) => line.startsWith(`[job-discovery] profile ${profileId}: failed`)).length;

/**
 * "Modifier les critères" (#237): the button opens a dialog named after the Profile with only its Search Criteria,
 * each saved on change. The minimum salary is set to 90 000 €, the dialog closed with its Close button, the focus
 * back on the button, and the page's criteria line says the change.
 */
async function changeMinSalaryInDialog(page: Page, criteriaLine: Locator, profileName: string) {
  const button = page.getByRole("main").getByRole("button", { name: "Modifier les critères" });
  await button.click();
  const dialog = page.getByRole("dialog", { name: `Critères de recherche · ${profileName}` });
  await expect(dialog).toBeVisible();
  // Only the Search Criteria, labels beside their values as on the Profile page, Sectors and Domains among them (#236).
  await expect(dialog.getByRole("term")).toHaveText([
    "Poste recherché",
    "Lieux",
    "Salaire annuel brut minimum (en euros)",
    "Type de contrat",
    "Télétravail",
    "Secteurs",
    "Sous-secteurs",
    "Domaines",
  ]);
  await expect(dialog.getByLabel("Poste recherché")).toHaveValue(searchCriteria.targetRole);
  const salary = dialog.getByLabel("Salaire annuel brut minimum (en euros)");
  await salary.fill("90000");
  await salary.press("Tab");
  await expect(dialog.getByRole("status").filter({ hasText: "Critères enregistrés" })).toHaveCount(1);
  // The Locations field as on the Profile page (#235): a place added, then removed, each saved at once.
  await typePlace(dialog, "Remote");
  await expect(placeNames(dialog)).toHaveText(["Lyon", "Remote"]);
  await expect(dialog.getByRole("status").filter({ hasText: "Critères enregistrés" })).toHaveCount(2);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "PATCH" && !(response.request().postData() ?? "").includes("Remote")),
    removePlace(dialog, "Remote").click(),
  ]);
  await expect(placeNames(dialog)).toHaveText(["Lyon"]);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(criteriaLine).toContainText(/^Lyon · CDI · 90\s000 € brut par an minimum/);
}

/** The Job Offers listed on a Job Search page, top to bottom (not the lines of "Pourquoi 86 ?" inside them). */
const foundJobOffers = (page: Page) => page.getByRole("list", { name: "Offres trouvées" }).getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });

/**
 * The Match Scores shown on a Job Search page, top to bottom. The faked postings state no skills, so their
 * scores may be partial, shown "N / 100, partiel" (#94).
 */
async function shownScores(page: Page): Promise<number[]> {
  const texts = await page.getByText(/^Score de correspondance : \d+ \/ 100(, partiel)?$/).allTextContents();
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

  test("a finished Job Search shows in the Candidate's data export, with the Job Offers it found (#171)", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
    expect(started.status(), await started.text()).toBe(201);
    const searchId = (await started.json()).id as string;
    await expect
      .poll(async () => (await (await page.request.get(`/recherches/${searchId}`)).text()).includes("Votre coach cherche des offres"), { timeout: 90_000 })
      .toBe(false);

    const exported = await (await page.request.get("/api/account/export")).json();

    expect(exported.profiles.find((p: { id: string }) => p.id === profileId).jobSearches).toEqual([
      expect.objectContaining({ id: searchId, startedAt: expect.any(String), finishedAt: expect.any(String), jobOfferIds: expect.arrayContaining([expect.any(String)]) }),
    ]);
  });

  test("starts from a Profile, shows the Job Offers found by Match Score with their key facts, and saves one in one click", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    await page.goto(`/recherches?profil=${profileId}`);

    await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();

    await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Offres trouvées pour « ${searchCriteria.targetRole} »`);
    // The page refreshes itself until the worker has finished.
    const results = foundJobOffers(page);
    await expect(results, workerOutput).toHaveCount(2, { timeout: 90_000 });

    const scores = await shownScores(page);
    expect(scores).toHaveLength(2);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const daf = results.filter({ hasText: `Directeur administratif et financier (H/F) – réf. ${tag}` });
    await expect(daf).toContainText("Acme Industrie");
    await expect(daf).toContainText("Lyon");
    await expect(daf).toContainText("De 110 000 à 130 000 € brut par an");
    await expect(daf.getByText("Source : carrieres.acme-e2e.example")).toBeVisible();
    // The freshness rule (#116): the careers page's JobPosting dates it; the page only the LLM read states no date.
    await expect(daf.getByText(/^Publiée le \d{1,2} \S+ \d{4}$/)).toBeVisible();
    await expect(daf).not.toContainText("date inconnue");
    const undated = results.filter({ hasText: `Responsable financier (lu par l'IA) – réf. ${tag}` });
    await expect(undated.getByText("date inconnue", { exact: true })).toBeVisible();

    await daf.getByRole("button", { name: "Enregistrer en candidature" }).click();
    await expect(daf.getByText("Enregistrée", { exact: true })).toBeVisible();
    await expect(daf.getByRole("button", { name: "Enregistrer en candidature" })).toHaveCount(0);
    await daf.getByRole("link", { name: "Voir ma candidature" }).click();
    await expect(page).toHaveURL(/\/candidatures\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Directeur administratif et financier (H/F) – réf. ${tag}`);
    await expect(page.getByLabel("Profil utilisé")).toHaveValue(profileId);
  });

  // Issue #135: the page as the approved prototype (#132) lays it out, inside the sidebar layout.
  test.describe("the results page, as in the prototype", () => {
    test("reads like a document: what was searched, when and against which Search Criteria, then the Job Offers best first", async ({ page }) => {
      const profileId = await signInWithProfile(page);
      await searchFromProfile(page, profileId);
      const results = foundJobOffers(page);
      await expect(results, workerOutput).toHaveCount(2, { timeout: 90_000 });

      const main = page.getByRole("main");
      await expect(main.getByText("Recherche d'offres", { exact: true })).toBeVisible();
      const properties = main.locator("dl.props");
      await expect(properties.getByRole("term")).toHaveText(["Statut", "Lancée le", "Critères"]);
      await expect(properties.getByRole("definition").nth(0)).toHaveText("Terminée");
      await expect(properties.getByRole("definition").nth(1)).toHaveText(/^\S+ \d{1,2} \S+ \d{4} à \d{1,2}:\d{2}$/);
      await expect(properties.getByRole("definition").nth(2)).toContainText("Lyon · CDI");
      await changeMinSalaryInDialog(page, properties.getByRole("definition").nth(2), searchCriteria.targetRole);
      await expect(main.getByText("2 offres trouvées, de la plus proche à la moins proche de votre CV de référence.")).toBeVisible();

      // Each Job Offer: its title leads to it, its Match Score with a meter, and why it has that score.
      const responsable = results.filter({ hasText: `Responsable financier (lu par l'IA) – réf. ${tag}` });
      const title = responsable.getByRole("heading", { level: 2 }).getByRole("link");
      // The Job Offer page it leads to scores it against this Job Search's Profile (#163).
      await expect(title).toHaveAttribute("href", new RegExp(`^/offres/[0-9a-f-]+\\?profil=${profileId}$`));
      await expect(responsable.getByRole("link", { name: "Lire l'offre" })).toHaveAttribute("href", (await title.getAttribute("href"))!);
      await expect(responsable.getByText(/^Score de correspondance : \d+ \/ 100(, partiel)?$/)).toBeVisible();
      // The ring around the figure only draws it (#467): the score is said in words.
      await expect(responsable.locator(".ds-ring")).toHaveAttribute("aria-hidden", "true");
      const score = (await shownScores(page))[1];
      const why = responsable.getByText(`Pourquoi ${score} ?`, { exact: true });
      const reasons = responsable.getByRole("list").filter({ hasText: "Type de contrat" });
      await expect(reasons).toBeHidden();
      await why.click();
      await expect(reasons).toBeVisible();
      await expect(reasons.getByRole("listitem").filter({ hasText: "Lieu : Lyon, recherché : Lyon" })).toContainText("Correspond");
      await expect(reasons.getByRole("listitem").filter({ hasText: "Type de contrat : CDI, recherché : CDI" })).toContainText("Correspond");

      // The Job Offer page gives the same Match Score, and why, for the same Profile (#163).
      await title.click();
      await expect(page).toHaveURL(/\/offres\/[0-9a-f-]+\?profil=/);
      await expect(page.getByLabel("Profil à utiliser pour cette candidature")).toHaveValue(profileId);
      await expect(page.getByText(`Score de correspondance avec le profil « ${searchCriteria.targetRole} » : ${score} / 100`)).toBeVisible();
      await page.getByText(`Pourquoi ${score} ?`, { exact: true }).click();
      await expect(page.getByRole("listitem").filter({ hasText: "Type de contrat : CDI, recherché : CDI" })).toContainText("Correspond");
      await page.goBack();

      // Then: search again, or go back to the Profile.
      await expect(main.getByRole("button", { name: "Relancer une recherche" })).toBeVisible();
      await expect(main.getByRole("link", { name: "Retour au profil" })).toHaveAttribute("href", `/profils/${profileId}`);
      // It sits in the sidebar layout, the Job Searches link marked as the current page.
      await expect(page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Recherches d'offres" })).toHaveAttribute("aria-current", "page");
    });

    test("meets the ADR-0009 floor: 16px text at AA contrast, 44px targets, and no sideways scrolling on a phone", async ({ page }) => {
      const profileId = await signInWithProfile(page);
      await searchFromProfile(page, profileId);
      const results = foundJobOffers(page);
      await expect(results, workerOutput).toHaveCount(2, { timeout: 90_000 });
      for (const why of await page.getByText(/^Pourquoi \d+ \?$/).all()) await why.click();
      // With JOB_SEARCH_SCREENSHOTS_DIR set, the page is also captured at each width (docs/screenshots/job-search-results).
      const screenshots = process.env.JOB_SEARCH_SCREENSHOTS_DIR;
      if (screenshots) mkdirSync(screenshots, { recursive: true });

      for (const size of [{ width: 1440, height: 900 }, { width: 900, height: 1000 }, { width: 375, height: 812 }]) {
        await page.setViewportSize(size);
        const main = page.getByRole("main");
        // The page's title is in the Top Bar (ADR-0024).
        await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toBeVisible();
        for (const text of (await renderedTexts(page)).filter((item) => item.fontSizePx > 0)) {
          expect.soft(text.fontSizePx, `font size of "${text.text}" at ${size.width}px`).toBeGreaterThanOrEqual(16);
          expect.soft(text.contrast, `contrast of "${text.text}" at ${size.width}px`).toBeGreaterThanOrEqual(4.5);
        }
        for (const target of await main.locator("a, button, summary").all()) {
          if (!(await target.isVisible())) continue;
          const box = (await target.boundingBox())!;
          expect.soft(box.height, `height of "${await target.innerText()}" at ${size.width}px`).toBeGreaterThanOrEqual(44);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `sideways scroll at ${size.width}px`).toBe(0);
        if (screenshots) await page.evaluate(() => window.scrollTo(0, 0));
        if (screenshots) await page.screenshot({ path: path.join(screenshots, `${size.width}.png`) });
      }
    });
  });

  test("starts from the Coach Panel, for the Profile in view", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    await page.goto(`/profils/${profileId}`);
    await page.getByRole("button", { name: "Aide et coach" }).click();

    // The search sits under the one line saying what the coach sees, opened on demand (ADR-0024).
    const panel = page.getByRole("complementary");
    await panel.locator("summary", { hasText: /^Vous consultez : le profil/ }).click();
    await panel.getByRole("button", { name: "Chercher des offres pour ce profil" }).click();

    await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Offres trouvées pour « ${searchCriteria.targetRole} »`);
    await expect(page.getByText(/^Score de correspondance : \d+ \/ 100(, partiel)?$/).first()).toBeVisible({ timeout: 90_000 });
  });

  // Issue #74: only a Job Search that can run counts against the Plan Quota.
  test("a Job Search that finds Job Offers uses one Job Search of the Plan Quota", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    expect(await jobSearchesUsed(page)).toBe("0 sur 1");

    await searchFromProfile(page, profileId);
    const results = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(results, workerOutput).toHaveCount(2, { timeout: 90_000 });

    expect(await jobSearchesUsed(page)).toBe("1 sur 1");
  });

  test("a Job Search the worker records as failed gives its use back, once, even if reported failed again", async ({ page }) => {
    // Standard (7 Job Searches a week): room for the search that works and the one that fails.
    const profileId = await signInWithProfile(page, "standard");
    const candidateId = await candidateIdOf(page);
    // One search that works, so the count has something to lose if a failure were given back twice.
    await searchFromProfile(page, profileId);
    await expect(page.getByText(/^Score de correspondance : \d+ \/ 100(, partiel)?$/).first(), workerOutput).toBeVisible({ timeout: 90_000 });
    expect(await jobSearchesUsed(page)).toBe("1 sur 7");

    writeFileSync(searchDownFlag, "");
    try {
      const jobSearchId = await searchFromProfile(page, profileId);
      await expect(page.getByText("La recherche n'a pas abouti. Réessayez dans quelques instants."), workerOutput).toBeVisible({ timeout: 90_000 });
      await expect.poll(() => failedRuns(profileId), { message: workerOutput }).toBe(1);
      expect(await jobSearchesUsed(page)).toBe("1 sur 7");

      // The same Job discovery runs again (a redelivered job) and fails again: nothing more is given back.
      const boss = new PgBoss({ connectionString: databaseUrl });
      await boss.start();
      try {
        await boss.send("job-discovery.run", { candidateId, profileId, jobSearchId });
      } finally {
        await boss.stop({ graceful: false });
      }
      await expect.poll(() => failedRuns(profileId), { timeout: 60_000, message: workerOutput }).toBe(2);
      expect(await jobSearchesUsed(page)).toBe("1 sur 7");
      await page.goto(`/recherches/${jobSearchId}`);
      await expect(page.getByText("La recherche n'a pas abouti. Réessayez dans quelques instants.")).toBeVisible();
    } finally {
      rmSync(searchDownFlag, { force: true });
    }
  });

  test("a Job Search that cannot be queued for the worker shows as failed and leaves the Plan Quota unchanged", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    const candidateId = await candidateIdOf(page);
    expect(await jobSearchesUsed(page)).toBe("0 sur 1");

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
      expect(await jobSearchesUsed(page)).toBe("0 sur 1");
    } finally {
      await client.query(`DROP TRIGGER IF EXISTS ${trigger} ON pgboss.job; DROP FUNCTION IF EXISTS pgboss.${trigger}();`);
      await client.end();
    }
  });

  test("stops a Free Candidate at the Plan Quota of Job Searches with an Upgrade Prompt, without searching", async ({ page }) => {
    const profileId = await signInWithProfile(page);
    // The Free Plan's one Job Search of the week.
    const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
    expect(started.status(), await started.text()).toBe(201);
    const searches: string[] = [(await started.json()).id];
    // Let this worker finish them, so no Job discovery is left queued for the next spec's worker.
    for (const id of searches) {
      await expect
        .poll(async () => (await (await page.request.get(`/recherches/${id}`)).text()).includes("Votre coach cherche des offres"), { timeout: 90_000 })
        .toBe(false);
    }
    await page.goto(`/recherches?profil=${profileId}`);

    await page.getByRole("button", { name: "Chercher des offres", exact: true }).click();

    const prompt = page.getByRole("alert").filter({ hasText: "Vous avez atteint la limite de votre offre" });
    await expect(prompt).toContainText("Vous avez utilisé la recherche d'offres comprise cette semaine dans l'offre Gratuite.");
    await expect(prompt.getByRole("link", { name: "Découvrir l'offre Standard" })).toHaveAttribute("href", "/abonnement");
    await expect(page).toHaveURL(new RegExp(`/recherches\\?profil=${profileId}$`));
  });

  // Issue #16: a Job Offer no longer published at its source is left out of Job Search results.
  test("leaves Expired Job Offers out of the results", async ({ page }) => {
    // Standard: two Job Searches, more than the Free Plan's one a week.
    const profileId = await signInWithProfile(page, "standard");
    await searchFromProfile(page, profileId);
    const results = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(results, workerOutput).toHaveCount(2, { timeout: 90_000 });
    const expiredTitle = `Directeur administratif et financier (H/F) – réf. ${tag}`;

    // The worker's re-check found the posting gone, twice in a row (e2e/expired-job-offers.spec.ts drives that path).
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const marked = await client.query("UPDATE job_offer SET expired_at = now() WHERE title = $1", [expiredTitle]);
      expect(marked.rowCount).toBeGreaterThan(0);
      try {
        await searchFromProfile(page, profileId);
        await expect(results, workerOutput).toHaveCount(1, { timeout: 90_000 });
        await expect(page.getByRole("heading", { level: 2, name: expiredTitle })).toHaveCount(0);
      } finally {
        await client.query("UPDATE job_offer SET expired_at = NULL WHERE title = $1", [expiredTitle]);
      }
    } finally {
      await client.end();
    }
  });
  // ADR-0025: the Recherches d'offres page, from the sidebar: one Profile's Job Searches, or all active Profiles' at once.
  test.describe("the Recherches d'offres page", () => {
    const secondRole = "Contrôleuse de gestion";
    const archivedRole = "Consultante en transformation financière";

    /** Signs a new Candidate in on the Standard Plan (several active Profiles) with two active Profiles and an archived one. */
    async function signInWithProfiles(page: Page): Promise<{ first: string; second: string; archived: string }> {
      const email = newAddress("job-searches-page");
      await signInWithMagicLink(page, email);
      await subscribe(page, email, "standard");
      const ids: string[] = [];
      for (const targetRole of [searchCriteria.targetRole, secondRole, archivedRole]) {
        const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { ...searchCriteria, targetRole } } });
        expect(created.status(), await created.text()).toBe(201);
        ids.push((await created.json()).id as string);
      }
      const [first, second, archived] = ids as [string, string, string];
      expect((await page.request.patch(`/api/profiles/${archived}`, { headers: { origin }, data: { archived: true } })).status()).toBe(200);
      return { first, second, archived };
    }

    const chooser = (page: Page) => page.getByRole("form", { name: "Choisir le profil" });
    const sidebarLink = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Recherches d'offres" });
    /** The Job Offers listed under a heading of the page's own (`level`: their titles' heading level). */
    const offersIn = (scope: Locator, page: Page, level: number) => scope.getByRole("listitem").filter({ has: page.getByRole("heading", { level }) });

    test("for one Profile: its Search Criteria, the search button, a search running, then its latest Job Offers", async ({ page }) => {
      // Standard: two Job Searches, more than the Free Plan's one a week.
      const profileId = await signInWithProfile(page, "standard");
      // No Profile named: the first active one.
      await page.goto("/recherches");
      await expect(page).toHaveURL(`${origin}/recherches?profil=${profileId}`);
      await page.goto("/compte");
      await sidebarLink(page).click();
      await expect(page).toHaveURL(`${origin}/recherches?profil=${profileId}`);
      await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toHaveText("Recherches d'offres");
      await expect(sidebarLink(page)).toHaveAttribute("aria-current", "page");

      const main = page.getByRole("main");
      const properties = main.locator("dl.job-searches-criteria__list");
      await expect(properties.getByRole("term")).toHaveText(["Profil", "Critères"]);
      await expect(properties.getByRole("link", { name: searchCriteria.targetRole })).toHaveAttribute("href", `/profils/${profileId}`);
      await expect(properties.getByRole("definition").nth(1)).toContainText("Lyon · CDI");
      await changeMinSalaryInDialog(page, properties.getByRole("definition").nth(1), searchCriteria.targetRole);
      await expect(main.getByText("Aucune recherche d'offres pour ce profil pour l'instant.", { exact: false })).toBeVisible();

      // A Job Search started elsewhere (the Coach Panel, another tab) shows as running, and the page follows it.
      const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
      expect(started.status(), await started.text()).toBe(201);
      const jobSearchId = (await started.json()).id as string;
      await page.reload();
      const latest = main.getByRole("region", { name: "Dernières offres trouvées" });
      // Unless the worker was quicker than the reload, the search is said to be running, with no second button meanwhile.
      if ((await latest.count()) === 0) {
        await expect(main.getByRole("status").getByRole("link", { name: "Suivre la recherche en cours" })).toHaveAttribute("href", `/recherches/${jobSearchId}`);
        await expect(main.getByRole("button", { name: "Chercher des offres", exact: true })).toHaveCount(0);
      }
      // The page refreshes itself until the worker has finished.
      await expect(offersIn(latest, page, 3), workerOutput).toHaveCount(2, { timeout: 90_000 });
      await expect(latest.getByRole("link", { name: "Voir cette recherche" })).toHaveAttribute("href", `/recherches/${jobSearchId}`);
      await expect(latest.getByText(/^Recherche du \d{1,2} \S+ \d{4} à \d{1,2}:\d{2}/)).toBeVisible();
      await expect(latest.getByText("2 offres trouvées, de la plus proche à la moins proche de votre CV de référence.")).toBeVisible();
      await expect(offersIn(latest, page, 3).getByText(/^Score de correspondance : \d+ \/ 100(, partiel)?$/)).toHaveCount(2);

      // Its button searches again.
      await main.getByRole("button", { name: "Chercher des offres", exact: true }).click();
      await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
      await expect(offersIn(page.getByRole("main"), page, 2), workerOutput).toHaveCount(2, { timeout: 90_000 });
    });

    test("\"Modifier les critères\": a named dialog, focus trapped, Escape closing it, on the ADR-0009 floor at 1280px and 375px (#237)", async ({ page }) => {
      const profileId = await signInWithProfile(page);
      // With JOB_SEARCH_SCREENSHOTS_DIR set, the dialog is also captured at each width.
      const screenshots = process.env.JOB_SEARCH_SCREENSHOTS_DIR;
      if (screenshots) mkdirSync(screenshots, { recursive: true });
      for (const size of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
        await page.setViewportSize(size);
        await page.goto(`/recherches?profil=${profileId}`);
        const button = page.getByRole("main").getByRole("button", { name: "Modifier les critères" });
        await button.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: `Critères de recherche · ${searchCriteria.targetRole}` });
        await expect(dialog).toBeVisible();
        // The focus starts on the dialog itself (no field's value selected, one keystroke from being replaced), and Tab never takes it out.
        await expect(dialog).toBeFocused();
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press("Tab");
          expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `focus after ${i + 1} Tab at ${size.width}px`).toBe(true);
        }

        // The place suggestions shown (#235): measured with the rest.
        await placeInput(dialog).fill("loire");
        await expect(placeOptions(dialog)).toHaveCount(4);
        for (const text of (await renderedTexts(page)).filter((item) => item.fontSizePx > 0)) {
          expect.soft(text.fontSizePx, `font size of "${text.text}" at ${size.width}px`).toBeGreaterThanOrEqual(16);
          expect.soft(text.contrast, `contrast of "${text.text}" at ${size.width}px`).toBeGreaterThanOrEqual(4.5);
        }
        // Every control is at least the Confort Density's control height, 2.5rem (ADR-0053; the Drawer's « Fermer », #462),
        // the Profile page's own 2.75rem (a checkbox's target is its label).
        for (const target of await dialog.getByRole("button").or(dialog.getByRole("textbox")).or(dialog.getByRole("combobox")).or(dialog.getByRole("option")).all()) {
          if (!(await target.isVisible())) continue;
          const box = (await target.boundingBox())!;
          expect.soft(box.height, `height of ${await target.evaluate((element) => element.outerHTML.slice(0, 80))} at ${size.width}px`).toBeGreaterThanOrEqual(40);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `sideways scroll at ${size.width}px`).toBe(0);
        const box = (await dialog.boundingBox())!;
        if (size.width === 375) {
          // Full screen on a phone.
          expect(box.x).toBe(0);
          expect(box.width).toBe(size.width);
          expect(box.height).toBeGreaterThanOrEqual(size.height - 1);
        } else {
          expect(box.width).toBeLessThan(size.width);
        }

        if (screenshots) await page.screenshot({ path: path.join(screenshots, `criteria-dialog-${size.width}.png`) });

        // Escape closes the suggestions, then empties the input, the dialog still open; then it closes the dialog.
        await placeInput(dialog).press("Escape");
        await expect(placeOptions(dialog)).toHaveCount(0);
        await expect(dialog).toBeVisible();
        await placeInput(dialog).press("Escape");
        await expect(placeInput(dialog)).toHaveValue("");
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(button).toBeFocused();
      }
    });

    test("switches Profile with the chooser, kept in the address; archived Profiles are not offered", async ({ page }) => {
      const { first, second, archived } = await signInWithProfiles(page);
      await page.goto(`/recherches?profil=${first}`);
      const select = chooser(page).getByLabel("Profil", { exact: true });
      await expect(select).toHaveValue(first);
      await expect(select.locator("option")).toHaveText([searchCriteria.targetRole, secondRole, "Tous mes profils"]);

      await select.selectOption(second);
      await chooser(page).getByRole("button", { name: "Afficher" }).click();
      await expect(page).toHaveURL(`${origin}/recherches?profil=${second}`);
      await expect(page.getByRole("main").locator("dl.job-searches-criteria__list").getByRole("link", { name: secondRole })).toBeVisible();
      // The sidebar's Profile is the one shown, and its Job Searches link leads back here.
      await expect(page.getByRole("navigation", { name: "Sélecteur de profil" }).getByRole("button")).toHaveText(`Profil : ${secondRole}`);
      await expect(sidebarLink(page)).toHaveAttribute("href", `/recherches?profil=${second}`);

      await chooser(page).getByLabel("Profil", { exact: true }).selectOption({ label: "Tous mes profils" });
      await chooser(page).getByRole("button", { name: "Afficher" }).click();
      await expect(page).toHaveURL(`${origin}/recherches?profil=tous`);
      await expect(page.getByRole("button", { name: "Chercher pour mes 2 profils (2 recherches)" })).toBeVisible();

      // An archived Profile's address shows the first active Profile instead.
      await page.goto(`/recherches?profil=${archived}`);
      await expect(page).toHaveURL(`${origin}/recherches?profil=${first}`);
    });

    test("searches for every active Profile at once, one Job Search each, then shows each one's Job Offers in tabs or swimlanes", async ({ page }) => {
      const { first, second } = await signInWithProfiles(page);
      await page.goto("/recherches?profil=tous");

      await page.getByRole("button", { name: "Chercher pour mes 2 profils (2 recherches)" }).click();
      await expect(page.getByRole("main").getByRole("status").getByText("2 recherches lancées.")).toBeVisible();
      await expect(page).toHaveURL(`${origin}/recherches?profil=tous`);

      // Tabs by default: one per active Profile, the archived one left out.
      const tablist = page.getByRole("tablist", { name: "Résultats par profil" });
      await expect(tablist.getByRole("tab")).toHaveText([searchCriteria.targetRole, secondRole]);
      await expect(page.getByRole("navigation", { name: "Affichage des résultats" }).getByRole("link", { name: "Onglets" })).toHaveAttribute("aria-current", "page");
      const panel = page.getByRole("tabpanel");
      await expect(panel).toHaveCount(1);
      // The page refreshes itself until both Job Searches are done.
      await expect(offersIn(panel, page, 4), workerOutput).toHaveCount(2, { timeout: 90_000 });
      await expect(panel.getByRole("heading", { level: 3 })).toHaveText(`Offres pour « ${searchCriteria.targetRole} »`);
      await expect(panel.getByRole("link", { name: "Voir cette recherche" })).toHaveAttribute("href", /^\/recherches\/[0-9a-f-]+$/);
      // The keyboard moves between tabs.
      await tablist.getByRole("tab", { name: searchCriteria.targetRole }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(tablist.getByRole("tab", { name: secondRole })).toHaveAttribute("aria-selected", "true");
      await expect(panel.getByRole("heading", { level: 3 })).toHaveText(`Offres pour « ${secondRole} »`);
      await expect(offersIn(panel, page, 4), workerOutput).toHaveCount(2, { timeout: 90_000 });

      // One Job Search each, both counted against the Plan Quota.
      expect(await jobSearchesUsed(page)).toBe("2 sur 7");
      const searchIds: string[] = [];
      for (const profileId of [first, second]) {
        await page.goto(`/recherches?profil=${profileId}`);
        const href = await page.getByRole("region", { name: "Dernières offres trouvées" }).getByRole("link", { name: "Voir cette recherche" }).getAttribute("href");
        searchIds.push(href!);
      }
      expect(new Set(searchIds).size).toBe(2);

      // Swimlanes: one row per Profile, its Job Offers side by side.
      await page.goto("/recherches?profil=tous");
      await page.getByRole("navigation", { name: "Affichage des résultats" }).getByRole("link", { name: "Couloirs" }).click();
      await expect(page).toHaveURL(`${origin}/recherches?profil=tous&vue=couloirs`);
      await expect(page.getByRole("navigation", { name: "Affichage des résultats" }).getByRole("link", { name: "Couloirs" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("tablist")).toHaveCount(0);
      const firstLane = page.getByRole("region", { name: `Offres trouvées pour « ${searchCriteria.targetRole} », à faire défiler de côté` });
      const secondLane = page.getByRole("region", { name: `Offres trouvées pour « ${secondRole} », à faire défiler de côté` });
      await expect(offersIn(firstLane, page, 4)).toHaveCount(2);
      await expect(offersIn(secondLane, page, 4)).toHaveCount(2);
      await expect(page.getByRole("link", { name: "Voir cette recherche" })).toHaveCount(2);
      const [left, right] = [(await offersIn(firstLane, page, 4).nth(0).boundingBox())!, (await offersIn(firstLane, page, 4).nth(1).boundingBox())!];
      expect(Math.abs(left.y - right.y)).toBeLessThan(1);
      expect(right.x).toBeGreaterThan(left.x);
      // Choosing all Profiles again from the chooser stays in swimlanes.
      await chooser(page).getByRole("button", { name: "Afficher" }).click();
      await expect(page).toHaveURL(`${origin}/recherches?profil=tous&vue=couloirs`);

      // ADR-0009 on a phone: only a swimlane scrolls sideways, never the page, and the keyboard scrolls it.
      await page.setViewportSize({ width: 375, height: 812 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways scroll at 375px").toBe(0);
      expect(await firstLane.evaluate((lane) => lane.scrollWidth > lane.clientWidth)).toBe(true);
      await firstLane.focus();
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => firstLane.evaluate((lane) => lane.scrollLeft)).toBeGreaterThan(0);
      for (const text of (await renderedTexts(page)).filter((item) => item.fontSizePx > 0)) {
        expect.soft(text.fontSizePx, `font size of "${text.text}"`).toBeGreaterThanOrEqual(16);
        expect.soft(text.contrast, `contrast of "${text.text}"`).toBeGreaterThanOrEqual(4.5);
      }
      for (const target of await page.getByRole("main").locator("a, button, summary, select").all()) {
        if (!(await target.isVisible())) continue;
        const box = (await target.boundingBox())!;
        expect.soft(box.height, `height of "${await target.innerText()}"`).toBeGreaterThanOrEqual(44);
      }

      // Back to tabs.
      await page.getByRole("navigation", { name: "Affichage des résultats" }).getByRole("link", { name: "Onglets" }).click();
      await expect(page).toHaveURL(`${origin}/recherches?profil=tous`);
      await expect(page.getByRole("tablist", { name: "Résultats par profil" })).toBeVisible();
    });

    test("says which Profile got no Job Search when the Plan Quota is used up", async ({ page }) => {
      const profileId = await signInWithProfile(page);
      // The Free Plan's one Job Search of the week.
      const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
      expect(started.status(), await started.text()).toBe(201);
      const searches: string[] = [(await started.json()).id];
      // Let this worker finish them, so no Job discovery is left queued for the next spec's worker.
      for (const id of searches) {
        await expect
          .poll(async () => (await (await page.request.get(`/recherches/${id}`)).text()).includes("Votre coach cherche des offres"), { timeout: 90_000 })
          .toBe(false);
      }
      await page.goto("/recherches?profil=tous");

      await page.getByRole("button", { name: "Chercher pour mon profil (1 recherche)" }).click();

      await expect(
        page.getByRole("alert").getByText(`Pas de recherche pour « ${searchCriteria.targetRole} » : vous avez utilisé toutes les recherches d'offres de votre offre cette semaine.`),
      ).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "Vous avez atteint la limite de votre offre" }).getByRole("link", { name: "Découvrir l'offre Standard" })).toHaveAttribute(
        "href",
        "/abonnement",
      );
      await expect(page.getByRole("main").getByText(/recherches? lancées?\./)).toHaveCount(0);
      expect(await jobSearchesUsed(page)).toBe("1 sur 1");
    });
  });

  // Issue #118: once a Job Search finishes, the Candidate is told so on whatever page they are on.
  test.describe("Job Search notification", () => {
    /** Starts a Job Search without leaving the page, as the Coach Panel would in another tab. */
    async function startInBackground(page: Page, profileId: string): Promise<string> {
      const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
      expect(started.status(), await started.text()).toBe(201);
      return (await started.json()).id as string;
    }

    /** ADR-0009: the notification's text is at least 16px and in AA contrast. */
    async function expectReadable(page: Page, texts: string[]) {
      const rendered = (await renderedTexts(page)).filter((item) => texts.some((text) => item.text.includes(text)));
      expect(rendered.length).toBeGreaterThanOrEqual(texts.length);
      for (const item of rendered) {
        expect(item.fontSizePx, item.text).toBeGreaterThanOrEqual(16);
        expect(item.contrast, item.text).toBeGreaterThanOrEqual(4.5);
      }
    }

    test("tells the Candidate, on another page, how many Job Offers it found, until they open it", async ({ page }) => {
      const profileId = await signInWithProfile(page);
      await page.goto(`/profils/${profileId}`);
      const jobSearchId = await startInBackground(page, profileId);

      // Moving on in the app: the notifications check for the Job Search just started.
      await page.getByRole("link", { name: "Mes candidatures" }).click();
      await expect(page).toHaveURL(/\/candidatures$/);

      const message = `Votre recherche d'offres pour « ${searchCriteria.targetRole} » est terminée : 2 offres trouvées.`;
      const notifications = page.getByRole("list", { name: "Recherches d'offres terminées" });
      await expect(notifications.getByText(message), workerOutput).toBeVisible({ timeout: 90_000 });
      // A polite live region, there from the start: a screen reader announces it as it comes.
      await expect(page.locator("[aria-live=polite]").filter({ has: notifications })).toHaveCount(1);
      await expectReadable(page, [message]);
      const see = notifications.getByRole("link", { name: "Voir les offres" });
      await expect(see).toHaveAccessibleDescription(message);
      await expect(notifications.getByRole("button", { name: "Fermer" })).toHaveAccessibleDescription(message);

      // It stays from page to page until the Candidate does something about it.
      await page.goto(`/profils/${profileId}`);
      await expect(page.getByText(message)).toBeVisible();

      await see.click();
      await expect(page).toHaveURL(new RegExp(`/recherches/${jobSearchId}$`));
      await expect(page.getByText("2 offres trouvées, de la plus proche à la moins proche de votre CV de référence.")).toBeVisible();
      await expect(page.getByText(message)).toHaveCount(0);

      await page.goto(`/profils/${profileId}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(message)).toHaveCount(0);
    });

    test("tells the Candidate a Job Search failed, and why in plain words, until they close it", async ({ page }) => {
      const profileId = await signInWithProfile(page);
      await page.goto("/candidatures");
      writeFileSync(searchDownFlag, "");
      let jobSearchId: string;
      try {
        jobSearchId = await startInBackground(page, profileId);
        await page.reload();

        const notifications = page.locator("[aria-live=polite]").getByRole("list", { name: "Recherches d'offres terminées" });
        const notification = notifications.getByRole("listitem");
        await expect(notification.getByText(`Votre recherche d'offres pour « ${searchCriteria.targetRole} » n'a pas abouti.`), workerOutput).toBeVisible({
          timeout: 90_000,
        });
        await expect.poll(() => failedRuns(profileId), { message: workerOutput }).toBe(1);
      } finally {
        rmSync(searchDownFlag, { force: true });
      }
      const reason = "Les sites d'offres d'emploi n'ont pas pu être consultés. Elle n'est pas comptée dans vos recherches d'offres de la semaine.";
      await expect(page.getByText(reason)).toBeVisible();
      await expectReadable(page, [reason]);
      await expect(page.getByRole("link", { name: "Voir la recherche" })).toHaveAttribute("href", `/recherches/${jobSearchId}`);

      await page.getByRole("button", { name: "Fermer" }).click();
      await expect(page.getByText(reason)).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(reason)).toHaveCount(0);

      // The Job Search's own page still says why.
      await page.goto(`/recherches/${jobSearchId}`);
      await expect(page.getByRole("status").getByText(reason)).toBeVisible();
    });
  });
});

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #406: a Job Search visits the Profile's Target Companies, the companies La Bonne Boite gives as likely to hire
// for its job and area: after the plan's web searches, one web search « title + company » for a company without a known
// careers site (here it finds the company's Greenhouse board, kept for every Profile), and the board of one whose careers
// site is known read through its ATS's API (here Lever), postings for the job captured as Job Offers. A sole trader La
// Bonne Boite gives (its name a private person's) is never web-searched: the company register is asked by SIREN first (ADR-0007). Driven through the
// public entry points: a Job Search started over the web app's HTTP API, worked by the real worker (apps/worker,
// `tsx src/main.ts`) on the same database. La Bonne Boite, ROMEO, France Travail's token endpoint, geo.api.gouv.fr, the
// company register and the ATS APIs are e2e/support/fake-la-bonne-boite.mjs, over e2e/support/fake-job-sites.mjs for the rest of the web.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-target-companies-${tag}`);
const requestLog = path.join(workDir, "requests.jsonl");

/** A SIREN of 9 digits for this run, so its companies are its own in the suite's database. */
const siren = (seed: number) => String(100_000_000 + ((Date.now() * 7 + seed * 104_729) % 800_000_000)).slice(0, 9);
const ALPHA = { siren: siren(1), name: `ALPHACIBLE ${tag}` };
const BETA = { siren: siren(2), name: `BETACIBLE ${tag}` };
const SOLE_TRADER = { siren: siren(3), name: `JEANNE DUPONTCIBLE ${tag}` };
const ALPHA_POSTING = `https://job-boards.greenhouse.io/alphacible-${tag}/jobs/3001`;
const BETA_BOARD = `https://jobs.lever.co/betacible-${tag}`;
const BETA_POSTING = `${BETA_BOARD}/00000000-0000-4000-8000-000000000406`;

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation"],
  languages: [],
};
const searchCriteria = { targetRole: "Directeur financier", locations: ["Lyon"], contractTypes: ["cdi"] };

test.use({ baseURL: origin });

type LoggedRequest = { url: string; method: string; headers: Record<string, string>; body: string };
const requests = (): LoggedRequest[] =>
  existsSync(requestLog) ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

let worker: ChildProcess | undefined;
let workerOutput = "";
let profileId = "";
let jobSearchId = "";

test.describe("A Job Search visits the Profile's Target Companies (#406)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    mkdirSync(workDir, { recursive: true });
    // BETACIBLE's careers site was found by an earlier run, for another Profile: kept for every Profile.
    await query("INSERT INTO company_careers_site (company_key, url, found_at) VALUES ($1, $2, now()) ON CONFLICT (company_key) DO UPDATE SET url = EXCLUDED.url", [
      `siren:${BETA.siren}`,
      BETA_BOARD,
    ]);

    const page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("target-companies"));
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;

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
        JOB_DISCOVERY_TARGET_COMPANIES_PER_RUN: "",
        JOB_DISCOVERY_COMPANY_REVISIT_DAYS: "",
        FRANCE_TRAVAIL_CLIENT_ID: "e2e-tc-client-id",
        FRANCE_TRAVAIL_CLIENT_SECRET: "e2e-tc-client-secret",
        E2E_DISCOVERY_TAG: tag,
        E2E_TC_TAG: tag,
        E2E_TC_LOG: requestLog,
        E2E_TC_ALPHA_SIRET: `${ALPHA.siren}00011`,
        E2E_TC_BETA_SIRET: `${BETA.siren}00022`,
        E2E_TC_SOLE_SIRET: `${SOLE_TRADER.siren}00033`,
        NODE_OPTIONS: [`--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`, `--import=${path.resolve("e2e/support/fake-la-bonne-boite.mjs")}`].join(" "),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
    await expect.poll(() => workerOutput, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);

    const started = await page.request.post("/api/job-searches", { headers: { origin }, data: { profileId } });
    expect(started.status(), await started.text()).toBe(201);
    jobSearchId = (await started.json()).id;
    await expect
      .poll(async () => (await query<{ status: string }>("SELECT status FROM job_search WHERE id = $1", [jobSearchId]))[0]?.status, { timeout: 120_000, message: workerOutput })
      .toBe("done");
    await page.close();
  });

  test.afterAll(async () => {
    if (worker && worker.exitCode === null) {
      const exited = new Promise((resolve) => worker!.once("exit", resolve));
      worker.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }
    if (!process.env.E2E_KEEP) rmSync(workDir, { recursive: true, force: true });
  });

  test("asks La Bonne Boite, with its own token, for the title's ROME job within 30 km of Lyon, and keeps its companies on the Profile", async () => {
    const searches = requests().filter((r) => r.url.startsWith("https://api.francetravail.io/partenaire/labonneboite/v2/recherche"));
    expect(searches, workerOutput).toHaveLength(1);
    // Only the job and the area (ADR-0007).
    expect(Object.fromEntries(new URL(searches[0]!.url).searchParams)).toEqual({ rome: "M1205", citycode: "69123", distance: "30", page_size: "20" });
    expect(searches[0]!.headers.authorization).toBe(`Bearer tc-token-${tag}`);
    const tokens = requests().filter((r) => r.url.startsWith("https://entreprise.francetravail.fr/")).map((r) => new URLSearchParams(r.body).get("scope"));
    expect(tokens).toContain("api_labonneboitev2 search office");

    const kept = await query<{ name: string; origin: string; last_visited_at: Date | null }>(
      "SELECT name, origin, last_visited_at FROM target_company WHERE profile_id = $1 ORDER BY hiring_score DESC",
      [profileId],
    );
    expect(kept.map(({ name, origin }) => ({ name, origin }))).toEqual([
      { name: SOLE_TRADER.name, origin: "la_bonne_boite" },
      { name: ALPHA.name, origin: "la_bonne_boite" },
      { name: BETA.name, origin: "la_bonne_boite" },
    ]);
    // The two companies were visited in this run; the sole trader, never searched, was not.
    expect(Object.fromEntries(kept.map((company) => [company.name, company.last_visited_at !== null]))).toEqual({ [SOLE_TRADER.name]: false, [ALPHA.name]: true, [BETA.name]: true });
  });

  test("searches the web for « title + company » for the company without a known careers site, and none for the other", () => {
    const targetSearches = requests().filter((r) => r.url.startsWith("https://api.perplexity.ai") && (r.body.includes("ALPHACIBLE") || r.body.includes("BETACIBLE")));
    expect(targetSearches.map((r) => JSON.parse(r.body).query)).toEqual([`Directeur financier "${ALPHA.name}"`]);
  });

  test("never sends a sole trader's name, a private person's, to the web search, the register asked by SIREN alone (ADR-0007)", () => {
    const leaving = requests().filter((r) => !r.url.startsWith("https://api.francetravail.io/") && (r.url.includes("DUPONTCIBLE") || r.body.includes("DUPONTCIBLE")));
    expect(leaving.map((r) => r.url)).toEqual([]);
    const registerQueries = requests()
      .filter((r) => r.url.startsWith("https://recherche-entreprises.api.gouv.fr/"))
      .map((r) => new URL(r.url).searchParams.get("q"));
    expect(registerQueries.sort()).toEqual([ALPHA.siren, SOLE_TRADER.siren].sort());
  });

  test("captures a posting from each company's ATS: the one the search found, and the job's posting on the board kept", async () => {
    const stored = await query<{ id: string; source_url: string; title: string; employer: string | null }>(
      "SELECT id, source_url, title, employer FROM job_offer WHERE source_url = ANY($1::text[]) ORDER BY source_url",
      [[ALPHA_POSTING, BETA_POSTING, `${BETA_BOARD}/00000000-0000-4000-8000-000000000407`]],
    );
    expect(stored.map(({ source_url, title }) => ({ source_url, title }))).toEqual([
      { source_url: ALPHA_POSTING, title: `Directeur administratif et financier – ALPHACIBLE réf. ${tag}` },
      { source_url: BETA_POSTING, title: `Directeur financier groupe – BETACIBLE réf. ${tag}` },
    ]);
    // Read through the ATS APIs, never the postings' pages.
    const urls = requests().map((r) => r.url);
    expect(urls).toContain(`https://boards-api.greenhouse.io/v1/boards/alphacible-${tag}/jobs/3001`);
    expect(urls).toContain(`https://api.lever.co/v0/postings/betacible-${tag}?mode=json`);
    expect(urls).not.toContain(ALPHA_POSTING);
    expect(urls).not.toContain(BETA_POSTING);

    // They are the Job Search's Job Offers.
    const [search] = await query<{ job_offer_ids: string[] }>("SELECT job_offer_ids::text[] AS job_offer_ids FROM job_search WHERE id = $1", [jobSearchId]);
    expect(search!.job_offer_ids).toEqual(expect.arrayContaining(stored.map((offer) => offer.id)));
    expect(workerOutput).toMatch(new RegExp(`\\[job-discovery\\] profile ${profileId}: .*Target Companies: 2 visited \\(2 Job Offer\\(s\\)\\), La Bonne Boite searched`));
  });

  test("keeps the careers site the search showed for its company, for every Profile", async () => {
    const sites = await query<{ company_key: string; url: string }>("SELECT company_key, url FROM company_careers_site WHERE company_key = ANY($1::text[]) ORDER BY company_key", [
      [`siren:${ALPHA.siren}`, `siren:${BETA.siren}`],
    ]);
    expect(Object.fromEntries(sites.map((site) => [site.company_key, site.url]))).toEqual({
      [`siren:${ALPHA.siren}`]: `https://job-boards.greenhouse.io/alphacible-${tag}`,
      [`siren:${BETA.siren}`]: BETA_BOARD,
    });
  });
});

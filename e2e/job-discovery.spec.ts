import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #13: Job discovery, the background job that searches the web for Job
// Offers matching a Profile's Search Criteria. Driven through its public entry
// point: the worker (apps/worker, `tsx src/main.ts`) working the
// "job-discovery.run" queue on the app's database, for a Profile created over
// the web app's HTTP API. The outside world (Perplexity, Mistral and the job
// sites) is played by e2e/support/fake-job-sites.mjs, preloaded into the worker,
// which logs every request the worker sends.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-discovery-${tag}`);
const requestLog = path.join(workDir, "requests.jsonl");

/** A Master CV full of personal data that must never reach the web-search provider. */
const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "06 98 76 54 32",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances de Moulinsart Industries.",
  experience: [
    { title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2010 – 2024", description: "Pilotage financier du groupe Tournesol." },
  ],
  education: [{ degree: "Master Finance", institution: "Université Haddock", year: "2002" }],
  skills: ["Consolidation", "IFRS"],
  languages: [{ name: "Italien", level: "courant" }],
};
const searchCriteria = { targetRole: "Directrice administrative et financière", location: "Lyon", contractType: "cdi", remoteWork: "hybrid", minSalary: 110_000 };

const site = {
  jsonLd: `https://carrieres.acme-e2e.example/offres/daf-lyon-${tag}`,
  mirror: `https://miroir-e2e.example/offre/daf-${tag}`,
  plain: `https://emplois.lyon-e2e.example/annonce/${tag}`,
  linkedIn: `https://www.linkedin.com/jobs/view/${tag}`,
  cloudflare: `https://protege-e2e.example/offre/${tag}`,
  captcha: `https://captcha-e2e.example/offre/${tag}`,
  loginWall: `https://membres-e2e.example/offre/${tag}`,
  robotsBlocked: `https://bloque-e2e.example/offre/${tag}`,
  robotsPrivate: `https://carrieres.acme-e2e.example/prive/daf-confidentiel-${tag}`,
  known: `https://deja-vu-e2e.example/offre/${tag}`,
};

type LoggedRequest = { url: string; method: string; headers: Record<string, string>; body: string };
const requests = (): LoggedRequest[] =>
  existsSync(requestLog) ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const fetchesOf = (url: string) => requests().filter((r) => r.url === url);

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
      E2E_DISCOVERY_LOG: requestLog,
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
}

async function enqueueDiscovery(candidateId: string, profileId: string) {
  const boss = new PgBoss({ connectionString: databaseUrl });
  await boss.start();
  try {
    await boss.send("job-discovery.run", { candidateId, profileId });
  } finally {
    await boss.stop({ graceful: false });
  }
}

/** The worker's report line for this Profile, once per run. */
const reports = (profileId: string) => workerOutput.split("\n").filter((line) => line.startsWith(`[job-discovery] profile ${profileId}:`));

async function waitForReport(profileId: string, count: number): Promise<string> {
  await expect.poll(() => reports(profileId).length, { timeout: 60_000, message: workerOutput }).toBeGreaterThanOrEqual(count);
  return reports(profileId)[count - 1]!;
}

/** Stored Job Offers whose source is one of this run's fake sites. */
async function storedJobOffers(): Promise<{ id: string; source_url: string }[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT id, source_url FROM job_offer WHERE source_url LIKE $1 ORDER BY source_url", [`%${tag}%`]);
    return rows;
  } finally {
    await client.end();
  }
}

async function createProfile(page: Page) {
  await signInWithMagicLink(page, newAddress("discovery"));
  const session = await (await page.request.get("/api/auth/get-session")).json();
  const candidateId: string = session.user.id;
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
  expect(created.status(), await created.text()).toBe(201);
  const { id: profileId } = await created.json();
  return { candidateId, profileId: profileId as string };
}

test.describe("Job discovery (worker job job-discovery.run)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let candidateId = "";
  let profileId = "";
  let knownOfferId = "";
  let firstReport = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    mkdirSync(workDir, { recursive: true });

    const page = await browser.newPage({ baseURL: origin });
    ({ candidateId, profileId } = await createProfile(page));
    // A Job Offer already captured (by the extension) from one of the pages the search will find.
    const known = await page.request.post("/api/job-offers", {
      headers: { origin },
      data: {
        source: { url: `${site.known}?utm_source=linkedin&utm_medium=social` },
        title: `Contrôleur de gestion – réf. ${tag}`,
        content: `Déjà capturée par l'extension (réf. ${tag}).`,
        location: "Lyon",
      },
    });
    expect(known.status(), await known.text()).toBe(200);
    knownOfferId = (await known.json()).id;
    await page.close();

    startWorker();
    await expect.poll(() => workerOutput, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
    await enqueueDiscovery(candidateId, profileId);
    firstReport = await waitForReport(profileId, 1);
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

  test("searches with the Search Criteria only, never CV content or the Candidate's name (ADR-0007)", () => {
    const searches = requests().filter((r) => r.url.startsWith("https://api.perplexity.ai/"));
    expect(searches).toHaveLength(1);
    const { body } = searches[0]!;
    const query: string = JSON.parse(body).input;

    // The Search Criteria are all there…
    expect(query).toContain("Directrice administrative et financière");
    expect(query).toContain("Lyon");
    expect(query).toContain("CDI");
    expect(query).toContain("télétravail partiel");
    expect(query).toMatch(/110\s000/);
    // …and nothing from the Master CV, anywhere in what was sent.
    for (const personal of ["Bérénice", "Castafiore", "berenice", "06 98 76 54 32", "0698765432", "Moulinsart", "Tournesol", "Haddock", "Consolidation", "IFRS", "Italien"]) {
      expect(body, `"${personal}" sent to the web-search provider`).not.toContain(personal);
    }
  });

  test("never fetches a page robots.txt disallows, and reads robots.txt before any page of a site", () => {
    expect(fetchesOf(site.robotsBlocked)).toHaveLength(0);
    expect(fetchesOf(site.robotsPrivate)).toHaveLength(0);
    expect(fetchesOf("https://bloque-e2e.example/robots.txt")).toHaveLength(1);

    const urls = requests().map((r) => r.url);
    for (const pageUrl of [site.jsonLd, site.plain, site.cloudflare, site.captcha, site.loginWall, site.mirror]) {
      const robots = `${new URL(pageUrl).origin}/robots.txt`;
      expect(urls.indexOf(robots), `robots.txt read before ${pageUrl}`).toBeGreaterThanOrEqual(0);
      expect(urls.indexOf(robots)).toBeLessThan(urls.indexOf(pageUrl));
    }
    // The crawler introduces itself, so robots.txt rules can address it.
    for (const r of requests().filter((r) => r.url.includes("-e2e.example"))) expect(r.headers["user-agent"]).toMatch(/bot/i);
    expect(firstReport).toMatch(/robots: 2/);
  });

  test("never touches a site whose terms forbid crawling (LinkedIn), not even its robots.txt (ADR-0002)", () => {
    expect(requests().filter((r) => new URL(r.url).hostname.endsWith("linkedin.com"))).toHaveLength(0);
    expect(firstReport).toMatch(/site_terms: 1/);
  });

  test("gives up at a Cloudflare challenge, a CAPTCHA or a login wall, without working around them (ADR-0002)", () => {
    // One request each, no retry, and nothing sent to the challenge or CAPTCHA services.
    expect(fetchesOf(site.cloudflare)).toHaveLength(1);
    expect(fetchesOf(site.captcha)).toHaveLength(1);
    expect(fetchesOf(site.loginWall)).toHaveLength(1);
    const hosts = requests().map((r) => new URL(r.url).hostname);
    expect(hosts).not.toContain("challenges.cloudflare.com");
    expect(hosts.filter((host) => /recaptcha|hcaptcha|google\.com/.test(host))).toEqual([]);
    // The login page is never requested, let alone filled in.
    expect(requests().filter((r) => r.url.includes("membres-e2e.example/connexion"))).toHaveLength(0);
    expect(requests().filter((r) => r.method !== "GET" && !/api\.(perplexity|mistral)\.ai/.test(r.url))).toEqual([]);

    expect(firstReport).toMatch(/bot_protection: 2/);
    expect(firstReport).toMatch(/login_wall: 1/);
    expect(firstReport).toMatch(/6 page\(s\) skipped/);
  });

  test("takes a page's JobPosting structured data first, and asks the LLM only for a page without it", async ({ request }) => {
    const stored = await storedJobOffers();
    const fromJsonLd = stored.find((offer) => offer.source_url === site.jsonLd);
    const fromLlm = stored.find((offer) => offer.source_url === site.plain);
    expect(fromJsonLd, JSON.stringify(stored)).toBeDefined();
    expect(fromLlm, JSON.stringify(stored)).toBeDefined();

    const jsonLdOffer = await (await request.get(`${origin}/api/job-offers/${fromJsonLd!.id}`)).json();
    expect(jsonLdOffer).toMatchObject({
      source: { url: site.jsonLd },
      title: `Directeur administratif et financier (H/F) – réf. ${tag}`,
      employer: "Acme Industrie",
      location: "Lyon (69002)",
      salary: { min: 110_000, max: 130_000 },
    });
    expect(jsonLdOffer.content).toContain(`Acme Industrie recrute son DAF (réf. ${tag}).`);
    expect(jsonLdOffer.content).not.toContain("Texte de la page");

    const llmOffer = await (await request.get(`${origin}/api/job-offers/${fromLlm!.id}`)).json();
    expect(llmOffer).toMatchObject({
      source: { url: site.plain },
      title: `Responsable financier (lu par l'IA) – réf. ${tag}`,
      employer: "Cabinet Lumière",
      location: "Lyon",
      contractType: "cdi",
    });

    // The LLM read exactly one page (the one with no JobPosting), and only its public text.
    const llmCalls = requests().filter((r) => r.url.startsWith("https://api.mistral.ai/"));
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]!.body).toContain("Responsable financier");
    expect(llmCalls[0]!.body).not.toContain("Acme Industrie");
    for (const personal of ["Castafiore", "berenice", "Moulinsart"]) expect(llmCalls[0]!.body).not.toContain(personal);
  });

  test("deduplicates against existing Job Offers: a known source URL is not fetched, a mirrored posting is the same Job Offer", async () => {
    // Already captured before the run (with tracking parameters): not fetched again, not stored twice.
    expect(fetchesOf(site.known)).toHaveLength(0);
    // The mirror carries the same posting as the careers site: read, but folded into the same Job Offer.
    expect(fetchesOf(site.mirror)).toHaveLength(1);

    const stored = await storedJobOffers();
    expect(stored.map((offer) => offer.source_url).sort()).toEqual([site.jsonLd, site.plain, `${site.known}?utm_source=linkedin&utm_medium=social`].sort());
    expect(stored.find((offer) => offer.source_url.startsWith(site.known))!.id).toBe(knownOfferId);
    expect(firstReport).toMatch(/: 3 Job Offer\(s\), 6 page\(s\) skipped/);
  });

  test("a second run for the same Profile finds the same Job Offers, stores none again and refetches no known page", async () => {
    const before = await storedJobOffers();
    const fetchedBefore = { jsonLd: fetchesOf(site.jsonLd).length, plain: fetchesOf(site.plain).length, llm: requests().filter((r) => r.url.startsWith("https://api.mistral.ai/")).length };

    await enqueueDiscovery(candidateId, profileId);
    const secondReport = await waitForReport(profileId, 2);

    expect(secondReport).toMatch(/: 3 Job Offer\(s\), 6 page\(s\) skipped/);
    expect(await storedJobOffers()).toEqual(before);
    expect(fetchesOf(site.jsonLd)).toHaveLength(fetchedBefore.jsonLd);
    expect(fetchesOf(site.plain)).toHaveLength(fetchedBefore.plain);
    expect(requests().filter((r) => r.url.startsWith("https://api.mistral.ai/"))).toHaveLength(fetchedBefore.llm);
    // Still never past robots.txt, site terms or bot protection.
    expect(fetchesOf(site.robotsBlocked)).toHaveLength(0);
    expect(requests().filter((r) => new URL(r.url).hostname.endsWith("linkedin.com"))).toHaveLength(0);
  });
});

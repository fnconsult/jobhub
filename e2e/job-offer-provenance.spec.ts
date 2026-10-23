import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { jobOfferPage, modelsInWords } from "../apps/web/src/ai-activity";
import { createJobOffers } from "../apps/web/src/job-offers";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #329: Job Offers keep their Provenance (ADR-0034). Driven through the public entry points: the
// worker (apps/worker, `tsx src/main.ts`) working the "job-discovery.run" queue on the app's database, a
// Job Offer captured over the web app's HTTP API (as the extension does, with no Provenance), and the
// `/offres/[id]` loader AI Activity's pane reads (apps/web/src/ai-activity). The outside world is
// e2e/support/fake-job-sites.mjs, preloaded into the worker. A Job Offer is shared and has no Candidate:
// nothing in its Provenance may name one.
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-offer-provenance-${tag}`);
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

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
const searchCriteria = { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] };

const site = {
  jsonLd: `https://carrieres.acme-e2e.example/offres/daf-lyon-${tag}`,
  plain: `https://emplois.lyon-e2e.example/annonce/${tag}`,
  before: `https://avant-e2e.example/offre/${tag}`,
};

type StoredStep = { kind: string; activity: string; tool?: string; task?: string; provider?: string; model?: string; outcome: string };
type StoredProvenance = { v: number; steps: StoredStep[]; sites: { kind: string; domain?: string; links: string[] }[]; startedAt: string; wallMs: number };

let worker: ChildProcess | undefined;
let workerOutput = "";
let candidateId = "";
let profileId = "";
let beforeId = "";

const withClient = async <T>(use: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
};

const rawProvenance = (sourceUrl: string) =>
  withClient(async (client) => {
    const { rows } = await client.query("SELECT id, provenance, provenance::text AS text FROM job_offer WHERE source_url = $1", [sourceUrl]);
    return rows[0] as { id: string; provenance: StoredProvenance | null; text: string | null } | undefined;
  });

/** The loader AI Activity's pane reads for `/offres/[id]`, on the app's own database. */
async function loadedPage(id: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    return await jobOfferPage(createJobOffers(pool), id);
  } finally {
    await pool.end();
  }
}
const t = ((key: string) => key.split(".").reduce((node: any, part) => node?.[part], fr)) as never;

test.describe("Job Offers keep their Provenance (#329)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    mkdirSync(workDir, { recursive: true });
    const page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("offer-provenance"));
    candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria } });
    expect(created.status(), await created.text()).toBe(201);
    profileId = (await created.json()).id;
    // A Job Offer captured the way the extension does, which keeps no Provenance: « modèle non enregistré ».
    const captured = await page.request.post("/api/job-offers", {
      headers: { origin },
      data: { source: { url: site.before }, title: `Contrôleur de gestion – réf. ${tag}`, content: `Offre capturée avant (réf. ${tag}).`, location: "Lyon" },
    });
    expect(captured.status(), await captured.text()).toBe(200);
    beforeId = (await captured.json()).id;
    await page.close();

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
        NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
    await expect.poll(() => workerOutput, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
    const boss = new PgBoss({ connectionString: databaseUrl });
    await boss.start();
    try {
      await boss.send("job-discovery.run", { candidateId, profileId });
    } finally {
      await boss.stop({ graceful: false });
    }
    await expect.poll(() => workerOutput.split("\n").some((line) => line.startsWith(`[job-discovery] profile ${profileId}:`)), { timeout: 90_000, message: workerOutput }).toBe(true);
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

  test("a newly found offer read by an AI has a Provenance with its search step, its page read and the model that read it", async () => {
    const found = await rawProvenance(site.plain);
    expect(found, workerOutput).toBeDefined();
    const provenance = found!.provenance!;
    expect(provenance, "the offer found by discovery has a Provenance").not.toBeNull();

    // The search that found it, then the page read, then the model that read the page.
    const searchIndex = provenance.steps.findIndex((step) => step.activity === "web_search");
    const readIndex = provenance.steps.findIndex((step) => step.kind === "tool" && step.activity === "read");
    const modelIndex = provenance.steps.findIndex((step) => step.kind === "ai" && step.activity === "read");
    expect(searchIndex, JSON.stringify(provenance.steps)).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeGreaterThan(searchIndex);
    expect(modelIndex).toBeGreaterThan(readIndex);
    expect(provenance.steps[modelIndex]).toMatchObject({ provider: "mistral", model: expect.stringMatching(/mistral/), outcome: "ok" });
    // Its Provenance site is the offer page, by its domain.
    expect(provenance.sites).toEqual([expect.objectContaining({ kind: "web", domain: "emplois.lyon-e2e.example" })]);
    expect(provenance.sites[0]!.links.join()).toContain(`/annonce/${tag}`);

    // What AI Activity's pane reads for the offer's page names that model.
    const [element] = await loadedPage(found!.id);
    expect(element!.provenance).toEqual(provenance);
    expect(modelsInWords(element!, t)).toEqual(["Perplexity", "Mistral Large"]);
  });

  test("a newly found offer read from structured data has its search step and page read, with no model (none read it)", async () => {
    const found = await rawProvenance(site.jsonLd);
    expect(found?.provenance, workerOutput).not.toBeNull();
    const { steps, sites } = found!.provenance!;
    expect(steps.some((step) => step.activity === "web_search")).toBe(true);
    expect(steps.some((step) => step.kind === "tool" && step.activity === "read")).toBe(true);
    expect(steps.some((step) => step.kind === "ai" && step.activity === "read")).toBe(false);
    expect(sites).toEqual([expect.objectContaining({ kind: "web", domain: "carrieres.acme-e2e.example" })]);
  });

  test("an offer from before, captured with no Provenance, shows « modèle non enregistré »", async () => {
    expect((await rawProvenance(site.before))?.provenance).toBeNull();
    const [element] = await loadedPage(beforeId);
    expect(element).toEqual({ kind: "job_offer", provenance: null });
    expect(fr.aiActivity.modelNotRecorded).toBe("modèle non enregistré");
    expect(modelsInWords(element!, t)).toEqual(["modèle non enregistré"]);
  });

  test("no Candidate id, Profile id or name is in any job_offer.provenance", async () => {
    const stored = await withClient(async (client) => (await client.query("SELECT provenance::text AS text FROM job_offer WHERE provenance IS NOT NULL AND source_url LIKE $1", [`%${tag}%`])).rows);
    expect(stored.length).toBeGreaterThanOrEqual(2);
    for (const { text } of stored) {
      for (const personal of [candidateId, profileId, "Castafiore", "Bérénice", "berenice"]) expect(text, `"${personal}" in a Job Offer's Provenance`).not.toContain(personal);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
  });
});

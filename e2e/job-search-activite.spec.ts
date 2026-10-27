import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #404: Back Office « Activité ». A Job Search a Candidate starts over the web app's HTTP API, worked by the real
// worker (apps/worker, `tsx src/main.ts`) against e2e/support/fake-job-sites.mjs (Perplexity's Search API and the job
// sites), appears in Activité › Recherches with its searches; a super-admin opens its panel, its Appels IA and, audited,
// its Job Search. Support reads the Recherches but cannot open Appels IA; the former Journal and Journaux IA addresses
// lead to their tab.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const runs = admin.discoveryRuns;
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
// Its own permanent super-admin (ADMIN_EMAILS): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "activite-office@e2e.jobbbox.test";
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-activite-${tag}`);
const targetRole = `Directrice administrative et financière ${tag}`;

const masterCv = {
  fullName: "Bianca Castafiore",
  headline: "Directrice administrative et financière",
  email: "bianca.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans de finance d'entreprise.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation"],
  languages: [],
};

const tr = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));

let worker: ChildProcess | undefined;
let workerOutput = "";

function startWorker() {
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
      NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-job-sites.mjs")}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (workerOutput += chunk));
}

async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "fr-FR" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The super-admin grants Support to the account with `email` on the Administrateurs page. */
async function grantSupport(superAdmin: Page, email: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles.support }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toHaveText(tr(admin.administrators.granted, { roles: admin.roles.support }));
}

test.describe("Back Office « Activité » (#404)", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let jobSearchId: string;
  let runId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(150_000);
    mkdirSync(workDir, { recursive: true });
    startWorker();
    await expect.poll(() => workerOutput, { timeout: 90_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);

    // A Candidate starts a Job Search for their Profile; the worker runs it.
    const candidate = await personPage(browser, newAddress("activite-candidate"));
    const created = await candidate.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole, locations: ["Lyon"], contractTypes: ["cdi"] } } });
    expect(created.status(), await created.text()).toBe(201);
    const started = await candidate.request.post("/api/job-searches", { headers: { origin }, data: { profileId: (await created.json()).id } });
    expect(started.status(), await started.text()).toBe(201);
    jobSearchId = ((await started.json()) as { id: string }).id;
    await expect
      .poll(async () => (await query<{ status: string }>("SELECT status FROM job_search WHERE id = $1", [jobSearchId]))[0]?.status, { timeout: 90_000, message: workerOutput })
      .toBe("done");
    await expect
      .poll(async () => (await query<{ run_id: string }>("SELECT run_id FROM discovery_run_detail WHERE job_search_id = $1", [jobSearchId]))[0]?.run_id, { timeout: 30_000, message: workerOutput })
      .toBeTruthy();
    runId = (await query<{ run_id: string }>("SELECT run_id FROM discovery_run_detail WHERE job_search_id = $1", [jobSearchId]))[0]!.run_id;
    await candidate.context().close();
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

  test("a Job Search run appears in Activité › Recherches with its searches, its funnel and its Skip reasons", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);

    // Activité, in the sidebar, opens its first tab.
    await office.goto("/admin");
    await office.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.sections.activity, exact: true }).click();
    await expect(office).toHaveURL(/\/admin\/activite\/recherches$/);
    await expect(office.getByRole("heading", { level: 1 })).toHaveText(admin.activity.title);
    await expect(office.getByRole("navigation", { name: admin.activity.tabsLabel }).getByRole("link")).toHaveText([admin.activity.tabs.discoveryRuns, admin.activity.tabs.aiMessages, admin.activity.tabs.audit]);

    // One row: a Job Search's, its Profile by pseudonym with its criteria, its provider and why it stopped. No Candidate named.
    const row = office.locator(`tr[data-run="${runId}"]`);
    await expect(row).toContainText(runs.triggers.job_search);
    await expect(row).toContainText(`${targetRole} · Lyon`);
    await expect(row).toContainText(/Profil #[0-9a-f]{4}/);
    await expect(row).toContainText("Perplexity");
    await expect(office.getByTestId("discovery-runs")).not.toContainText("castafiore");

    // Its panel: the Discovery metrics funnel, each search with the query texts it sent, the pages skipped by reason.
    await row.getByRole("link", { name: runs.open }).click();
    const panel = office.locator(`[data-run-panel="${runId}"]`);
    await expect(panel.getByRole("heading", { name: runs.funnelTitle })).toBeVisible();
    await expect(panel.getByText(runs.funnel.providerUrls)).toBeVisible();
    const searches = panel.getByTestId("run-searches").locator("tbody tr");
    await expect(searches.first()).toContainText(runs.kinds.plan);
    await expect(searches.first()).toContainText(`« ${targetRole} » à Lyon`);
    await expect(panel.getByRole("heading", { name: runs.skippedTitle })).toBeVisible();
    await expect(panel).toContainText(runs.skipReasons.site_terms);

    // Its Appels IA: the Candidate's calls during the run, the web search among them.
    await panel.getByRole("link", { name: runs.aiCallsLink }).click();
    await expect(office).toHaveURL(/\/admin\/activite\/appels-ia\?/);
    await expect(office.getByText(admin.aiMessages.ofRun)).toBeVisible();
    await expect(office.getByRole("row").filter({ hasText: admin.aiUsage.tasks.web_search }).first()).toBeVisible();

    // Its Job Search, opened by a super-admin: the view goes to Actions des administrateurs.
    await office.goto(`/admin/activite/recherches?periode=all&run=${runId}`);
    await office.locator(`[data-run-panel="${runId}"]`).getByRole("link", { name: runs.jobSearchLink }).click();
    await expect(office.getByRole("heading", { level: 1 })).toHaveText(runs.jobSearch.title);
    await expect(office.getByText(runs.jobSearch.audited)).toBeVisible();
    await office.goto("/admin/activite/actions?section=discovery_runs");
    const viewed = office.getByRole("row").filter({ hasText: runId });
    await expect(viewed).toHaveCount(1);
    await expect(viewed).toContainText(admin.journal.actions.viewed);
    await expect(viewed).toContainText(SUPER_ADMIN);
  });

  test("the former Journal and Journaux IA addresses lead to their tab of Activité, with their filters", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);

    await office.goto("/admin/journal?section=roles&outcome=succeeded");
    await expect(office).toHaveURL(/\/admin\/activite\/actions\?section=roles&outcome=succeeded$/);
    await expect(office.getByRole("navigation", { name: admin.activity.tabsLabel }).getByRole("link", { name: admin.activity.tabs.audit })).toHaveAttribute("aria-current", "page");

    await office.goto("/admin/journaux-ia?outcome=ok");
    await expect(office).toHaveURL(/\/admin\/activite\/appels-ia\?outcome=ok$/);
    await expect(office.getByRole("navigation", { name: admin.activity.tabsLabel }).getByRole("link", { name: admin.activity.tabs.aiMessages })).toHaveAttribute("aria-current", "page");

    const [log] = await query<{ id: string }>("SELECT id FROM ai_message_log ORDER BY at DESC LIMIT 1");
    await office.goto(`/admin/journaux-ia/${log!.id}`);
    await expect(office).toHaveURL(new RegExp(`/admin/activite/appels-ia/${log!.id}$`));

    // The words « journaux » and « historique » are gone from the Back Office's sidebar.
    await expect(office.getByRole("navigation", { name: admin.nav.label })).not.toContainText(/journa|historique/i);
  });

  test("Support reads Activité › Recherches, without the run's Appels IA or Job Search, and cannot open Appels IA", async ({ browser }) => {
    const office = await personPage(browser, SUPER_ADMIN);
    const email = newAddress("activite-support");
    const support = await personPage(browser, email);
    await grantSupport(office, email);

    await support.goto("/admin/activite");
    await expect(support).toHaveURL(/\/admin\/activite\/recherches$/);
    await expect(support.getByRole("navigation", { name: admin.activity.tabsLabel }).getByRole("link")).toHaveText([admin.activity.tabs.discoveryRuns]);
    await support.goto(`/admin/activite/recherches?periode=all&run=${runId}`);
    const panel = support.locator(`[data-run-panel="${runId}"]`);
    await expect(panel.getByTestId("run-searches")).toContainText(`« ${targetRole} » à Lyon`);
    await expect(panel.getByRole("link", { name: runs.aiCallsLink })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: runs.jobSearchLink })).toHaveCount(0);

    expect((await support.goto("/admin/activite/appels-ia"))?.status()).toBe(404);
    expect((await support.goto("/admin/journaux-ia"))?.status()).toBe(404);
    expect((await support.goto(`/admin/activite/recherches/${runId}/recherche`))?.status()).toBe(404);
    expect((await support.goto("/admin/activite/actions"))?.status()).toBe(404);
  });
});

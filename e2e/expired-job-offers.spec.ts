import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PgBoss } from "pg-boss";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #16: Expired Job Offers. Every few days the worker re-checks the source
// page of each Job Offer a Candidate kept, within ADR-0002's rules (robots.txt
// first, never a Forbidden site, never around bot protection), and marks the
// ones no longer published there as Expired Job Offers. Applications on them
// are flagged; their Application Status is never changed automatically.
//
// Driven through the public entry points: the worker (its schedule, and its
// "job-offers.recheck-sources" job run as that schedule would, with the clock
// moved days ahead) against the web app's database, and the web app (HTTP API
// and pages) for the Candidate. The job sites are played by
// e2e/support/fake-source-sites.mjs, preloaded into the worker, which logs every
// request the worker sends.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const workDir = path.join(os.tmpdir(), `jobhub-e2e-recheck-${tag}`);
const requestLog = path.join(workDir, "requests.jsonl");
const SOURCE_RECHECK = "job-offers.recheck-sources";
const HOUR = 3_600_000;

/** The source pages of the Job Offers the Candidate keeps, by what the source says on the first re-check. */
const source = {
  published: `https://encore-e2e.example/offre/${tag}`,
  notFound: `https://disparue-e2e.example/offre/${tag}`,
  gone: `https://retiree-e2e.example/offre/${tag}`,
  pastValidThrough: `https://perimee-e2e.example/offre/${tag}`,
  noticeOnPage: `https://pourvue-e2e.example/annonce/${tag}`,
  sentHome: `https://accueil-e2e.example/emplois/${tag}`,
  robotsBlocked: `https://bloque-e2e.example/offre/${tag}`,
  cloudflare: `https://protege-e2e.example/offre/${tag}`,
  linkedIn: `https://www.linkedin.com/jobs/view/${tag}`,
} as const;
type Source = keyof typeof source;
const expiredOnFirstRecheck: Source[] = ["notFound", "gone", "pastValidThrough", "noticeOnPage", "sentHome"];
const unreadable: Source[] = ["robotsBlocked", "cloudflare", "linkedIn"];

type LoggedRequest = { url: string; method: string; headers: Record<string, string> };
const requests = (): LoggedRequest[] =>
  existsSync(requestLog) ? readFileSync(requestLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const fetchesOf = (url: string) => requests().filter((r) => r.url === url);
const fetchCounts = () => Object.fromEntries(Object.entries(source).map(([name, url]) => [name, fetchesOf(url).length])) as Record<Source, number>;

/** When this run's Job Offers were captured: the re-checks are timed from it. */
let capturedAt = 0;

/**
 * Runs the worker's re-check job once, as its daily schedule would, with the
 * worker's clock `hoursAfterCapture` after the capture. The suite's other Job
 * Offers share the database and come first (longest unchecked first), so it
 * runs again while a run fills its whole batch. Returns the worker's report lines.
 */
function recheckSourcesAt(hoursAfterCapture: number, phase: "first" | "later" = "first"): string[] {
  const reports: string[] = [];
  for (let run = 0; run < 20; run++) {
    const result = spawnSync(
      path.resolve("node_modules/.bin/tsx"),
      ["e2e/support/worker-job.ts", SOURCE_RECHECK, String((capturedAt + hoursAfterCapture * HOUR - Date.now()) / HOUR)],
      {
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          E2E_RECHECK_TAG: tag,
          E2E_RECHECK_LOG: requestLog,
          E2E_RECHECK_PHASE: phase,
          NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-source-sites.mjs")}`,
        },
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const report = result.stdout.split("\n").find((line) => line.startsWith("[source-recheck]"));
    expect(report, result.stdout).toBeDefined();
    reports.push(report!);
    if (!/^\[source-recheck\] 100 Job Offer/.test(report!)) return reports;
  }
  throw new Error(`The re-check never caught up: ${reports.join("\n")}`);
}

async function jobOffer(request: APIRequestContext, id: string): Promise<{ id: string; expiredAt?: string }> {
  const response = await request.get(`${origin}/api/job-offers/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function application(page: Page, id: string): Promise<{ status: string; jobOffer: { expiredAt?: string } }> {
  const response = await page.request.get(`/api/applications/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test.describe("Expired Job Offers (worker job job-offers.recheck-sources)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  let page: Page;
  const offerIds = {} as Record<Source, string>;
  /** Applications the Candidate made, and the status each was left at by hand. */
  const applications = {} as Record<"published" | "notFound" | "noticeOnPage", { id: string; status: string }>;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    mkdirSync(workDir, { recursive: true });
    page = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(page, newAddress("expired-offers"));
    const profile = await page.request.post("/api/profiles", {
      headers: { origin },
      data: {
        masterCv: {
          fullName: "Claire Martin",
          headline: "Directrice financière",
          email: "claire.martin@example.fr",
          phone: "",
          location: "Lyon",
          summary: "",
          experience: [],
          education: [],
          skills: ["IFRS"],
          languages: [],
        },
        searchCriteria: { targetRole: "DAF", location: "Lyon" },
      },
    });
    expect(profile.status(), await profile.text()).toBe(201);
    const profileId: string = (await profile.json()).id;

    capturedAt = Date.now();
    for (const [name, url] of Object.entries(source) as [Source, string][]) {
      const captured = await page.request.post("/api/job-offers", {
        headers: { origin },
        data: { source: { url }, title: `Offre ${name} – réf. ${tag}`, content: `Offre ${name} capturée par la Candidate (réf. ${tag}).`, location: "Lyon" },
      });
      expect(captured.status(), await captured.text()).toBe(200);
      offerIds[name] = (await captured.json()).id;
    }

    // Applications at different Application Statuses, set by hand.
    for (const [name, status] of [["published", "applied"], ["notFound", "interview"], ["noticeOnPage", "followed_up"]] as const) {
      const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: offerIds[name], profileId } });
      expect(saved.ok(), await saved.text()).toBe(true);
      const id: string = (await saved.json()).id;
      const changed = await page.request.patch(`/api/applications/${id}`, { headers: { origin }, data: { status } });
      expect(changed.status(), await changed.text()).toBe(200);
      applications[name] = { id, status };
    }
  });

  test.afterAll(async () => {
    await page?.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  test("the worker schedules the re-check of Job Offer sources daily", async () => {
    // The worker's own entry point, as deployed: it registers its schedules on start.
    let output = "";
    const worker: ChildProcess = spawn("npx", ["tsx", "src/main.ts"], {
      cwd: path.resolve("apps/worker"),
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: databaseUrl,
        E2E_RECHECK_TAG: tag,
        E2E_RECHECK_LOG: requestLog,
        NODE_OPTIONS: `--import=${path.resolve("e2e/support/fake-source-sites.mjs")}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [worker.stdout!, worker.stderr!]) stream.on("data", (chunk) => (output += chunk));
    const boss = new PgBoss({ connectionString: databaseUrl });
    try {
      await expect.poll(() => output, { timeout: 60_000 }).toMatch(/\[worker\] running \d+ job\(s\)/);
      await boss.start();
      const schedules = await boss.getSchedules(SOURCE_RECHECK);
      expect(schedules.map(({ cron }) => cron)).toEqual(["0 4 * * *"]);

      // Run now, the job finds nothing due: the Job Offers were captured minutes ago.
      await boss.send(SOURCE_RECHECK, {});
      await expect.poll(() => output, { timeout: 60_000, message: output }).toMatch(/\[source-recheck\] \d+ Job Offer\(s\) re-checked/);
      for (const url of Object.values(source)) expect(fetchesOf(url), url).toHaveLength(0);
    } finally {
      await boss.stop({ graceful: false });
      const exited = new Promise((resolve) => worker.once("exit", resolve));
      worker.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (worker.exitCode === null) worker.kill("SIGKILL");
    }
  });

  test("a Job Offer is not re-checked before a few days have passed", async () => {
    recheckSourcesAt(3 * 24 - 1);
    expect(fetchCounts()).toEqual(Object.fromEntries(Object.keys(source).map((name) => [name, 0])));
    for (const id of Object.values(offerIds)) expect((await jobOffer(page.request, id)).expiredAt).toBeUndefined();
  });

  test("a few days later the re-check marks the Job Offers no longer published at their source as expired", async () => {
    recheckSourcesAt(3 * 24 + 1);

    for (const name of ["published", ...expiredOnFirstRecheck] as Source[]) expect(fetchesOf(source[name]), name).toHaveLength(1);
    for (const name of expiredOnFirstRecheck) {
      const offer = await jobOffer(page.request, offerIds[name]);
      expect(offer.expiredAt, `${name} expired`).toBeDefined();
      // Expired as of the re-check that found it (the worker's clock), not before the capture.
      expect(Date.parse(offer.expiredAt!)).toBeGreaterThan(capturedAt + 3 * 24 * HOUR);
    }
    // Still published (valid until next year): not expired.
    expect((await jobOffer(page.request, offerIds.published)).expiredAt).toBeUndefined();
  });

  test("the re-check stays within ADR-0002: robots.txt first, no Forbidden site, nothing around bot protection", async () => {
    const urls = requests().map((r) => r.url);
    for (const name of ["published", ...expiredOnFirstRecheck, "cloudflare"] as Source[]) {
      const robots = `${new URL(source[name]).origin}/robots.txt`;
      expect(urls.indexOf(robots), `robots.txt read before ${name}`).toBeGreaterThanOrEqual(0);
      expect(urls.indexOf(robots)).toBeLessThan(urls.indexOf(source[name]));
    }
    // robots.txt forbids the page: never fetched.
    expect(fetchesOf("https://bloque-e2e.example/robots.txt").length).toBeGreaterThanOrEqual(1);
    expect(fetchesOf(source.robotsBlocked)).toHaveLength(0);
    // LinkedIn's terms forbid crawling: not even its robots.txt.
    expect(requests().filter((r) => new URL(r.url).hostname.endsWith("linkedin.com"))).toEqual([]);
    // A Cloudflare challenge: one request, no retry, nothing sent to the challenge service.
    expect(fetchesOf(source.cloudflare)).toHaveLength(1);
    expect(requests().map((r) => new URL(r.url).hostname)).not.toContain("challenges.cloudflare.com");
    // Only reads, as the crawler that introduces itself.
    const ours = requests().filter((r) => r.url.includes("-e2e.example"));
    expect(ours.filter((r) => r.method !== "GET")).toEqual([]);
    for (const r of ours) expect(r.headers["user-agent"]).toMatch(/bot/i);

    // A source we may not or cannot read says nothing: those Job Offers are not expired.
    for (const name of unreadable) expect((await jobOffer(page.request, offerIds[name])).expiredAt, name).toBeUndefined();
  });

  test("a Job Offer just re-checked is not read again the next day", async () => {
    const before = fetchCounts();
    recheckSourcesAt(4 * 24 + 1);
    const after = fetchCounts();
    for (const name of ["published", ...expiredOnFirstRecheck] as Source[]) expect(after[name], name).toBe(before[name]);
  });

  test("it is re-checked again every few days, and an Expired Job Offer not before two weeks", async () => {
    const before = fetchCounts();
    // The still-published posting is now gone (410).
    recheckSourcesAt(6 * 24 + 2, "later");
    const after = fetchCounts();

    expect(after.published).toBe(before.published + 1);
    expect((await jobOffer(page.request, offerIds.published)).expiredAt).toBeDefined();
    for (const name of expiredOnFirstRecheck) expect(after[name], name).toBe(before[name]);
    // Still never past robots.txt or a Forbidden site's terms.
    expect(after.robotsBlocked).toBe(0);
    expect(after.linkedIn).toBe(0);
    expect((await jobOffer(page.request, offerIds.robotsBlocked)).expiredAt).toBeUndefined();
  });

  test("Applications on an Expired Job Offer are flagged and keep the Application Status the Candidate set", async () => {
    // Over the HTTP API: flagged through their Job Offer, status untouched.
    for (const { id, status } of Object.values(applications)) {
      const read = await application(page, id);
      expect(read.status).toBe(status);
      expect(read.jobOffer.expiredAt).toBeDefined();
    }

    // In the list: each one flagged in words, its status as the Candidate left it.
    await page.goto("/candidatures");
    for (const [name, { status }] of Object.entries(applications)) {
      const row = page.getByRole("row", { name: new RegExp(`Offre ${name} – réf. ${tag}`) });
      await expect(row.getByText(fr.applications.expired, { exact: true })).toBeVisible();
      await expect(row.getByLabel(fr.application.statusLabel)).toHaveValue(status);
    }

    // On the board: still in the column of its status.
    await page.getByRole("link", { name: fr.applications.boardView }).click();
    const interview = page.getByRole("region", { name: fr.applicationStatuses.interview });
    const card = interview.getByRole("listitem").filter({ hasText: `Offre notFound – réf. ${tag}` });
    await expect(card.getByText(fr.applications.expired, { exact: true })).toBeVisible();

    // On the Application page: said in words, and the decision left to the Candidate.
    await page.goto(`/candidatures/${applications.notFound.id}`);
    const notice = page.getByRole("status").filter({ hasText: fr.application.expiredNotice });
    await expect(notice).toContainText(fr.jobOffer.expired.split("{{date}}")[0]);
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("interview");

    // The Candidate still changes it by hand, and the next re-check leaves it.
    await page.getByLabel(fr.application.statusLabel).selectOption({ label: fr.applicationStatuses.abandoned });
    await expect(page.getByRole("status").filter({ hasText: fr.application.statusSaved })).toBeVisible();
    recheckSourcesAt(9 * 24 + 3, "later");
    expect((await application(page, applications.notFound.id)).status).toBe("abandoned");
    expect((await application(page, applications.published.id)).status).toBe("applied");
    expect((await application(page, applications.noticeOnPage.id)).status).toBe("followed_up");
  });

  test("an Expired Job Offer says so on its own page; one still published does not", async () => {
    // robots.txt keeps us from reading its source: as far as we know, it is still published.
    await page.goto(`/offres/${offerIds.robotsBlocked}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Offre robotsBlocked – réf. ${tag}`);
    await expect(page.getByText(fr.jobOffer.expired.split("{{date}}")[0])).toHaveCount(0);

    await page.goto(`/offres/${offerIds.gone}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Offre gone – réf. ${tag}`);
    await expect(page.getByRole("status").filter({ hasText: fr.jobOffer.expired.split("{{date}}")[0] })).toBeVisible();
  });
});

import { spawnSync } from "node:child_process";
import path from "node:path";
import { API_VERSION, API_VERSION_HEADER, EXTENSION_VERSION_HEADER } from "@jobhub/shared";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { e2eExtensionDir, unpackedExtensionId } from "./support/extension";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #924, through the public entry point (HTTP, the extension's Origin): the actions done from the extension write
// one Extension Event each, the same from the web write none; the errors route takes the extension's reports only, within
// its schema, and keeps no `url`; the worker purges what is due; Data export and Account deletion cover the table.
// (The page that cannot be captured, in the browser itself: e2e/extension.spec.ts.)
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const extensionOrigin = `chrome-extension://${unpackedExtensionId(e2eExtensionDir)}`;
const VERSION = "9.9.9";

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const byte = () => 1 + Math.floor(Math.random() * 254);

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};
const searchCriteria = { targetRole: "DAF", locations: ["Lyon"] };
const offer = () => ({
  source: { url: `https://www.welcometothejungle.com/fr/jobs/daf-${unique()}` },
  title: "DAF H/F",
  content: `Acme Industrie recrute son DAF (réf. ${unique()}), pour piloter la clôture des comptes.`,
  employer: "Acme Industrie",
});

/** What the caller sends: the extension's Origin and headers, or the web app's. A Guest has no cookies. */
const fromExtension = { origin: extensionOrigin, [API_VERSION_HEADER]: String(API_VERSION), [EXTENSION_VERSION_HEADER]: VERSION };
const fromWeb = { origin };

let database: pg.Client;
test.beforeAll(async () => {
  database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
});
test.afterAll(async () => {
  await database.end();
});

type Row = { kind: string; candidate_id: string | null; extension_version: string | null; object_type: string | null; error_code: string | null; page_domain: string | null; place: string | null; message_key: string | null; route: string | null; http_status: number | null; browser: string | null };
const rowsSince = async (since: Date, candidateId: string | null, where = "TRUE") =>
  (
    await database.query<Row>(
      `SELECT * FROM extension_event WHERE at >= $1 AND candidate_id IS NOT DISTINCT FROM $2 AND ${where} ORDER BY id`,
      [since, candidateId],
    )
  ).rows;
const kindsSince = async (since: Date, candidateId: string | null) => (await rowsSince(since, candidateId)).map((row) => row.kind);

async function guest(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: origin, extraHTTPHeaders: { "x-forwarded-for": `10.${byte()}.${byte()}.${byte()}` } });
}
const cvFile = () => ({ name: "CV Marie Dupont.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV)) });

async function ok(response: { status(): number; text(): Promise<string> }, ...statuses: number[]) {
  expect(statuses, `status ${response.status()}: ${await response.text()}`).toContain(response.status());
}

/** The five actions as `headers` say where they come from; `api` is a Guest, or a Candidate when `candidate`. */
async function doEveryAction(api: APIRequestContext, headers: Record<string, string>, candidate: boolean) {
  const captured = await api.post("/api/job-offers", { data: offer(), headers });
  await ok(captured, 200);
  const jobOfferId = (await captured.json()).id as string;
  const scored = await api.post("/api/match-score", { data: { jobOfferId, cv: masterCv, searchCriteria }, headers });
  await ok(scored, 200);
  const drafted = await api.post("/api/cv/draft", { multipart: { cv: cvFile() }, headers });
  await ok(drafted, 200);
  if (!candidate) return;
  const profile = await api.post("/api/profiles", { data: { masterCv, searchCriteria }, headers });
  await ok(profile, 201);
  const profileId = (await profile.json()).id as string;
  const application = await api.post("/api/applications", { data: { jobOfferId, profileId }, headers });
  await ok(application, 201);
}

test.describe("Extension Events: actions", () => {
  test("a Guest's Capture, Match Score and CV draft from the extension write one row each, the same from the web none", async () => {
    const api = await guest();
    const since = new Date();

    await doEveryAction(api, fromWeb, false);
    expect(await kindsSince(since, null)).toEqual([]);

    await doEveryAction(api, fromExtension, false);
    const rows = await rowsSince(since, null);
    expect(rows.map((row) => row.kind)).toEqual(["capture", "match_score", "cv_draft"]);
    for (const row of rows) expect(row).toMatchObject({ candidate_id: null, extension_version: VERSION });
    expect(rows[0]).toMatchObject({ object_type: "job_offer" });
    await api.dispose();
  });

  test("a Candidate's five actions from the extension write one row each, tied to them; the same from the web none", async ({ page }) => {
    const email = newAddress("ext-events-actions");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "standard"); // more Match Scores than the Free Plan's one a week
    const candidateId = await candidateIdOf(email);
    const since = new Date();

    await doEveryAction(page.request, fromWeb, true);
    expect(await kindsSince(since, candidateId)).toEqual([]);

    await doEveryAction(page.request, fromExtension, true);
    const rows = await rowsSince(since, candidateId);
    expect(rows.map((row) => row.kind).sort()).toEqual(["application_created", "capture", "cv_draft", "match_score", "profile_created"]);
    for (const row of rows) expect(row).toMatchObject({ candidate_id: candidateId, extension_version: VERSION });
  });
});

test.describe("Extension Events: POST /api/extension/events", () => {
  const report = (api: APIRequestContext, headers: Record<string, string>, data: unknown) => api.post("/api/extension/events", { data, headers });

  test("refuses an origin that is not the extension's, writing nothing", async () => {
    const api = await guest();
    const since = new Date();
    const body = { errorCode: "captureImpossible", place: "page_button", pageDomain: "example.com" };
    expect((await report(api, fromWeb, body)).status()).toBe(403);
    expect((await report(api, { origin: "https://evil.example" }, body)).status()).toBe(403);
    expect((await report(api, {}, body)).status()).toBe(403);
    // Only what this body would have written: a Guest's row from another spec running beside this one (the real
    // extension's Capture, e2e/extension-unrecognised.spec.ts) falls in the same window, and rows do not name their caller.
    expect(await rowsSince(since, null, "kind = 'error' AND page_domain = 'example.com'")).toEqual([]);
    await api.dispose();
  });

  test("refuses a body outside the schema with 400, writing nothing", async () => {
    const api = await guest();
    const since = new Date();
    for (const body of [{}, { errorCode: "captureImpossible" }, { errorCode: "x y", place: "page_button" }, { errorCode: "boom", place: "elsewhere" }, { errorCode: "boom", place: "side_panel", pageDomain: "https://a.example/p?q=1" }, { errorCode: "boom", place: "side_panel", httpStatus: "500" }, []]) {
      const response = await report(api, fromExtension, body);
      expect(response.status(), JSON.stringify(body)).toBe(400);
    }
    // Only what these bodies would have written (see the test above): an error with one of their codes.
    expect(await rowsSince(since, null, "kind = 'error' AND (error_code IN ('x y', 'boom') OR (error_code = 'captureImpossible' AND place IS NULL))")).toEqual([]);
    await api.dispose();
  });

  test("keeps the domain alone: a `url` sent is ignored, never written; the Guest's row has no Candidate", async () => {
    const api = await guest();
    const since = new Date();
    const response = await report(api, fromExtension, {
      errorCode: "captureImpossible",
      messageKey: "extension.captureImpossible",
      place: "page_button",
      pageDomain: "www.example-jobs.com",
      url: "https://www.example-jobs.com/jobs/secret-path?token=abc",
    });
    expect(response.status()).toBe(204);
    const [row, ...others] = await rowsSince(since, null);
    expect(others).toEqual([]);
    expect(row).toMatchObject({ kind: "error", candidate_id: null, error_code: "captureImpossible", place: "page_button", page_domain: "www.example-jobs.com", extension_version: VERSION });
    expect(JSON.stringify(row)).not.toMatch(/secret-path|token=abc|https?:/);
    await api.dispose();
  });
});

const worker = (job: string) => {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", job, "0"], {
    env: { ...process.env, DATABASE_URL: databaseUrl, MAIL_TRANSPORT: "console" },
    encoding: "utf8",
  });
  expect(run.status, run.stdout + run.stderr).toBe(0);
};

const candidateIdOf = async (email: string) => (await database.query<{ id: string }>(`SELECT id FROM candidate WHERE lower(email) = lower($1)`, [email])).rows[0]!.id;

async function exportOf(page: Page) {
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  return response.json();
}

test.describe("Extension Events: retention, Data export and Account deletion", () => {
  test("the worker's purge deletes the rows due: a Candidate's after 12 months, a Guest's after 30 days", async ({ page }) => {
    const email = newAddress("ext-events-purge");
    await signInWithMagicLink(page, email);
    const candidateId = await candidateIdOf(email);
    const tag = `purge-${unique()}`;
    const insert = async (candidate: string | null, ago: string) =>
      (
        await database.query<{ id: string }>(
          `INSERT INTO extension_event (at, kind, candidate_id, extension_version) VALUES (now() - $1::interval, 'capture', $2, $3) RETURNING id`,
          [ago, candidate, tag],
        )
      ).rows[0]!.id;
    const due = [await insert(candidateId, "13 months"), await insert(null, "31 days")];
    const kept = [await insert(candidateId, "11 months"), await insert(null, "29 days"), await insert(candidateId, "2 days")];

    worker("extension-events.purge");

    const left = (await database.query<{ id: string }>(`SELECT id FROM extension_event WHERE extension_version = $1`, [tag])).rows.map((row) => row.id);
    expect(left.sort()).toEqual([...kept].sort());
    for (const id of due) expect(left).not.toContain(id);
  });

  test("Data export lists the Candidate's own rows; deleting the account removes them", async ({ page }) => {
    const email = newAddress("ext-events-account");
    await signInWithMagicLink(page, email);
    const candidateId = await candidateIdOf(email);
    const other = await browserlessOther();
    const since = new Date();

    await ok(await page.request.post("/api/job-offers", { data: offer(), headers: fromExtension }), 200);
    await ok(await page.request.post("/api/extension/events", { data: { errorCode: "captureImpossible", place: "page_button", pageDomain: "example.com" }, headers: fromExtension }), 204);
    await ok(await other.post("/api/extension/events", { data: { errorCode: "boom", place: "side_panel" }, headers: fromExtension }), 204);

    const exported = await exportOf(page);
    expect(exported.extensionEvents.map((event: { kind: string }) => event.kind).sort()).toEqual(["capture", "error"]);
    expect(exported.extensionEvents.find((event: { kind: string }) => event.kind === "error").error).toMatchObject({ code: "captureImpossible", pageDomain: "example.com", place: "page_button" });
    expect(JSON.stringify(exported.extensionEvents)).not.toContain(candidateId);
    expect((await rowsSince(since, candidateId)).length).toBe(2);

    const deleted = await page.request.delete("/api/account", { data: { email }, headers: { origin } });
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect(await rowsSince(since, candidateId)).toEqual([]);
    // The Guest's row is not the account's: it stays, for the purge.
    expect((await rowsSince(since, null)).length).toBe(1);
    await other.dispose();
  });
});

const browserlessOther = guest;

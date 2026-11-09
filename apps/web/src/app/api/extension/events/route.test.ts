import { EXTENSION_VERSION_HEADER } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "@/auth/test-support";
import { isTrustedOrigin } from "@/auth/trusted-origin";
import { createExtensionEvents, migrateExtensionEvents, REPORTING_LIMIT } from "@/extension-events";

const WEB = "https://app.jobbbox.example";
const EXTENSION = "chrome-extension://jobbboxextensionid";
const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const handled = vi.hoisted(() => ({ candidate: null as { id: string } | null, events: null as unknown }));
vi.mock("@/auth/server", () => ({
  getAuth: () => ({ options: { baseURL: `${WEB}/` } }),
  getCurrentCandidate: async () => handled.candidate,
  isFromTrustedOrigin: (request: Request) => isTrustedOrigin(request.headers, [WEB, EXTENSION]),
}));
vi.mock("@/extension-events/server", async (original) => ({ ...(await original<object>()), getExtensionEvents: () => handled.events }));

const { POST } = await import("./route");

const captureImpossible = { errorCode: "captureImpossible", messageKey: "extension.captureImpossible", place: "side_panel", pageDomain: "www.indeed.fr" };

describe.skipIf(!connectionString)("POST /api/extension/events: the errors the extension reports (#924; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateExtensionEvents(database);
    handled.events = createExtensionEvents(database);
    handled.candidate = null;
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const report = (body: unknown, headers: Record<string, string> = { origin: EXTENSION }) =>
    POST(new Request(`${WEB}/api/extension/events`, { method: "POST", headers: { "content-type": "application/json", "user-agent": CHROME, ...headers }, body: JSON.stringify(body) }));

  async function rows() {
    return (await database.query(`SELECT kind, candidate_id, extension_version, error_code, place, page_domain, browser FROM extension_event`)).rows;
  }

  it("records a Guest's error from the extension, with its Extension Version and the browser's family: 204", async () => {
    const response = await report(captureImpossible, { origin: EXTENSION, [EXTENSION_VERSION_HEADER]: "0.2.0" });

    expect(response.status).toBe(204);
    expect(await rows()).toEqual([
      { kind: "error", candidate_id: null, extension_version: "0.2.0", error_code: "captureImpossible", place: "side_panel", page_domain: "www.indeed.fr", browser: "Chrome 141" },
    ]);
  });

  it("records a signed-in Candidate's as theirs", async () => {
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const marie: string = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
    handled.candidate = { id: marie };

    expect((await report(captureImpossible)).status).toBe(204);
    expect((await rows())[0]).toMatchObject({ candidate_id: marie });
  });

  it("refuses a call that is not the extension's: the web app's own pages, another site, none", async () => {
    expect((await report(captureImpossible, { origin: WEB })).status).toBe(403);
    expect((await report(captureImpossible, { origin: "https://evil.example" })).status).toBe(403);
    expect((await report(captureImpossible, {})).status).toBe(403);
    expect(await rows()).toEqual([]);
  });

  it("refuses a body outside the schema: 400, nothing recorded", async () => {
    const response = await report({ errorCode: "captureImpossible", place: "somewhere" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ field: "place" }] });
    expect(await rows()).toEqual([]);
  });

  it("ignores a `url` sent along: only the domain is kept", async () => {
    expect((await report({ ...captureImpossible, url: "https://www.indeed.fr/viewjob?jk=1&email=marie.dupont@example.fr" })).status).toBe(204);

    expect(JSON.stringify(await database.query(`SELECT * FROM extension_event`).then((result) => result.rows))).not.toMatch(/viewjob|marie/);
  });

  it(`answers 429 past ${REPORTING_LIMIT} reports from the same Guest's address within the window`, async () => {
    const from = { origin: EXTENSION, "x-forwarded-for": "203.0.113.7" };
    for (let i = 0; i < REPORTING_LIMIT; i++) await report(captureImpossible, from);

    expect((await report(captureImpossible, from)).status).toBe(429);
    expect((await report(captureImpossible, { origin: EXTENSION, "x-forwarded-for": "198.51.100.1" })).status).toBe(204);
  });
});

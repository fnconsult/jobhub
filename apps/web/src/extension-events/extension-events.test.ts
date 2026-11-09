import { APP_ORIGIN, EXTENSION_VERSION_HEADER } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import {
  createExtensionEvents,
  extensionCallFrom,
  extensionEventsOf,
  GUEST_RETENTION_DAYS,
  migrateExtensionEvents,
  purgeExtensionEvents,
  recordExtensionAction,
  REPORTING_LIMIT,
  RETENTION_MONTHS,
  type ExtensionCall,
  type ExtensionEvents,
} from "./index";

const WEB = "https://jobbbox.ai";
const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const CHROME_ON_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.54 Safari/537.36";
const JOB_OFFER = "0b6c2f1e-1111-4111-8111-111111111111";

describe("which call is the extension's, and its version (#924)", () => {
  it("is a call from the extension's Origin, or its GET, with the Extension Version it states", () => {
    const fromExtension = new Headers({ origin: EXTENSION, [EXTENSION_VERSION_HEADER]: "0.2.0" });

    expect(extensionCallFrom(fromExtension, "c-1", WEB)).toEqual({ candidateId: "c-1", extensionVersion: "0.2.0" });
    expect(extensionCallFrom(new Headers({ "sec-fetch-site": "none", "sec-fetch-mode": "cors" }), null, WEB)).toEqual({ candidateId: null, extensionVersion: null });
  });

  it("keeps no Extension Version it cannot read", () => {
    expect(extensionCallFrom(new Headers({ origin: EXTENSION, [EXTENSION_VERSION_HEADER]: "0.2.0; DROP TABLE" }), null, WEB)?.extensionVersion).toBeNull();
  });

  it("is none from the web app, the Jobbbox app or another site: nothing is recorded for them", () => {
    expect(extensionCallFrom(new Headers({ origin: WEB, [EXTENSION_VERSION_HEADER]: "0.2.0" }), "c-1", WEB)).toBeNull();
    expect(extensionCallFrom(new Headers({ origin: APP_ORIGIN, [EXTENSION_VERSION_HEADER]: "0.2.0" }), "c-1", WEB)).toBeNull();
    expect(extensionCallFrom(new Headers({ origin: "https://evil.example" }), null, WEB)).toBeNull();
    expect(extensionCallFrom(new Headers(), null, WEB)).toBeNull();
  });
});

describe.skipIf(!connectionString)("Extension Events (#924; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let now: Date;
  let events: ExtensionEvents;
  const guest = (): ExtensionCall => ({ candidateId: null, extensionVersion: "0.2.0" });
  const asMarie = (): ExtensionCall => ({ candidateId: marie, extensionVersion: "0.2.0" });
  const from = (requester = "guest:203.0.113.7") => ({ userAgent: CHROME_ON_MAC, requester });

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  async function rows() {
    const { rows } = await database.query(`SELECT * FROM extension_event ORDER BY at, id`);
    return rows as Record<string, unknown>[];
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateExtensionEvents(database);
    await migrateExtensionEvents(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    now = new Date("2026-11-09T09:30:00Z");
    events = createExtensionEvents(database, { now: () => now });
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("an action", () => {
    it("is one row: when, its kind, the Candidate, the Extension Version and its object", async () => {
      await recordExtensionAction(database, asMarie(), "capture", { type: "job_offer", id: JOB_OFFER });

      expect(await rows()).toEqual([
        expect.objectContaining({
          kind: "capture",
          candidate_id: marie,
          extension_version: "0.2.0",
          object_type: "job_offer",
          object_id: JOB_OFFER,
          error_code: null,
          page_domain: null,
          at: expect.any(Date),
        }),
      ]);
    });

    it("of a Guest names no one, and no identifier of any kind", async () => {
      await recordExtensionAction(database, guest(), "cv_draft");

      const [row] = await rows();
      expect(row).toMatchObject({ kind: "cv_draft", candidate_id: null, object_type: null, object_id: null });
      expect(Object.keys(row!).sort()).toEqual(
        ["at", "browser", "candidate_id", "error_code", "extension_version", "http_status", "id", "kind", "message_key", "object_id", "object_type", "page_domain", "place", "route"].sort(),
      );
    });
  });

  describe("an error the extension reports", () => {
    const captureImpossible = (more: Record<string, unknown> = {}) => ({
      errorCode: "captureImpossible",
      messageKey: "extension.captureImpossible",
      place: "side_panel",
      pageDomain: "www.welcometothejungle.com",
      ...more,
    });

    it("is one `error` row: its code, message key, place, the page's domain and the browser's family and major version", async () => {
      expect(await events.report(guest(), captureImpossible(), from())).toEqual({ ok: true });

      expect(await rows()).toEqual([
        expect.objectContaining({
          kind: "error",
          candidate_id: null,
          extension_version: "0.2.0",
          error_code: "captureImpossible",
          message_key: "extension.captureImpossible",
          place: "side_panel",
          page_domain: "www.welcometothejungle.com",
          browser: "Chrome 141",
          route: null,
          http_status: null,
        }),
      ]);
    });

    it("of a failed call keeps its route, without query, and its HTTP status", async () => {
      await events.report(asMarie(), { errorCode: "callFailed", route: "/api/match-score?x=marie.dupont@example.fr", httpStatus: 500, place: "side_panel" }, from(marie));

      expect(await rows()).toEqual([expect.objectContaining({ candidate_id: marie, error_code: "callFailed", route: "/api/match-score", http_status: 500, page_domain: null })]);
    });

    it("ignores a page's address sent along, and anything else outside the schema's fields", async () => {
      await events.report(guest(), captureImpossible({ url: "https://www.welcometothejungle.com/fr/jobs/marie?email=marie.dupont@example.fr", text: "Le texte de la page", stack: "Error: at x" }), from());

      const kept = JSON.stringify(await rows());
      expect(kept).not.toMatch(/marie|texte de la page|Error: at/);
      expect(await rows()).toHaveLength(1);
    });

    it.each([
      ["no body", undefined],
      ["no code", { place: "side_panel" }],
      ["an unknown place", { errorCode: "captureImpossible", place: "toolbar" }],
      ["a page's address for its domain", { errorCode: "captureImpossible", place: "side_panel", pageDomain: "https://www.welcometothejungle.com/fr/jobs/1" }],
      ["a code that is not one", { errorCode: "Cette page ne peut pas être capturée", place: "side_panel" }],
      ["an HTTP status that is not one", { errorCode: "callFailed", place: "side_panel", httpStatus: 1000 }],
      ["a route that is not the web app's API", { errorCode: "callFailed", place: "side_panel", route: "https://evil.example/" }],
    ])("refuses %s, recording nothing", async (_, body) => {
      const result = await events.report(guest(), body, from());

      expect(result).toMatchObject({ ok: false, errors: expect.any(Array) });
      expect(await rows()).toEqual([]);
    });

    it(`refuses a (${REPORTING_LIMIT} + 1)th from the same requester within the window, not one from another`, async () => {
      for (let i = 0; i < REPORTING_LIMIT; i++) expect(await events.report(guest(), captureImpossible(), from())).toEqual({ ok: true });

      expect(await events.report(guest(), captureImpossible(), from())).toEqual({ ok: false, refused: "too_many" });
      expect(await events.report(guest(), captureImpossible(), from("guest:198.51.100.1"))).toEqual({ ok: true });
      now = new Date(now.getTime() + 11 * 60_000);
      expect(await events.report(guest(), captureImpossible(), from())).toEqual({ ok: true });
    });
  });

  it("are in the Candidate's Data export, newest first, never another's nor a Guest's", async () => {
    await recordExtensionAction(database, asMarie(), "application_created", { type: "application", id: JOB_OFFER });
    now = new Date(Date.now() + 60_000); // after the action, written at the database's own time
    await events.report(asMarie(), { errorCode: "callFailed", route: "/api/applications", httpStatus: 0, place: "side_panel" }, from(marie));
    await recordExtensionAction(database, guest(), "capture", { type: "job_offer", id: JOB_OFFER });
    const other = await candidate("jean.martin@example.fr");
    await recordExtensionAction(database, { candidateId: other, extensionVersion: null }, "match_score", { type: "job_offer", id: JOB_OFFER });

    const exported = await extensionEventsOf(database, marie);

    expect(exported.map((event) => event.kind)).toEqual(["error", "application_created"]);
    expect(exported[0]).toEqual({
      at: expect.any(Date),
      kind: "error",
      extensionVersion: "0.2.0",
      object: null,
      error: { code: "callFailed", messageKey: null, route: "/api/applications", httpStatus: 0, place: "side_panel", browser: "Chrome 141", pageDomain: null },
    });
    expect(exported[1]).toEqual({ at: expect.any(Date), kind: "application_created", extensionVersion: "0.2.0", object: { type: "application", id: JOB_OFFER }, error: null });
  });

  it("go with the Candidate's account", async () => {
    await recordExtensionAction(database, asMarie(), "profile_created", { type: "profile", id: JOB_OFFER });
    await recordExtensionAction(database, guest(), "capture");

    await database.query(`DELETE FROM candidate WHERE id = $1`, [marie]);

    expect((await rows()).map((row) => row.candidate_id)).toEqual([null]);
  });

  it(`are purged ${RETENTION_MONTHS} months after, a Guest's ${GUEST_RETENTION_DAYS} days after`, async () => {
    const at = async (iso: string, call: ExtensionCall) => {
      await recordExtensionAction(database, call, "capture");
      await database.query(`UPDATE extension_event SET at = $1 WHERE id = (SELECT id FROM extension_event ORDER BY id DESC LIMIT 1)`, [iso]);
    };
    await at("2025-11-08T09:00:00Z", asMarie()); // 12 months and a day
    await at("2025-11-10T09:00:00Z", asMarie()); // kept
    await at("2026-10-09T09:00:00Z", guest()); // 31 days
    await at("2026-10-11T09:00:00Z", guest()); // kept

    expect(await purgeExtensionEvents(database, now)).toBe(2);
    expect(await purgeExtensionEvents(database, now)).toBe(0);
    expect((await rows()).map((row) => [row.candidate_id === null ? "guest" : "marie", (row.at as Date).toISOString().slice(0, 10)])).toEqual([
      ["marie", "2025-11-10"],
      ["guest", "2026-10-11"],
    ]);
  });
});

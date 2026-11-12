import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import {
  createExtensionEventsBackOffice,
  DASHBOARD_DAYS,
  extensionDashboard,
  extensionEventsFilter,
  LIST_LIMIT,
  TOP_DOMAINS,
  type ExtensionEventCount,
} from "./back-office";
import { migrateExtensionEvents } from "./index";

describe("Activité › Extension's filter, read from the page's address (#925)", () => {
  it("reads the type, who, one Candidate, the version and the domain", () => {
    expect(extensionEventsFilter({ type: "error", qui: "guest", version: "0.3.0", domaine: "WWW.Indeed.com " })).toEqual({ kind: "error", who: "guest", version: "0.3.0", domain: "www.indeed.com" });
    expect(extensionEventsFilter({ type: "capture", qui: "candidate" })).toEqual({ kind: "capture", who: "candidate" });
  });

  it("is everything with nothing to read, and drops each field it cannot read, the others still filtering", () => {
    expect(extensionEventsFilter({})).toEqual({});
    expect(extensionEventsFilter(undefined)).toEqual({});
    expect(extensionEventsFilter({ type: "visit", qui: "everyone", version: "0.3; DROP", domaine: "https://www.indeed.com/viewjob?jk=1", candidat: "a b" })).toEqual({});
    expect(extensionEventsFilter({ type: ["error", "capture"], version: "0.3.0" })).toEqual({ version: "0.3.0" });
  });

  it("with one Candidate, shows theirs: a Guest's filter no longer applies", () => {
    expect(extensionEventsFilter({ candidat: "Xy7_k-9", qui: "guest" })).toEqual({ candidate: "Xy7_k-9" });
  });
});

describe("the Dashboard's Extension card, built from the daily counts (#925)", () => {
  const TODAY = "2026-11-10";
  /** `events` Extension Events of `kind` on `day`, by `candidateId` (null: a Guest), on `extensionVersion`. */
  const count = (day: string, kind: ExtensionEventCount["kind"], candidateId: string | null, extensionVersion: string | null, events: number, error?: { code: string; domain: string | null }): ExtensionEventCount => ({
    day,
    kind,
    candidateId,
    extensionVersion,
    errorCode: error?.code ?? null,
    pageDomain: error?.domain ?? null,
    events,
  });
  const captureImpossible = (domain: string | null) => ({ code: "captureImpossible", domain });

  const counts: ExtensionEventCount[] = [
    count("2026-11-10", "capture", "marie", "0.3.0", 3),
    count("2026-11-10", "capture", null, "0.3.0", 2),
    count("2026-11-10", "match_score", "marie", "0.3.0", 4),
    count("2026-11-10", "application_created", "paul", "0.2.0", 1),
    count("2026-11-10", "error", null, "0.3.0", 2, captureImpossible("www.indeed.com")),
    count("2026-11-09", "error", "marie", "0.3.0", 1, captureImpossible("www.indeed.com")),
    count("2026-11-09", "error", "marie", "0.3.0", 5, { code: "callFailed", domain: "www.apec.fr" }),
    count("2026-11-09", "capture", "paul", null, 1),
    count("2026-11-09", "cv_draft", "lea", "0.3.0", 1),
    count("2026-11-09", "profile_created", "lea", "0.3.0", 1),
    // The first day of the 30.
    count("2026-10-12", "error", null, "0.2.0", 1, captureImpossible("a.test")),
    count("2026-10-12", "error", null, "0.2.0", 1, captureImpossible("b.test")),
    count("2026-10-12", "error", null, "0.2.0", 3, captureImpossible("c.test")),
    count("2026-10-12", "error", null, "0.2.0", 1, captureImpossible("d.test")),
    count("2026-10-12", "error", null, "0.2.0", 2, captureImpossible("e.test")),
    count("2026-10-12", "error", null, "0.2.0", 1, captureImpossible(null)),
    // The day before the 30: left out.
    count("2026-10-11", "capture", "marie", "0.1.0", 9),
    count("2026-10-11", "error", "theo", "0.1.0", 9, captureImpossible("old.test")),
  ];

  it("has every one of the 30 days, the oldest first, today the last, a day with nothing at 0", () => {
    const card = extensionDashboard(counts, TODAY);

    expect(card.days).toHaveLength(DASHBOARD_DAYS);
    expect(card.days[0]!.day).toBe("2026-10-12");
    expect(card.days.at(-1)!.day).toBe(TODAY);
    expect(card.days.find((day) => day.day === "2026-10-20")).toEqual({ day: "2026-10-20", captures: { candidate: 0, guest: 0 }, matchScores: 0, applications: 0, activeCandidates: 0, versions: [], errors: 0 });
  });

  it("counts each day's Captures (Candidate / Invité), Match Scores, Applications, active Candidates, versions and errors", () => {
    const card = extensionDashboard(counts, TODAY);

    expect(card.days.at(-1)).toEqual({ day: TODAY, captures: { candidate: 3, guest: 2 }, matchScores: 4, applications: 1, activeCandidates: 2, versions: ["0.3.0", "0.2.0"], errors: 2 });
    expect(card.days.at(-2)).toEqual({ day: "2026-11-09", captures: { candidate: 1, guest: 0 }, matchScores: 0, applications: 0, activeCandidates: 3, versions: ["0.3.0"], errors: 6 });
  });

  it("sums the 30 days, each active Candidate counted once", () => {
    expect(extensionDashboard(counts, TODAY).totals).toEqual({ captures: { candidate: 4, guest: 2 }, matchScores: 4, applications: 1, activeCandidates: 3, errors: 17 });
  });

  it("lists the versions in service, the newest first, with their Extension Events; one stated by none last", () => {
    expect(extensionDashboard(counts, TODAY).versions).toEqual([
      { version: "0.3.0", events: 19 },
      { version: "0.2.0", events: 10 },
      { version: null, events: 1 },
    ]);
    const tenth = extensionDashboard([count(TODAY, "capture", null, "0.9.0", 1), count(TODAY, "capture", null, "0.10.0", 1), count(TODAY, "capture", null, "1.0.0", 1)], TODAY);
    expect(tenth.versions.map((row) => row.version)).toEqual(["1.0.0", "0.10.0", "0.9.0"]);
  });

  it("names the 5 domains with the most « page cannot be captured » errors, by name on a tie; never another error's", () => {
    const { captureImpossibleDomains } = extensionDashboard(counts, TODAY);

    expect(TOP_DOMAINS).toBe(5);
    expect(captureImpossibleDomains).toEqual([
      { domain: "c.test", errors: 3 },
      { domain: "www.indeed.com", errors: 3 },
      { domain: "e.test", errors: 2 },
      { domain: "a.test", errors: 1 },
      { domain: "b.test", errors: 1 },
    ]);
  });

  it("is all 0 with nothing recorded", () => {
    const card = extensionDashboard([], TODAY);

    expect(card.totals).toEqual({ captures: { candidate: 0, guest: 0 }, matchScores: 0, applications: 0, activeCandidates: 0, errors: 0 });
    expect(card.versions).toEqual([]);
    expect(card.captureImpossibleDomains).toEqual([]);
    expect(card.days.every((day) => day.errors === 0)).toBe(true);
  });

  it("crosses a month's end and a year's", () => {
    const card = extensionDashboard([], "2027-01-05");

    expect(card.days[0]!.day).toBe("2026-12-07");
    expect(card.days.map((day) => day.day)).toContain("2026-12-31");
    expect(card.days.map((day) => day.day)).toContain("2027-01-01");
  });
});

describe.skipIf(!connectionString)("Activité › Extension and the Extension card, on Postgres (#925; needs DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  // Tuesday 10 November 2026, 00:30 in Paris: still the 9th in UTC.
  const now = new Date("2026-11-09T23:30:00Z");

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  /** One Extension Event, as #924 writes it. */
  async function event(at: string, kind: string, candidateId: string | null, more: Record<string, unknown> = {}) {
    const row = { extension_version: "0.3.0", object_type: null, object_id: null, error_code: null, place: null, page_domain: null, route: null, http_status: null, browser: null, message_key: null, ...more };
    await database.query(
      `INSERT INTO extension_event (at, kind, candidate_id, extension_version, object_type, object_id, error_code, message_key, route, http_status, place, browser, page_domain)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [new Date(at), kind, candidateId, row.extension_version, row.object_type, row.object_id, row.error_code, row.message_key, row.route, row.http_status, row.place, row.browser, row.page_domain],
    );
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateExtensionEvents(database);
    marie = await candidate("marie.dupont@example.fr");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("the list", () => {
    beforeEach(async () => {
      await event("2026-11-09T08:00:00Z", "capture", marie, { object_type: "job_offer", object_id: "0b6c2f1e-1111-4111-8111-111111111111" });
      await event("2026-11-09T09:00:00Z", "cv_draft", null, { extension_version: "0.2.0" });
      await event("2026-11-09T10:00:00Z", "error", null, {
        error_code: "captureImpossible",
        message_key: "extension.captureImpossible",
        place: "content_script",
        browser: "Chrome 141",
        page_domain: "www.indeed.com",
      });
      await event("2026-11-09T11:00:00Z", "error", marie, { error_code: "callFailed", route: "/api/match-score", http_status: 502, place: "side_panel", browser: "Edge 140", page_domain: "fr.indeed.com" });
    });

    it("shows every Extension Event, the newest first: the Candidate by their email, a Guest by none, its object or its error", async () => {
      const rows = await createExtensionEventsBackOffice(database, { now: () => now }).list();

      expect(rows.map((row) => row.kind)).toEqual(["error", "error", "cv_draft", "capture"]);
      expect(rows[0]).toMatchObject({
        candidate: { id: marie, email: "marie.dupont@example.fr" },
        extensionVersion: "0.3.0",
        object: null,
        error: { code: "callFailed", messageKey: null, route: "/api/match-score", httpStatus: 502, place: "side_panel", browser: "Edge 140", pageDomain: "fr.indeed.com" },
      });
      expect(rows[2]).toMatchObject({ candidate: null, extensionVersion: "0.2.0", object: null, error: null });
      expect(rows[3]).toMatchObject({ candidate: { id: marie }, object: { type: "job_offer", id: "0b6c2f1e-1111-4111-8111-111111111111" }, error: null, at: new Date("2026-11-09T08:00:00Z") });
    });

    it("filters by type, who, one Candidate, version and domain (a domain's subdomains too)", async () => {
      const list = (filter: Record<string, string>) =>
        createExtensionEventsBackOffice(database, { now: () => now })
          .list(filter)
          .then((rows) => rows.map((row) => `${row.kind}:${row.candidate ? "candidate" : "guest"}`));

      expect(await list({ type: "error" })).toEqual(["error:candidate", "error:guest"]);
      expect(await list({ qui: "guest" })).toEqual(["error:guest", "cv_draft:guest"]);
      expect(await list({ qui: "candidate" })).toEqual(["error:candidate", "capture:candidate"]);
      expect(await list({ candidat: marie, type: "capture" })).toEqual(["capture:candidate"]);
      expect(await list({ version: "0.2.0" })).toEqual(["cv_draft:guest"]);
      expect(await list({ domaine: "indeed.com" })).toEqual(["error:candidate", "error:guest"]);
      expect(await list({ domaine: "www.indeed.com" })).toEqual(["error:guest"]);
      expect(await list({ domaine: "deed.com" })).toEqual([]);
    });

    it(`shows the ${LIST_LIMIT} newest at most`, async () => {
      await database.query(
        `INSERT INTO extension_event (at, kind, extension_version) SELECT timestamptz '2026-11-01T00:00:00Z' + n * interval '1 second', 'capture', '0.1.0' FROM generate_series(1, $1) AS n`,
        [LIST_LIMIT + 5],
      );

      const rows = await createExtensionEventsBackOffice(database, { now: () => now }).list();
      expect(rows).toHaveLength(LIST_LIMIT);
      expect(rows[0]!.kind).toBe("error");
    });
  });

  it("counts the card's 30 days in Paris time, every Extension Event older left out", async () => {
    const paul = await candidate("paul.martin@example.fr");
    await event("2026-11-09T23:10:00Z", "capture", marie); // 10 November, 00:10 in Paris
    await event("2026-11-09T22:50:00Z", "capture", null); // 9 November, 23:50 in Paris
    await event("2026-11-09T12:00:00Z", "match_score", paul, { extension_version: "0.2.0" });
    await event("2026-11-09T12:00:00Z", "error", null, { error_code: "captureImpossible", place: "content_script", page_domain: "www.indeed.com" });
    await event("2026-10-11T12:00:00Z", "capture", marie); // the day before the 30

    const card = await createExtensionEventsBackOffice(database, { now: () => now }).dashboard();

    expect(card.days.at(-1)).toMatchObject({ day: "2026-11-10", captures: { candidate: 1, guest: 0 }, activeCandidates: 1 });
    expect(card.days.at(-2)).toMatchObject({ day: "2026-11-09", captures: { candidate: 0, guest: 1 }, matchScores: 1, activeCandidates: 1, errors: 1, versions: ["0.3.0", "0.2.0"] });
    expect(card.totals).toEqual({ captures: { candidate: 1, guest: 1 }, matchScores: 1, applications: 0, activeCandidates: 2, errors: 1 });
    expect(card.captureImpossibleDomains).toEqual([{ domain: "www.indeed.com", errors: 1 }]);
  });
});

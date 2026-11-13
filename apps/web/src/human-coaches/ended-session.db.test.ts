import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import { legacyMayChangeSession } from "./ended-session";
import { createHumanCoaches, migrateHumanCoaches, type HumanCoaches } from "./index";

// « Espace coach v2 » off (#1022), as the app wires it: a Candidate neither moves nor cancels a session that has ended,
// its date stays; one under way still moves; its Human Coach still corrects it. The clock is fixed: 22 October 2026,
// the session at 14:00 French time (12:00 UTC, summer time), 60 minutes.
describe.skipIf(!connectionString)("a session that has ended, « Espace coach v2 » off (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let coaches: HumanCoaches;
  let now: Date;
  const AT = new Date("2026-10-22T12:00:00.000Z");

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateHumanCoaches(database);
    const profiles = createProfiles(database);
    const applications = createApplications(database, { jobOffers: createJobOffers(database), profiles });
    now = new Date("2026-10-20T08:00:00.000Z");
    coaches = createHumanCoaches(database, {
      profiles,
      applications,
      tailoredDocuments: { get: async () => null },
      tailoredCvs: { get: async () => null },
      now: () => now,
      coachSpaceV2On: () => false,
      mayChangeSession: (within, id, by) => (by === "cal_com" ? Promise.resolve(true) : legacyMayChangeSession(within, id, by, now)),
    });
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  async function datedSession() {
    const added = await coaches.add({ name: "Sophie Martin", email: "sophie.martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance" });
    if (!added.ok) throw new Error("fixture refused");
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const marie = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
    await coaches.recordPaidSession({ checkoutSessionId: "cs_1", candidateId: marie, coachId: added.coach.id, amount: 9000, currency: "eur" });
    const session = (await coaches.sessions(marie))[0]!;
    expect(await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-22T14:00", durationMinutes: 60 })).toMatchObject({ ok: true });
    return { marie, coach: added.coach, session };
  }

  it("refuses the Candidate to move or cancel it once ended, too_late, and keeps its date", async () => {
    const { marie, session } = await datedSession();
    now = new Date("2026-10-22T13:00:00.000Z");
    expect(await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-29T14:00" })).toEqual({ ok: false, error: "too_late" });
    expect(await coaches.cancelSession(marie, session.id)).toEqual({ ok: false, error: "too_late" });
    expect((await coaches.sessions(marie))[0]).toMatchObject({ scheduledAt: AT, durationMinutes: 60, reschedules: [] });
  });

  it("lets the Candidate move a session under way, and its Human Coach correct one that has ended", async () => {
    const { marie, coach, session } = await datedSession();
    now = new Date("2026-10-22T12:59:59.000Z");
    expect(await coaches.scheduleSession(marie, session.id, { scheduledAt: "2026-10-22T14:30" })).toMatchObject({ ok: true });
    now = new Date("2026-10-23T08:00:00.000Z");
    expect(await coaches.scheduleCoachedSession(coach.id, session.id, { scheduledAt: "2026-10-22T14:15" })).toMatchObject({ ok: true });
  });
});

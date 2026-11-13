import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createAgenda } from "../agenda";
import { migrateDatabase } from "../migrations";
import { coachingTimeZones, migrateCoachingTimeZones } from "./index";

describe.skipIf(!connectionString)("Coaching Session time zone preferences", () => {
  let auth: TestAuth;
  let candidateId: string;
  let coachId: string;
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    const cookie = await signInWithMagicLink(auth, "candidate-time@example.test");
    candidateId = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id;
    const { rows } = await auth.database.query("INSERT INTO human_coach (name,email,booking_url) VALUES ('Coach','coach-time@example.test','https://cal.com/coach/session') RETURNING id");
    coachId = rows[0].id;
  }, 60_000);
  afterEach(async () => { await auth.stop(); }, 60_000);
  it("offers the Candidate a device preference, defaults coaches to Paris, and saves valid zones independently", async () => {
    const zones = coachingTimeZones(auth.database);
    expect(await zones.candidate(candidateId)).toBeNull();
    expect(await zones.coach(coachId)).toBe("Europe/Paris");
    expect(await zones.saveCandidate(candidateId, "America/Montreal")).toBe(true);
    expect(await zones.saveCoach(coachId, "Europe/Paris")).toBe(true);
    expect(await zones.candidate(candidateId)).toBe("America/Montreal");
    expect(await zones.saveCandidate(candidateId, "javascript:bad")).toBe(false);
    expect(await zones.candidate(candidateId)).toBe("America/Montreal");
    await migrateCoachingTimeZones(auth.database);
    expect(await zones.candidate(candidateId)).toBe("America/Montreal");
  });
  it("deletes preferences with the Candidate and refuses a retired coach's writes", async () => {
    const zones = coachingTimeZones(auth.database);
    await zones.saveCandidate(candidateId, "America/Montreal");
    await zones.saveCoach(coachId, "America/Montreal");
    await auth.database.query("UPDATE human_coach SET retired_at=now() WHERE id=$1", [coachId]);
    expect(await zones.saveCoach(coachId, "Europe/Paris")).toBe(false);
    expect(await zones.coach(coachId)).toBe("Europe/Paris");
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [candidateId]);
    expect(await zones.candidate(candidateId)).toBeNull();
  });
  it("groups sessions by the Candidate's midnight for list and calendar windows", async () => {
    const scheduled = "2026-11-10T00:30:00Z"; // Paris Nov 10, Montréal Nov 9.
    await auth.database.query("INSERT INTO coaching_session (stripe_checkout_session_id,candidate_id,coach_id,amount,currency,scheduled_at) VALUES ('cs-zone', $1, $2, 9000, 'eur', $3)", [candidateId, coachId, scheduled]);
    const agenda = createAgenda(auth.database);
    const now = new Date("2026-11-10T01:00:00Z");
    const local = await agenda.days(candidateId, { period: "upcoming", now, timeZone: "America/Montreal" });
    expect(local.map((day) => day.day)).toEqual(["2026-11-09"]);
    expect((await agenda.daysBetween(candidateId, { first: "2026-11-09", last: "2026-11-09", timeZone: "America/Montreal" })).map((day) => day.day)).toEqual(["2026-11-09"]);
    expect(await agenda.daysBetween(candidateId, { first: "2026-11-09", last: "2026-11-09" })).toEqual([]);
  });

});

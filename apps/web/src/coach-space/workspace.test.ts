import { coachContacts } from "./contacts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coachingDay } from "@jobhub/shared/coaching-time";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { createHumanCoaches } from "../human-coaches";
import { createProfiles } from "../profiles";
import { createApplications } from "../applications";
import { createJobOffers } from "../job-offers";
import { coachWorkspace, sessionPhase } from "./workspace";
import { meetingTool, meetingWindow, parseMeeting } from "./meeting";

describe("session phases and joining window", () => {
  const session = { scheduledAt: new Date("2026-11-10T10:00:00Z"), durationMinutes: 60 };
  it("moves through before/during/after, including the ten-minute boundary", () => {
    expect(sessionPhase(session, new Date("2026-11-10T09:49:59Z"))).toBe("before");
    expect(sessionPhase(session, new Date("2026-11-10T09:50:00Z"))).toBe("during");
    expect(sessionPhase(session, new Date("2026-11-10T11:00:01Z"))).toBe("after");
    expect(meetingWindow(session, new Date("2026-11-10T11:30:00Z"))).toBe("open");
    expect(meetingWindow(session, new Date("2026-11-10T11:30:01Z"))).toBe("ended");
  });
  it("recognises exact hosts, rejects impersonation/insecure links and requires confirmation elsewhere", () => {
    expect(meetingTool("https://us02web.zoom.us/j/1")).toBe("zoom");
    expect(meetingTool("https://meet.google.com/a")).toBe("meet");
    expect(meetingTool("https://teams.microsoft.com/l/a")).toBe("teams");
    expect(meetingTool("https://zoom.us.attacker.test/j/1")).toBe("video");
    expect(parseMeeting({ kind: "video", target: "https://elsewhere.test/call" })).toBeNull();
    expect(parseMeeting({ kind: "video", target: "https://elsewhere.test/call", confirmed: true })).not.toBeNull();
    expect(parseMeeting({ kind: "video", target: "http://zoom.us/j/1" })).toBeNull();
    expect(parseMeeting({ kind: "phone", target: "+33 6 12 34 56 78", direction: "candidate_calls" })).not.toBeNull();
  });
});

describe.skipIf(!connectionString)("the coach's private workspace", () => {
  let auth: TestAuth;
  let coachId: string;
  let otherCoachId: string;
  let candidateId: string;
  let sessionId: string;
  let space: ReturnType<typeof coachWorkspace>;
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    const cookie = await signInWithMagicLink(auth, "private-notes@example.test");
    candidateId = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id;
    await auth.database.query("UPDATE candidate SET given_name='Marie', family_name='Dupont', preferred_name='Mimi' WHERE id=$1", [candidateId]);
    const coaches = await auth.database.query(
      "INSERT INTO human_coach (name,email,booking_url) VALUES ('Sophie Martin','sophie@example.test','https://cal.com/sophie'),('Paul Petit','paul@example.test','https://cal.com/paul') RETURNING id",
    );
    coachId = coaches.rows[0].id;
    otherCoachId = coaches.rows[1].id;
    const sessions = await auth.database.query(
      "INSERT INTO coaching_session (candidate_id,coach_id,stripe_checkout_session_id,amount,currency,scheduled_at) VALUES ($1,$2,'cs-notes',9000,'eur','2026-11-10T00:30:00Z') RETURNING id",
      [candidateId, coachId],
    );
    sessionId = sessions.rows[0].id;
    const profiles = createProfiles(auth.database);
    const humans = createHumanCoaches(auth.database, {
      profiles,
      applications: createApplications(auth.database, { profiles, jobOffers: createJobOffers(auth.database) }),
      tailoredDocuments: { get: async () => null },
      tailoredCvs: { get: async () => null },
    });
    space = coachWorkspace(auth.database, humans);
  }, 60_000);
  afterEach(async () => {
    await auth.stop();
  }, 60_000);
  it("gives session-only relationships short names and notes, never Profiles or Applications", async () => {
    const file = await space.candidate(coachId, candidateId);
    expect(file?.person).toMatchObject({ name: "Marie D.", calledBy: "Mimi", access: false });
    expect(file?.file).toBeNull();
    expect(await space.candidate(otherCoachId, candidateId)).toBeNull();
    expect(await space.note(otherCoachId, candidateId)).toBeNull();
    expect((await space.saveNote(coachId, candidateId, null, "Private", 0)).ok).toBe(true);
    expect((await space.note(coachId, candidateId))?.text).toBe("Private");
  });
  it("isolates coaches' notes even with Coach Access, uses revisions, and isolates session ownership", async () => {
    await auth.database.query("INSERT INTO coach_access (coach_id,candidate_id) VALUES ($1,$3),($2,$3)", [coachId, otherCoachId, candidateId]);
    expect((await space.candidate(coachId, candidateId))?.person.name).toBe("Marie Dupont");
    expect((await space.saveNote(coachId, candidateId, sessionId, "Session private", 0)).ok).toBe(true);
    expect(await space.saveNote(otherCoachId, candidateId, sessionId, "Attack", 0)).toMatchObject({ ok: false, error: "not_found" });
    expect((await space.saveNote(coachId, candidateId, null, "First", 0)).ok).toBe(true);
    expect(await space.saveNote(coachId, candidateId, null, "Stale", 0)).toMatchObject({ ok: false, error: "conflict" });
    expect((await space.saveNote(coachId, candidateId, null, "Second", 1)).ok).toBe(true);
    expect((await space.note(otherCoachId, candidateId))?.text).toBe("");
  });
  it("groups Today/Tomorrow in the coach's zone and hides withdrawn sessions", async () => {
    const today = await space.today(coachId, new Date("2026-11-10T01:00Z"), "America/Montreal");
    expect(today.today.map((s) => coachingDay(s.scheduledAt!, "America/Montreal"))).toEqual(["2026-11-09"]);
    await auth.database.query("UPDATE coaching_session SET withdrawn_at=now() WHERE id=$1", [sessionId]);
    expect(await space.sessions(coachId)).toEqual([]);
    expect(await space.candidate(coachId, candidateId)).toBeNull();
  });
  it("revokes reads and writes on retirement and cascades notes on Candidate deletion", async () => {
    await space.saveNote(coachId, candidateId, null, "Secret", 0);
    await auth.database.query("UPDATE human_coach SET retired_at=now() WHERE id=$1", [coachId]);
    expect(await space.note(coachId, candidateId)).toBeNull();
    expect(await space.saveNote(coachId, candidateId, null, "Forbidden", 1)).toMatchObject({ ok: false, error: "not_found" });
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [candidateId]);
    expect((await auth.database.query("SELECT * FROM private_coach_note")).rows).toEqual([]);
  });
  it("preserves a pre-date video contact and a newer contact when a stale form saves only the date",async()=>{
    const profiles=createProfiles(auth.database);
    const humans=createHumanCoaches(auth.database,{profiles,applications:createApplications(auth.database,{profiles,jobOffers:createJobOffers(auth.database)}),tailoredDocuments:{get:async()=>null},tailoredCvs:{get:async()=>null}});
    const contacts=coachContacts(auth.database);const first="https://meet.google.com/aaa-bbbb-ccc",second="https://meet.google.com/ddd-eeee-fff";
    await auth.database.query("UPDATE coaching_session SET scheduled_at=NULL,duration_minutes=90,note='Private reminder' WHERE id=$1",[sessionId]);
    await contacts.save(coachId,sessionId,{kind:"video",target:first});
    expect((await humans.scheduleSession(candidateId,sessionId,{scheduledAt:"2026-11-11T12:00"})).ok).toBe(true);
    expect(await contacts.ofSession(coachId,sessionId)).toMatchObject({target:first});
    await contacts.save(coachId,sessionId,{kind:"video",target:second});
    expect((await humans.scheduleSession(candidateId,sessionId,{scheduledAt:"2026-11-12T12:00"})).ok).toBe(true);
    expect(await contacts.ofSession(coachId,sessionId)).toMatchObject({target:second});
    expect((await humans.sessions(candidateId))[0]).toMatchObject({durationMinutes:90,videoLink:second,note:"Private reminder"});
  });
  it("retires a stale v2 contact atomically when a legacy client changes the session video link",async()=>{
    const contacts=coachContacts(auth.database);
    const first="https://meet.google.com/aaa-bbbb-ccc",second="https://meet.google.com/ddd-eeee-fff";
    await contacts.save(coachId,sessionId,{kind:"video",target:first});
    await auth.database.query("UPDATE coaching_session SET video_link=$2 WHERE id=$1",[sessionId,second]);
    expect(await contacts.ofSession(coachId,sessionId)).toMatchObject({target:second});
    expect((await contacts.forCandidate(candidateId))[sessionId]).toMatchObject({target:second});
    await contacts.save(coachId,sessionId,{kind:"video",target:first});
    expect((await auth.database.query("SELECT video_link FROM coaching_session WHERE id=$1",[sessionId])).rows[0].video_link).toBe(first);
    // A date-only edit sends the old link unchanged and must preserve the newer explicit contact.
    await auth.database.query("UPDATE coaching_session SET scheduled_at=scheduled_at+interval '1 day',video_link=$2 WHERE id=$1",[sessionId,first]);
    expect(await contacts.ofSession(coachId,sessionId)).toMatchObject({target:first});
  });
  it("uses per-session contacts before permanent contacts, and rejects another coach and retirement", async () => {
    const contacts = coachContacts(auth.database);
    expect(await contacts.save(coachId, null, { kind: "phone", target: "+33 6 12 34 56 78", direction: "candidate_calls" })).toBe(true);
    expect((await contacts.forCandidate(candidateId))[sessionId]?.kind).toBe("phone");
    expect(await contacts.save(otherCoachId, sessionId, { kind: "video", target: "https://meet.google.com/test" })).toBe(false);
    expect(await contacts.save(coachId, sessionId, { kind: "video", target: "https://meet.google.com/test" })).toBe(true);
    expect((await contacts.ofSession(coachId, sessionId))?.kind).toBe("video");
    await auth.database.query("UPDATE human_coach SET retired_at=now() WHERE id=$1", [coachId]);
    expect(await contacts.save(coachId, null, { kind: "video", target: "https://meet.google.com/test" })).toBe(false);
    expect(await contacts.ofSession(coachId, sessionId)).toBeNull();
  });
});

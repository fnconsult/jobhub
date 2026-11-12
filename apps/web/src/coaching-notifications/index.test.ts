import { coachingNotificationsOf } from "./index";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachingTimeZones } from "../coaching-time";
import { coachingNotifications, migrateCoachingNotifications, type NoticeRecipient, type CoachingNotice } from "./index";
// Agreed #885 seams: the Worker/public delivery boundary and account settings. Only clocks and outbound transports are injected.
describe.skipIf(!connectionString)("Coaching reminders at the delivery boundary", () => {
  let auth: TestAuth,
    candidate: string,
    coachAccount: string,
    coach: string,
    session: string,
    clock: Date,
    emails: { person: NoticeRecipient; notice: CoachingNotice }[],
    pushes: { person: NoticeRecipient; notice: CoachingNotice }[],
    service: ReturnType<typeof coachingNotifications>;
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    await migrateCoachingNotifications(auth.database);
    async function person(email: string) {
      const cookie = await signInWithMagicLink(auth, email);
      return (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
    }
    candidate = await person("reminder-buyer@example.test");
    coachAccount = await person("reminder-coach@example.test");
    coach = (await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Coach','reminder-coach@example.test','') RETURNING id")).rows[0]
      .id;
    session = (
      await auth.database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency,paid_at,scheduled_at,note) VALUES($1,$2,'cs_reminder',9000,'eur','2026-01-01T12:00Z','2026-11-20T12:00Z','PRIVATE_NOTE_NOT_FOR_NOTIFICATION') RETURNING id",
        [candidate, coach],
      )
    ).rows[0].id;
    const zones = coachingTimeZones(auth.database);
    await zones.saveCandidate(candidate, "Pacific/Auckland");
    await zones.saveCoach(coach, "America/Montreal");
    clock = new Date("2026-11-20T10:59:59Z");
    emails = [];
    pushes = [];
    service = coachingNotifications(auth.database, {
      now: () => clock,
      permitted: async () => true,
      eligibleCoach: async () => true,
      email: async (person, notice) => {
        emails.push({ person, notice });
      },
      push: async (person, notice) => {
        pushes.push({ person, notice });
      },
    });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  it("still queues push when the email provider fails", async () => {
    clock = new Date("2026-11-20T11:00Z");
    const independent = coachingNotifications(auth.database, {
      now: () => clock,
      permitted: async () => true,
      eligibleCoach: async () => true,
      email: async () => {
        throw Error("email provider unavailable");
      },
      push: async (person, notice) => {
        pushes.push({ person, notice });
      },
    });
    await independent.sendDue();
    expect(pushes).toHaveLength(2);
  });
  it("purges expired unprocessed notification facts without losing the future paid-session reminder", async () => {
    expect((await coachingNotificationsOf(auth.database, candidate)).events).toHaveLength(1);
    await service.purge();
    expect((await coachingNotificationsOf(auth.database, candidate)).events).toHaveLength(0);
    clock = new Date("2026-11-20T11:00Z");
    await service.sendDue();
    expect(emails).toHaveLength(2);
  });
  it("resumes a failed push channel without repeating either successful email", async () => {
    clock = new Date("2026-11-20T11:00Z");
    let attempts = 0;
    const retrying = coachingNotifications(auth.database, {
      now: () => clock,
      permitted: async () => true,
      eligibleCoach: async () => true,
      email: async (person, notice) => {
        emails.push({ person, notice });
      },
      push: async (person, notice) => {
        attempts++;
        if (person.id === candidate && attempts === 1) throw Error("queue unavailable");
        pushes.push({ person, notice });
      },
    });
    await retrying.sendDue();
    expect(emails).toHaveLength(2);
    clock = new Date(clock.getTime() + 300001);
    await retrying.sendDue();
    expect(emails).toHaveLength(2);
    expect(pushes).toHaveLength(2);
  });
  it.each([
    ["Europe/Paris", "2026-03-29T05:29:59Z", "2026-03-29T05:30:00Z", "2026-03-29T12:00Z"],
    ["America/Montreal", "2026-03-08T11:29:59Z", "2026-03-08T11:30:00Z", "2026-03-08T16:00Z"],
    ["America/Montreal", "2026-11-01T12:29:59Z", "2026-11-01T12:30:00Z", "2026-11-01T17:00Z"],
  ])("keeps 07:30 local across DST in %s (%s)", async (zone, before, boundary, slot) => {
    await coachingTimeZones(auth.database).saveCoach(coach, zone);
    await auth.database.query("UPDATE coaching_session SET scheduled_at=$2,date_set_at='2026-01-02T12:00Z' WHERE id=$1", [session, new Date(slot!)]);
    clock = new Date(before!);
    await service.sendDue();
    expect(emails).toHaveLength(0);
    clock = new Date(boundary!);
    await service.sendDue();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ person: { id: coachAccount, timeZone: zone }, notice: { kind: "daily" } });
  });
  it("uses an actual hour across Montreal’s repeated 01:30 wall clock", async () => {
    await auth.database.query("UPDATE coaching_session SET scheduled_at='2026-11-01T06:30Z',date_set_at='2026-10-01T12:00Z' WHERE id=$1", [session]);
    clock = new Date("2026-11-01T05:29:59Z");
    await service.sendDue();
    expect(emails).toHaveLength(0);
    clock = new Date("2026-11-01T05:30:00Z");
    await service.sendDue();
    expect(emails).toHaveLength(2);
    expect(emails.every((e) => e.notice.kind === "hour_before")).toBe(true);
  });
  it.each(["cancelled", "withdrawn", "retired"])("does not remind an unavailable service (%s)", async (kind) => {
    clock = new Date("2026-11-20T11:00Z");
    if (kind === "retired") await auth.database.query("UPDATE human_coach SET retired_at=$2 WHERE id=$1", [coach, clock]);
    else await auth.database.query(`UPDATE coaching_session SET ${kind === "cancelled" ? "cancelled_at" : "withdrawn_at"}=$2 WHERE id=$1`, [session, clock]);
    await service.sendDue();
    expect(emails.filter((e) => ["hour_before", "day_before", "daily"].includes(e.notice.kind))).toHaveLength(0);
    expect(pushes.filter((e) => e.notice.kind === "hour_before")).toHaveLength(0);
  });
  it("rechecks a queued reminder before physical push delivery, including ownership and cancellation", async () => {
    clock = new Date("2026-11-20T11:00:00Z");
    await service.sendDue();
    const key = pushes.find((p) => p.person.id === candidate)!.notice.key;
    const notification = { event: "coaching_session_hour", noticeKey: key, sessionId: session };
    expect(await service.pushStillCurrent(candidate, notification)).toBe(true);
    expect(await service.pushStillCurrent(coachAccount, notification)).toBe(false);
    await auth.database.query("UPDATE coaching_session SET scheduled_at=NULL,cancelled_at=$2 WHERE id=$1", [session, clock]);
    expect(await service.pushStillCurrent(candidate, notification)).toBe(false);
  });
  it("notifies the Coach once for committed paid, booked, rescheduled and cancelled facts", async () => {
    clock = new Date(Date.now() + 1000);
    const paid = (
      await auth.database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency,paid_at) VALUES($1,$2,'cs_new_notice',9000,'eur',$3) RETURNING id",
        [candidate, coach, clock],
      )
    ).rows[0].id;
    await service.sendDue();
    await service.sendDue();
    expect(emails.map((e) => e.notice.kind)).toEqual(["paid"]);
    clock = new Date(clock.getTime() + 1000);
    const slot = new Date(clock.getTime() + 7 * 86400000);
    await auth.database.query("UPDATE coaching_session SET scheduled_at=$2,date_set_at=$3 WHERE id=$1", [paid, slot, clock]);
    await service.sendDue();
    clock = new Date(clock.getTime() + 1000);
    await auth.database.query("UPDATE coaching_session SET scheduled_at=$2,date_set_at=$3 WHERE id=$1", [paid, new Date(slot.getTime() + 3600000), clock]);
    await service.sendDue();
    await auth.database.query("UPDATE coaching_session SET scheduled_at=NULL,date_set_at=NULL WHERE id=$1", [paid]);
    await service.sendDue();
    await service.sendDue();
    expect(emails.map((e) => e.notice.kind)).toEqual(["paid", "booked", "rescheduled", "cancelled"]);
    expect(emails.every((e) => e.person.id === coachAccount)).toBe(true);
    expect(pushes).toHaveLength(4);
  });
  it("sends the Coach’s day-before reminder from 18:00 local, with a separate event key", async () => {
    clock = new Date("2026-11-19T22:59:59Z");
    await service.sendDue();
    expect(emails).toHaveLength(0);
    clock = new Date("2026-11-19T23:00:00Z");
    await service.sendDue();
    await service.sendDue();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ person: { id: coachAccount }, notice: { kind: "day_before", sessionId: session } });
    expect(pushes).toHaveLength(1);
  });
  it("sends the optional morning summary at 07:30 in the Coach’s Montreal time zone", async () => {
    await auth.database.query("UPDATE coaching_session SET scheduled_at='2026-11-20T15:00Z' WHERE id=$1", [session]);
    clock = new Date("2026-11-20T12:29:59Z");
    await service.sendDue();
    expect(emails).toHaveLength(0);
    clock = new Date("2026-11-20T12:30:00Z");
    await service.sendDue();
    await service.sendDue();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ person: { id: coachAccount, timeZone: "America/Montreal" }, notice: { kind: "daily" } });
    expect(pushes).toHaveLength(1);
    await service.updateSettings(coachAccount, { daily: false });
    await auth.database.query("UPDATE coaching_session SET scheduled_at='2026-11-21T15:00Z' WHERE id=$1", [session]);
    clock = new Date("2026-11-21T12:30:00Z");
    await service.sendDue();
    expect(emails).toHaveLength(1);
  });
  it("turns off the Candidate hour email independently of push and the Coach’s email", async () => {
    expect(await service.updateSettings(candidate, { hourEmail: false })).toBe(true);
    expect(await service.settings(candidate)).toMatchObject({ hourEmail: false });
    clock = new Date("2026-11-20T11:00:00Z");
    await service.sendDue();
    expect(emails.map((e) => e.person.id)).toEqual([coachAccount]);
    expect(pushes).toHaveLength(2);
  });
  it("notifies both people at H-1 in their own zones, once across Worker restarts", async () => {
    await service.sendDue();
    expect(emails).toHaveLength(0);
    clock = new Date("2026-11-20T11:00:00Z");
    await service.sendDue();
    const restarted = coachingNotifications(auth.database, {
      now: () => clock,
      permitted: async () => true,
      eligibleCoach: async () => true,
      email: async (person, notice) => {
        emails.push({ person, notice });
      },
      push: async (person, notice) => {
        pushes.push({ person, notice });
      },
    });
    await restarted.sendDue();
    expect(emails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          person: expect.objectContaining({ id: candidate, timeZone: "Pacific/Auckland" }),
          notice: expect.objectContaining({ kind: "hour_before", sessionId: session }),
        }),
        expect.objectContaining({
          person: expect.objectContaining({ id: coachAccount, timeZone: "America/Montreal" }),
          notice: expect.objectContaining({ kind: "hour_before", sessionId: session }),
        }),
      ]),
    );
    expect(emails).toHaveLength(2);
    expect(pushes).toHaveLength(2);
    expect(JSON.stringify(emails)).not.toContain("PRIVATE_NOTE_NOT_FOR_NOTIFICATION");
  });
});

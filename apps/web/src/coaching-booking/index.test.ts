import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { migrateCoachingBooking, coachingBooking, bookingDataOf } from "./index";
import { readBookingToken, signBookingToken } from "./token";
import type { CalPort, CalEventType } from "./port";
const SECRET = "booking-test-secret",
  WEBHOOK = "cal-webhook-test-secret";
describe.skipIf(!connectionString)("paid Cal.com bookings", () => {
  let auth: TestAuth,
    buyer: string,
    coach: string,
    session: string,
    clock: Date,
    cal: CalPort,
    booking: ReturnType<typeof coachingBooking>,
    cancelled: string[],
    fail: boolean,
    event: CalEventType;
  async function person(email: string) {
    const cookie = await signInWithMagicLink(auth, email);
    return (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    await migrateCoachingBooking(auth.database);
    buyer = await person("booking-buyer@example.test");
    coach = (await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Cal Coach','cal-coach@example.test','') RETURNING id")).rows[0]
      .id;
    session = (
      await auth.database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency,duration_minutes) VALUES($1,$2,'cs_paid',10000,'eur',90) RETURNING id",
        [buyer, coach],
      )
    ).rows[0].id;
    clock = new Date("2026-11-10T12:00Z");
    event = { id: 42, teamId: 7, hostId: 8, durationMinutes: 90, bookingUrl: "https://cal.com/team/jobbbox/coach" };
    cancelled = [];
    fail = false;
    cal = {
      eventType: async () => event,
      createEventType: async () => event,
      cancel: async (uid) => {
        if (fail) throw new Error("Cal unavailable");
        cancelled.push(uid);
      },
    };
    booking = coachingBooking(auth.database, {
      secret: SECRET,
      webhookSecret: WEBHOOK,
      cal,
      now: () => clock,
      permitted: async () => true,
      mayBookCoach: async () => true,
    });
    expect(await booking.configure(coach, 7, 42, 8)).toBe(true);
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  function body(token: string | null, kind = "BOOKING_CREATED", uid = "cal_one", extra: Record<string, unknown> = {}, at = clock.toISOString()) {
    return JSON.stringify({
      triggerEvent: kind,
      createdAt: at,
      payload: { uid, eventTypeId: 42, startTime: "2026-11-20T10:00:00Z", endTime: "2026-11-20T11:30:00Z", metadata: { jobbbox_session: token }, ...extra },
    });
  }
  async function send(raw: string) {
    return booking.webhook(raw, createHmac("sha256", WEBHOOK).update(raw).digest("hex"));
  }
  async function date() {
    return (await auth.database.query("SELECT scheduled_at FROM coaching_session WHERE id=$1", [session])).rows[0].scheduled_at;
  }
  it("claims exactly one paid session under concurrent signed deliveries and refuses token reuse for a second UID", async () => {
    const claim = await booking.forCandidate(buyer, session);
    expect(claim?.token).toBeTruthy();
    const delivery = body(claim!.token);
    expect((await Promise.all([send(delivery), send(delivery)])).filter((r) => r.applied)).toHaveLength(1);
    expect(await date()).toEqual(new Date("2026-11-20T10:00Z"));
    expect((await send(body(claim!.token, "BOOKING_CREATED", "cal_replay", {}, "2026-11-10T12:01:00Z"))).applied).toBe(false);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_cal_notice")).rows[0].n).toBe(1);
  });
  it("refuses expired, altered, other-session and wrong-event claims and logs only rejection facts", async () => {
    const claim = (await booking.forCandidate(buyer, session))!,
      original = readBookingToken(claim.token, SECRET)!;
    const invalid = [
      claim.token + "x",
      signBookingToken({ ...original, sessionId: coach }, SECRET),
      signBookingToken({ ...original, expires: clock.getTime() - 1 }, SECRET),
    ];
    for (const token of invalid) expect((await send(body(token))).applied).toBe(false);
    expect((await send(body(claim.token, "BOOKING_CREATED", "cal_wrong_event", { eventTypeId: 99 }))).applied).toBe(false);
    clock = new Date(clock.getTime() + 25 * 3600000);
    expect((await send(body(claim.token))).applied).toBe(false);
    expect(await date()).toBeNull();
    const log = JSON.stringify((await auth.database.query("SELECT * FROM coaching_cal_delivery")).rows);
    expect(log).not.toContain("jobbbox_session");
    expect(log).not.toContain(claim.token!);
    expect(await booking.webhook(body(claim.token), "bad")).toEqual({ verified: false, applied: false });
  });
  it("follows UID chains after token expiry, retains source/history and ignores older creation/cancellation", async () => {
    const claim = (await booking.forCandidate(buyer, session))!;
    await send(body(claim.token));
    clock = new Date("2026-11-13T12:00Z");
    const moved = body(null, "BOOKING_RESCHEDULED", "cal_two", {
      rescheduleUid: "cal_one",
      startTime: "2026-11-22T10:00:00Z",
      endTime: "2026-11-22T11:30:00Z",
    });
    expect((await Promise.all([send(moved), send(moved)])).filter((r) => r.applied)).toHaveLength(1);
    expect(await date()).toEqual(new Date("2026-11-22T10:00Z"));
    expect((await send(body(null, "BOOKING_CANCELLED", "cal_one", {}, "2026-11-11T12:00:00Z"))).applied).toBe(false);
    expect((await auth.database.query("SELECT changed_by FROM coaching_session_reschedule WHERE coaching_session_id=$1", [session])).rows).toEqual([
      { changed_by: "cal_com" },
    ]);
    clock = new Date("2026-11-14T12:00Z");
    expect((await send(body(null, "BOOKING_CANCELLED", "cal_two"))).applied).toBe(true);
    expect(await date()).toBeNull();
  });
  it("queues Withdrawal/deletion cancellation durably, retries without blocking other recipients, and blocks manual date drift", async () => {
    const claim = (await booking.forCandidate(buyer, session))!;
    await send(body(claim.token));
    await expect(auth.database.query("UPDATE coaching_session SET scheduled_at='2026-11-25' WHERE id=$1", [session])).rejects.toThrow("Use Cal.com");
    await auth.database.query("UPDATE coaching_session SET scheduled_at=NULL WHERE id=$1", [session]);
    await auth.database.query("UPDATE coaching_session SET withdrawn_at=clock_timestamp() WHERE id=$1", [session]);
    fail = true;
    await booking.deliverCancellations();
    expect(cancelled).toEqual([]);
    expect((await auth.database.query("SELECT done_at FROM coaching_cal_cancellation")).rows[0].done_at).toBeNull();
    clock = new Date(clock.getTime() + 6 * 60000);
    fail = false;
    await booking.deliverCancellations();
    expect(cancelled).toEqual(["cal_one"]);
    expect((await send(body(claim.token, "BOOKING_CREATED", "cal_old", {}, clock.toISOString()))).applied).toBe(false);
  });
  it("exports only owned routing facts and cancels a signed booking delivered after purchaser erasure", async () => {
    const claim = (await booking.forCandidate(buyer, session))!;
    expect(JSON.stringify(await bookingDataOf(auth.database, buyer))).not.toContain(claim.token!);
    expect((await bookingDataOf(auth.database, buyer)).bookings).toHaveLength(1);
    const other = await person("private-booking@example.test");
    expect((await bookingDataOf(auth.database, other)).bookings).toEqual([]);
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [buyer]);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_cal_booking")).rows[0].n).toBe(0);
    expect((await send(body(claim.token, "BOOKING_CREATED", "late_erased"))).applied).toBe(false);
    await booking.deliverCancellations();
    expect(cancelled).toEqual(["late_erased"]);
    expect((await auth.database.query("SELECT * FROM coaching_cal_erased_claim")).rows[0]).not.toHaveProperty("session_id");
  });
  it("isolates failed notices and cancellation rows so the oldest failure does not starve later recipients", async () => {
    const claim = (await booking.forCandidate(buyer, session))!;
    await send(body(claim.token));
    await auth.database.query("INSERT INTO coaching_cal_notice(event_key,session_id) VALUES('a',$1),('b',$1)", [session]);
    const sent: string[] = [];
    const notices = coachingBooking(auth.database, {
      secret: SECRET,
      webhookSecret: WEBHOOK,
      now: () => clock,
      changed: async (_id, key) => {
        if (key === "a") throw new Error("bad recipient");
        sent.push(key);
      },
    });
    await notices.deliverNotices();
    expect(sent).toContain("b");
    expect((await auth.database.query("SELECT sent_at FROM coaching_cal_notice WHERE event_key='a'")).rows[0].sent_at).toBeNull();
    await auth.database.query("INSERT INTO coaching_cal_cancellation(uid,queued_at) VALUES('bad','2026-01-01'),('good','2026-01-02')");
    const processed: string[] = [];
    const cancellations = coachingBooking(auth.database, {
      secret: SECRET,
      webhookSecret: WEBHOOK,
      now: () => clock,
      cal: {
        ...cal,
        cancel: async (uid) => {
          if (uid === "bad") throw new Error("retry");
          processed.push(uid);
        },
      },
    });
    await cancellations.deliverCancellations();
    expect(processed).toEqual(["good"]);
  });
  it("never repeats an uncertain remote event creation", async () => {
    let calls = 0;
    const uncertain = coachingBooking(auth.database, {
      secret: SECRET,
      webhookSecret: WEBHOOK,
      permitted: async () => true,
      cal: {
        ...cal,
        createEventType: async () => {
          calls++;
          throw new Error("lost remote outcome");
        },
      },
    });
    const input = { teamId: 7, hostId: 8, durationMinutes: 90, title: "Coach" };
    await expect(uncertain.create(coach, input)).rejects.toThrow();
    expect(await uncertain.create(coach, input)).toBeNull();
    expect(calls).toBe(1);
  });
  it("does not mint for another purchaser, withdrawn/retired sessions or a closed legal gate", async () => {
    const other = await person("other-booking@example.test");
    expect(await booking.forCandidate(other, session)).toBeNull();
    expect(await coachingBooking(auth.database, { secret: SECRET, webhookSecret: WEBHOOK, cal }).forCandidate(buyer, session)).toBeNull();
    await auth.database.query("UPDATE human_coach SET retired_at=clock_timestamp() WHERE id=$1", [coach]);
    expect(await booking.forCandidate(buyer, session)).toBeNull();
  });
});

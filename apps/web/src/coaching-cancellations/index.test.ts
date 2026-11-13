import { cancellationNotice } from "./notice";
import { cancellationSupportRows, retryCancellationRefund } from "./support";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachingRefunds } from "../coaching-refunds";
import {
  coachingCancellations,
  migrateCoachingCancellations,
  candidateMayCancel,
  COACH_CHOICE_MS,
  recordProviderCancellation,
  preserveCancellationRefunds,
} from "./index";
describe("Candidate contractual notice", () => {
  it.each(["2026-03-29T01:30:00Z", "2026-11-01T06:30:00Z"])("uses actual instants across DST: %s", (date) => {
    const scheduled = new Date(date),
      cutoff = new Date(scheduled.getTime() - 86400000);
    expect(candidateMayCancel(scheduled, cutoff)).toBe(true);
    expect(candidateMayCancel(scheduled, new Date(cutoff.getTime() + 60000))).toBe(false);
    expect(candidateMayCancel(scheduled, new Date(cutoff.getTime() - 60000))).toBe(true);
  });
});
describe.skipIf(!connectionString)("contractual cancellation remedies", () => {
  let auth: TestAuth,
    candidate: string,
    coach: string,
    session: string,
    clock: Date,
    enabled: boolean,
    refunds: ReturnType<typeof coachingRefunds>,
    service: ReturnType<typeof coachingCancellations>,
    reopened: string[];
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    await migrateCoachingCancellations(auth.database);
    const cookie = await signInWithMagicLink(auth, "cancel-owner@example.test");
    candidate = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id;
    coach = (await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Coach','cancel-coach@example.test','') RETURNING id")).rows[0]
      .id;
    session = (
      await auth.database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency,scheduled_at) VALUES($1,$2,'cs_cancellation',9000,'eur','2026-11-13T12:00Z') RETURNING id",
        [candidate, coach],
      )
    ).rows[0].id;
    await auth.database.query("INSERT INTO coaching_session_sale(session_id,snapshot,source) VALUES($1,$2,'legacy')", [
      session,
      { seller: { kind: "jobbbox" } },
    ]);
    clock = new Date("2026-11-11T12:00Z");
    enabled = true;
    reopened = [];
    refunds = coachingRefunds(auth.database, { now: () => clock });
    service = coachingCancellations(auth.database, {
      refunds,
      now: () => clock,
      permitted: async () => enabled,
      reopen: async (id) => {
        reopened.push(id);
      },
    });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  it("does not turn a late anonymous provider cancellation into a Candidate refund; Coach confirmation starts remedies", async () => {
    clock = new Date("2026-11-13T11:30Z");
    await recordProviderCancellation(auth.database, session, "signed-provider-cancel", clock, "provider reason");
    await auth.database.query("UPDATE coaching_session SET scheduled_at=NULL WHERE id=$1", [session]);
    const c = (await service.forCandidate(candidate))[0]!;
    expect(await service.choose(candidate, c.id, "refund")).toMatchObject({ ok: false, error: "confirmation_required" });
    expect(await service.candidateCancel(candidate, session, randomUUID())).toMatchObject({ ok: false, error: "too_late" });
    await service.coachCancel(coach, session, "Authenticated coach absence", randomUUID());
    expect(await service.one(c.id)).toMatchObject({
      source: "coach",
      reason: "Authenticated coach absence",
      choiceDueAt: new Date(clock.getTime() + COACH_CHOICE_MS),
    });
    expect(await service.choose(candidate, c.id, "refund")).toMatchObject({ ok: true, cancellation: { choice: "refund" } });
  });
  it("preserves an owed Coach remedy before personal erasure", async () => {
    await service.coachCancel(coach, session, "absence", randomUUID());
    await preserveCancellationRefunds(auth.database, auth.database, candidate);
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [candidate]);
    expect((await auth.database.query("SELECT candidate_id,session_id FROM coaching_service_refund")).rows).toEqual([{ candidate_id: null, session_id: null }]);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_cancellation")).rows[0].n).toBe(0);
  });
  it("opens remedies for retirement and permits only affordable same-currency Peer selection", async () => {
    const peer = (await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Peer','cancel-peer@example.test','') RETURNING id"))
      .rows[0].id;
    const expensive = { coachId: peer, name: "Peer", amount: 9001, currency: "eur", durationMinutes: 60, specialties: [], languages: [] };
    let offers = [expensive];
    const peerService = coachingCancellations(auth.database, { refunds, now: () => clock, permitted: async () => true, peers: async () => offers });
    await auth.database.query("UPDATE human_coach SET retired_at=$2 WHERE id=$1", [coach, clock]);
    await peerService.retiredCoaches();
    const c = (await peerService.forCandidate(candidate))[0]!;
    expect(c.source).toBe("retirement");
    expect(await peerService.choose(candidate, c.id, "peer", peer)).toMatchObject({ ok: false, error: "peer_unavailable" });
    offers = [{ ...expensive, amount: 8000 }];
    expect(await peerService.choose(candidate, c.id, "peer", peer)).toMatchObject({ ok: true, cancellation: { choice: "peer", peerCoachId: peer } });
    // A new Order is unavailable until the original refund is actually confirmed.
    expect(await peerService.peerOrderCap(candidate, c.id, peer)).toBeNull();
  });
  it("does not grant a late anonymous cancellation refund through account erasure", async () => {
    clock = new Date("2026-11-13T11:30Z");
    await recordProviderCancellation(auth.database, session, "unconfirmed-erasure", clock, null);
    await preserveCancellationRefunds(auth.database, auth.database, candidate);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_service_refund")).rows[0].n).toBe(0);
  });
  it("does not start legacy retirement remedies while rollout gates are closed", async () => {
    enabled = false;
    await auth.database.query("UPDATE human_coach SET retired_at=$2 WHERE id=$1", [coach, clock]);
    await service.retiredCoaches();
    expect(await service.forCandidate(candidate)).toHaveLength(0);
  });
  it("withdrawal closes its pending choice so old due cases cannot starve later remedies", async () => {
    const result = await service.coachCancel(coach, session, "absence", randomUUID());
    if (!result.ok) throw Error("setup");
    await auth.database.query("UPDATE coaching_session SET withdrawn_at=$2 WHERE id=$1", [session, clock]);
    expect(await service.one(result.cancellation.id)).toMatchObject({ choice: "withdrawn" });
    clock = new Date(clock.getTime() + COACH_CHOICE_MS);
    await service.expireChoices();
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_service_refund")).rows[0].n).toBe(0);
  });
  it("isolates an oldest failing notice and does not send a successful later notice twice", async () => {
    const first = await service.coachCancel(coach, session, "first", randomUUID());
    if (!first.ok) throw Error("setup");
    clock = new Date(clock.getTime() + 1000);
    const second = (
      await auth.database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency) VALUES($1,$2,'cs_second_cancel',9000,'eur') RETURNING id",
        [candidate, coach],
      )
    ).rows[0].id;
    const next = await service.coachCancel(coach, second, "next", randomUUID());
    if (!next.ok) throw Error("setup");
    const sent: string[] = [];
    const notices = coachingCancellations(auth.database, {
      refunds,
      now: () => clock,
      sendNotice: async (c) => {
        if (c.id === first.cancellation.id) throw Error("permanent recipient failure");
        sent.push(c.id);
      },
    });
    await notices.deliverNotices();
    await notices.deliverNotices();
    expect(sent).toEqual([next.cancellation.id]);
  });
  it("checkpoints successful recipient channels when a later Coach email keeps failing", async () => {
    await signInWithMagicLink(auth, "cancel-coach@example.test");
    const result = await service.coachCancel(coach, session, "absence", randomUUID());
    if (!result.ok) throw Error("setup");
    const emails: string[] = [],
      pushes: string[] = [];
    const delivery = coachingCancellations(auth.database, {
      refunds,
      now: () => clock,
      sendNotice: (record, kind) =>
        cancellationNotice(
          auth.database,
          record,
          kind,
          "https://example.test",
          async (email) => {
            emails.push(email);
            if (email === "cancel-coach@example.test") throw Error("permanent Coach mailbox failure");
          },
          {
            notify: async (id) => {
              pushes.push(id);
            },
          },
        ),
    });
    await delivery.deliverNotices();
    clock = new Date(clock.getTime() + 300001);
    await delivery.deliverNotices();
    clock = new Date(clock.getTime() + 300001);
    await delivery.deliverNotices();
    expect(emails.filter((email) => email === "cancel-owner@example.test")).toHaveLength(1);
    expect(emails.filter((email) => email === "cancel-coach@example.test")).toHaveLength(3);
    expect(pushes).toEqual([candidate]);
  });
  it("does not repeat a successful email when its push channel fails afterwards", async () => {
    await service.coachCancel(coach, session, "absence", randomUUID());
    let emails = 0,
      pushes = 0;
    const delivery = coachingCancellations(auth.database, {
      refunds,
      now: () => clock,
      sendNotice: (record, kind) =>
        cancellationNotice(
          auth.database,
          record,
          kind,
          "https://example.test",
          async () => {
            emails++;
          },
          {
            notify: async () => {
              pushes++;
              if (pushes === 1) throw Error("push queue unavailable");
            },
          },
        ),
    });
    await delivery.deliverNotices();
    clock = new Date(clock.getTime() + 300001);
    await delivery.deliverNotices();
    await delivery.deliverNotices();
    expect(emails).toBe(1);
    expect(pushes).toBe(2);
  });
  it("lists a failed erased-account debt independently and audits Support intent before retry", async () => {
    await service.coachCancel(coach, session, "owed remedy", randomUUID());
    await preserveCancellationRefunds(auth.database, auth.database, candidate);
    const id = (await auth.database.query("SELECT id FROM coaching_service_refund")).rows[0].id;
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [candidate]);
    let fail = true,
      writes = 0;
    const resources: import("../coaching-refunds/port").RemoteCoachingRefund[] = [];
    const money = coachingRefunds(auth.database, {
      now: () => clock,
      stripe: {
        inspect: async () => ({ paymentIntent: "pi_original", refunds: resources }),
        create: async (input) => {
          writes++;
          const resource = {
            id: `re_support_${writes}`,
            intentId: id,
            attempt: input.attempt,
            amount: input.refundAmount,
            currency: "eur",
            status: fail ? ("pending" as const) : ("succeeded" as const),
          };
          resources.push(resource);
          return resource;
        },
      },
    });
    await money.run(id);
    expect((await money.one(id))?.state).toBe("pending");
    resources[0]!.status = "failed";
    await money.changed(resources[0]!.id, null);
    expect(await cancellationSupportRows(auth.database)).toEqual([
      expect.objectContaining({ id, source: "retained_refund", reason: null, refundId: id, state: "failed" }),
    ]);
    const audit: unknown[] = [];
    fail = false;
    expect(
      await retryCancellationRefund(money, id, async (before) => {
        expect(writes).toBe(1);
        audit.push({ id: before.id, state: before.state, attempt: before.attempt });
      }),
    ).toBe(true);
    expect(audit).toEqual([{ id, state: "failed", attempt: 1 }]);
    expect(writes).toBe(2);
    expect((await money.one(id))?.state).toBe("succeeded");
    expect(await cancellationSupportRows(auth.database)).toEqual([expect.objectContaining({ id, reason: null, state: "succeeded" })]);
  });
  it("requires ownership and a Coach reason; freezes reason, previous slot and seven-day choice", async () => {
    expect((await service.coachCancel(randomUUID(), session, "reason", randomUUID())).ok).toBe(false);
    expect(await service.coachCancel(coach, session, "  ", randomUUID())).toMatchObject({ ok: false, error: "reason_required" });
    const result = await service.coachCancel(coach, session, "Unexpected absence", randomUUID());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancellation).toMatchObject({
      reason: "Unexpected absence",
      choice: "awaiting",
      originalAt: new Date("2026-11-13T12:00Z"),
      choiceDueAt: new Date(clock.getTime() + COACH_CHOICE_MS),
    });
    expect((await auth.database.query("SELECT scheduled_at FROM coaching_session WHERE id=$1", [session])).rows[0].scheduled_at).toBeNull();
    expect(await service.maySchedule(auth.database, session, "candidate", new Date("2026-12-01T12:00Z"))).toBe(false);
  });
  it("refuses the Candidate a change to a session that has ended, policy on or off; to come or under way, as before (#1019)", async () => {
    // The session: 13 November 2026, 12:00 to 13:00 UTC (no duration: an hour).
    const to = new Date("2026-12-01T12:00Z");
    for (const policy of [false, true]) {
      enabled = policy;
      clock = new Date("2026-11-13T13:00Z");
      expect(await service.maySchedule(auth.database, session, "candidate", to)).toBe("too_late");
      expect(await service.maySchedule(auth.database, session, "candidate", null)).toBe("too_late");
      // The coach's own changes are not the Candidate's.
      expect(await service.maySchedule(auth.database, session, "coach", to)).toBe(true);
    }
    enabled = false;
    clock = new Date("2026-11-13T12:59:59Z");
    expect(await service.maySchedule(auth.database, session, "candidate", to)).toBe(true);
    clock = new Date("2026-11-11T12:00Z");
    expect(await service.maySchedule(auth.database, session, "candidate", to)).toBe(true);
    // Policy on, under way: the 24-hour window already refuses it, as before.
    enabled = true;
    clock = new Date("2026-11-13T12:30Z");
    expect(await service.maySchedule(auth.database, session, "candidate", to)).toBe(false);
  });
  it("rechecks the 24-hour boundary under the session lock and makes completed request replay idempotent", async () => {
    clock = new Date("2026-11-12T12:01Z");
    expect(await service.candidateCancel(candidate, session, randomUUID())).toMatchObject({ ok: false, error: "too_late" });
    clock = new Date("2026-11-12T12:00Z");
    const key = randomUUID();
    const results = await Promise.all([service.candidateCancel(candidate, session, key), service.candidateCancel(candidate, session, key)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_service_refund")).rows[0].n).toBe(1);
  });
  it("reopens the same paid service without a new charge or refund", async () => {
    const result = await service.coachCancel(coach, session, "absence", randomUUID());
    if (!result.ok) throw Error("setup");
    expect(await service.choose(candidate, result.cancellation.id, "same")).toMatchObject({ ok: true, cancellation: { choice: "same", refundId: null } });
    expect(reopened).toEqual([session]);
    expect((await auth.database.query("SELECT count(*)::int AS n FROM coaching_service_refund")).rows[0].n).toBe(0);
    expect(await service.maySchedule(auth.database, session, "candidate", new Date("2026-12-01T12:00Z"))).toBe(true);
  });
  it("defaults to an owed refund after seven days even if new intake gates subsequently close", async () => {
    const result = await service.coachCancel(coach, session, "absence", randomUUID());
    if (!result.ok) throw Error("setup");
    clock = new Date(clock.getTime() + COACH_CHOICE_MS);
    enabled = false;
    await service.expireChoices();
    expect(await service.one(result.cancellation.id)).toMatchObject({ choice: "refund", refundId: expect.any(String) });
  });
});

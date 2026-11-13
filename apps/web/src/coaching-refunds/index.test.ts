import { startFakeStripe, FAKE_STRIPE_SECRET_KEY } from "../billing/fake-stripe";
import { coachingRefundStripe } from "./stripe";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachingRefunds, migrateCoachingRefunds } from "./index";
import { CoachingRefundNotCreated, CoachingRefundContextMismatch, type CoachingRefundPort, type RemoteCoachingRefund } from "./port";
describe.skipIf(!connectionString)("durable contractual Coaching Session refunds", () => {
  let auth: TestAuth,
    candidate: string,
    session: string,
    clock: Date,
    resources: RemoteCoachingRefund[],
    writes: { key: string; amount: number }[],
    port: CoachingRefundPort,
    service: ReturnType<typeof coachingRefunds>,
    mode: "ok" | "lost" | "reject";
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    await migrateCoachingRefunds(auth.database);
    const cookie = await signInWithMagicLink(auth, "refund-owner@example.test");
    candidate = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id;
    const coach = (
      await auth.database.query("INSERT INTO human_coach(name,email,booking_url) VALUES('Refund Coach','refund-coach@example.test','') RETURNING id")
    ).rows[0].id;
    session = (
      await auth.database.query(
        "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency) VALUES($1,$2,'cs_original',9000,'eur') RETURNING id",
        [candidate, coach],
      )
    ).rows[0].id;
    await auth.database.query("INSERT INTO coaching_session_sale(session_id,snapshot,source) VALUES($1,$2,'legacy')", [
      session,
      { seller: { kind: "jobbbox" } },
    ]);
    clock = new Date("2026-11-11T12:00Z");
    resources = [];
    writes = [];
    mode = "ok";
    port = {
      inspect: async (input) => {
        expect(input.accountId).toBeNull();
        return { paymentIntent: "pi_original", refunds: [...resources] };
      },
      create: async (input) => {
        writes.push({ key: `${input.intentId}:${input.attempt}`, amount: input.refundAmount });
        if (mode === "reject") throw new CoachingRefundNotCreated("declined");
        const prior = resources.find((r) => r.intentId === input.intentId && r.attempt === input.attempt);
        if (prior) return prior;
        const resource: RemoteCoachingRefund = {
          id: `re_${randomUUID()}`,
          intentId: input.intentId,
          attempt: input.attempt,
          amount: input.refundAmount,
          currency: "eur",
          status: "succeeded",
        };
        resources.push(resource);
        if (mode === "lost") throw new Error("response lost");
        return resource;
      },
    };
    service = coachingRefunds(auth.database, { stripe: port, now: () => clock });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  it("freezes one entitlement and writes one refund under concurrent workers", async () => {
    const first = (await service.request(session))!,
      again = (await service.request(session))!;
    expect(again.id).toBe(first.id);
    await Promise.all([service.run(first.id), service.run(first.id)]);
    expect(resources).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect((await service.one(first.id))?.state).toBe("succeeded");
  });
  it("reconciles a failed external refund after it alone completed the entitlement", async () => {
    resources.push({ id: "re_external_full", intentId: null, attempt: null, amount: 9000, currency: "eur", status: "succeeded" });
    const intent = (await service.request(session))!;
    await service.run(intent.id);
    expect(writes).toHaveLength(0);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
    resources[0]!.status = "failed";
    await service.changed("re_external_full", "acct_wrong");
    expect(writes).toHaveLength(0);
    await service.changed("re_external_full", null);
    expect(writes.map((w) => w.amount)).toEqual([9000]);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
  });
  it("reopens a completed entitlement when its external partial coverage fails", async () => {
    resources.push({ id: "re_external_part", intentId: null, attempt: null, amount: 3000, currency: "eur", status: "succeeded" });
    const intent = (await service.request(session))!;
    await service.run(intent.id);
    expect(writes.map((w) => w.amount)).toEqual([6000]);
    resources[0]!.status = "failed";
    await service.changed("re_external_part", null);
    expect((await service.one(intent.id))?.state).toBe("failed");
    expect((await service.one(intent.id))?.resolvedAt).toBeNull();
    expect(await service.retry(intent.id)).toBe(true);
    expect(writes.map((w) => w.amount)).toEqual([6000, 3000]);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
  });
  it("recovers a lost remote outcome after the idempotency window without creating again", async () => {
    const intent = (await service.request(session))!;
    mode = "lost";
    await service.run(intent.id);
    expect((await service.one(intent.id))?.state).toBe("pending");
    clock = new Date(clock.getTime() + 3 * 86400000);
    mode = "ok";
    await service.run(intent.id);
    expect(writes).toHaveLength(1);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
  });
  it("quarantines an aged unknown operation and never guesses another write", async () => {
    const intent = (await service.request(session))!;
    port.create = async () => {
      writes.push({ key: "unknown", amount: 9000 });
      throw new Error("timeout before unknown result");
    };
    await service.run(intent.id);
    clock = new Date(clock.getTime() + 25 * 3600000);
    await service.run(intent.id);
    expect(writes).toHaveLength(1);
    expect((await service.one(intent.id))?.state).toBe("needs_review");
    expect(await service.retry(intent.id)).toBe(false);
  });
  it("uses a new numbered attempt only after conclusive rejection and Support retry", async () => {
    const intent = (await service.request(session))!;
    mode = "reject";
    await service.run(intent.id);
    expect((await service.one(intent.id))?.state).toBe("failed");
    mode = "ok";
    expect(await service.retry(intent.id)).toBe(true);
    expect(writes.map((w) => w.key)).toEqual([`${intent.id}:1`, `${intent.id}:2`]);
    expect(resources).toHaveLength(1);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
  });
  it("preserves a durable attempt whose pointer update was interrupted", async () => {
    const intent = (await service.request(session))!;
    await auth.database.query("INSERT INTO coaching_service_refund_attempt(refund_id,number,amount,started_at,outcome) VALUES($1,1,9000,$2,'unknown')", [
      intent.id,
      clock,
    ]);
    await service.run(intent.id);
    expect(writes[0]?.key).toBe(`${intent.id}:1`);
    expect((await service.one(intent.id))?.attempt).toBe(1);
  });
  it("returns only the remaining amount after a prior partial refund and never repeats a pending refund", async () => {
    resources.push({ id: "re_external", intentId: null, attempt: null, amount: 3000, currency: "eur", status: "succeeded" });
    const intent = (await service.request(session))!;
    await service.run(intent.id);
    expect(writes[0]?.amount).toBe(6000);
    resources[1]!.status = "pending";
    await service.run(intent.id);
    expect((await service.one(intent.id))?.state).toBe("pending");
    expect(writes).toHaveLength(1);
    resources[1]!.status = "succeeded";
    await service.changed(resources[1]!.id, null);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
  });
  it("routes bank-failure recovery and rejects a refund webhook from another account", async () => {
    const intent = (await service.request(session))!;
    await service.run(intent.id);
    resources[0]!.status = "failed";
    await service.changed(resources[0]!.id, "acct_wrong");
    expect((await service.one(intent.id))?.state).toBe("succeeded");
    await service.changed(resources[0]!.id, null);
    expect((await service.one(intent.id))?.state).toBe("failed");
    expect(await service.retry(intent.id)).toBe(true);
    expect(resources).toHaveLength(2);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
  });
  it("does not refund through an unverified account and preserves frozen routing after erasure", async () => {
    await auth.database.query("UPDATE coaching_session_sale SET snapshot=$2 WHERE session_id=$1", [session, { seller: { kind: "human_coach" } }]);
    const missing = (await service.request(session))!;
    await service.run(missing.id);
    expect((await service.one(missing.id))?.state).toBe("needs_review");
    expect(writes).toHaveLength(0);
    await auth.database.query("UPDATE coaching_service_refund SET routing_verified=true WHERE id=$1", [missing.id]);
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [candidate]);
    await service.run(missing.id);
    expect(await service.one(missing.id)).toMatchObject({ candidateId: null, sessionId: null, state: "succeeded", accountId: null });
  });
  it("recovers real SDK refund metadata after a lost response, expiry and purchaser erasure", async () => {
    const fake = await startFakeStripe();
    try {
      fake.payCheckoutSession("cs_original", 9000);
      const real = coachingRefundStripe({ secretKey: FAKE_STRIPE_SECRET_KEY, apiUrl: fake.url });
      let lost = true;
      const transport: CoachingRefundPort = {
        inspect: real.inspect,
        create: async (input) => {
          const result = await real.create(input);
          if (lost) {
            lost = false;
            throw new Error("response lost after Stripe committed");
          }
          return result;
        },
      };
      const money = coachingRefunds(auth.database, { stripe: transport, now: () => clock });
      const intent = (await money.request(session))!;
      await money.run(intent.id);
      expect((await money.one(intent.id))?.state).toBe("pending");
      await auth.database.query("DELETE FROM candidate WHERE id=$1", [candidate]);
      clock = new Date(clock.getTime() + 3 * 86400000);
      await money.run(intent.id);
      expect(await money.one(intent.id)).toMatchObject({ state: "succeeded", candidateId: null, sessionId: null });
      expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/refunds")).toHaveLength(1);
      const refund = fake.refunds()[0]!;
      fake.failRefund(refund.id, "insufficient_funds");
      await money.changed(refund.id, null);
      expect((await money.one(intent.id))?.state).toBe("failed");
      expect(await money.retry(intent.id)).toBe(true);
      expect((await money.one(intent.id))?.state).toBe("succeeded");
      expect(fake.refunds()).toHaveLength(2);
    } finally {
      await fake.stop();
    }
  });
  it("waits for an earlier partial refund and lets Support complete its later failure", async () => {
    resources.push({ id: "re_external", intentId: null, attempt: null, amount: 3000, currency: "eur", status: "pending" });
    const intent = (await service.request(session))!;
    await service.run(intent.id);
    expect((await service.one(intent.id))?.state).toBe("pending");
    resources[0]!.status = "failed";
    await service.run(intent.id);
    expect((await service.one(intent.id))?.state).toBe("failed");
    expect(await service.retry(intent.id)).toBe(true);
    expect(writes.map((w) => w.amount)).toEqual([6000, 3000]);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
  });
  it("fails closed on a changed payment amount/currency and handles a free session without a Stripe write", async () => {
    const intent = (await service.request(session))!;
    port.inspect = async () => {
      throw new CoachingRefundContextMismatch("changed amount");
    };
    await service.run(intent.id);
    expect((await service.one(intent.id))?.state).toBe("needs_review");
    expect(writes).toHaveLength(0);
    await auth.database.query("UPDATE coaching_service_refund SET amount=0 WHERE id=$1", [intent.id]);
    await service.run(intent.id);
    expect((await service.one(intent.id))?.state).toBe("succeeded");
    expect(writes).toHaveLength(0);
  });
});

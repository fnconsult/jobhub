import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { AGENT_KEY_LOG_SIZE, AGENT_KEY_PREFIX, AGENT_KEY_RATE_LIMIT, createAgentKeys, migrateAgentKeys, type AgentKeys } from "./index";

const connectionString = process.env.DATABASE_URL;
const READ_QUEUE = { method: "GET", path: "/admin/api/signalements" };

describe.skipIf(!connectionString)("Agent Keys (#1139, ADR-0118; needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let now: Date;
  let keys: AgentKeys;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_agent_keys");
    await migrateAgentKeys(throwaway.pool);
    now = new Date("2026-11-26T09:00:00Z");
    keys = createAgentKeys(throwaway.pool, { now: () => now });
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  async function created(input: Record<string, unknown> = { name: "triage-beta", scope: "signalements", days: 90 }) {
    const done = await keys.create(input);
    if (!done.ok) throw new Error(`not created: ${JSON.stringify(done)}`);
    return done;
  }

  describe("creating one", () => {
    it("gives its value once, with the prefix the secret hook knows, and keeps only its SHA-256 fingerprint", async () => {
      const { key, value } = await created();

      expect(value).toMatch(new RegExp(`^${AGENT_KEY_PREFIX}[A-Za-z0-9_-]{43}$`));
      expect(key).toEqual({
        id: expect.any(String),
        name: "triage-beta",
        scope: "signalements",
        createdAt: now,
        expiresAt: new Date("2027-02-24T09:00:00Z"),
        revokedAt: null,
        lastUsedAt: null,
      });
      const { rows } = await throwaway.pool.query(`SELECT * FROM agent_key`);
      expect(JSON.stringify(rows)).not.toContain(value);
      expect(rows[0].fingerprint).toBe(createHash("sha256").update(value).digest("hex"));
      // The list never holds it again.
      expect(JSON.stringify(await keys.list())).not.toContain(value);
    });

    it("expires in 90 days at most, its name made of lower-case letters, digits and hyphens, never taken twice", async () => {
      expect(await keys.create({ name: "triage-beta", scope: "signalements", days: 91 })).toEqual({ ok: false, errors: [{ field: "days", code: "invalid" }] });
      expect(await keys.create({ name: "Triage Beta!", scope: "signalements", days: 30 })).toEqual({ ok: false, errors: [{ field: "name", code: "invalid" }] });
      expect(await keys.create({ name: "", scope: "signalements", days: 30 })).toEqual({ ok: false, errors: [{ field: "name", code: "required" }] });
      expect(await keys.create({ name: "triage-beta", scope: "livraison", days: 30 })).toEqual({ ok: false, errors: [{ field: "scope", code: "invalid" }] });
      expect(await keys.create({ name: "triage-beta", scope: "signalements", days: 0 })).toEqual({ ok: false, errors: [{ field: "days", code: "invalid" }] });
      const { key } = await created({ name: "triage-beta", scope: "signalements", days: "30" });
      expect(key.expiresAt).toEqual(new Date("2026-12-26T09:00:00Z"));
      expect(await keys.create({ name: "triage-beta", scope: "signalements", days: 30 })).toEqual({ ok: false, refused: "name_taken" });
    });
  });

  describe("each call", () => {
    it("lets a key of its scope through, dating its last use and logging the call", async () => {
      const { key, value } = await created();
      now = new Date("2026-11-27T10:00:00Z");

      const allowed = await keys.authorize(value, "signalements", READ_QUEUE);

      expect(allowed).toEqual({ ok: true, key: { ...key, lastUsedAt: now } });
      expect((await keys.list())[0]!.lastUsedAt).toEqual(now);
      expect(await keys.calls(key.id)).toEqual([{ at: now, method: "GET", path: "/admin/api/signalements", outcome: "allowed" }]);
    });

    it("answers 401 without a key, with an unknown one, or a revoked or expired one, read again from the database on every call", async () => {
      const { key, value } = await created({ name: "triage-beta", scope: "signalements", days: 1 });
      expect(await keys.authorize(null, "signalements", READ_QUEUE)).toEqual({ ok: false, status: 401, reason: "missing" });
      expect(await keys.authorize(`${AGENT_KEY_PREFIX}${"x".repeat(43)}`, "signalements", READ_QUEUE)).toEqual({ ok: false, status: 401, reason: "unknown" });
      expect((await keys.authorize(value, "signalements", READ_QUEUE)).ok).toBe(true);

      now = new Date("2026-11-27T09:00:00Z");
      expect(await keys.authorize(value, "signalements", READ_QUEUE)).toEqual({ ok: false, status: 401, reason: "expired" });

      const other = await created({ name: "triage-prod", scope: "signalements", days: 90 });
      expect((await keys.authorize(other.value, "signalements", READ_QUEUE)).ok).toBe(true);
      await keys.revoke(other.key.id);
      expect(await keys.authorize(other.value, "signalements", READ_QUEUE)).toEqual({ ok: false, status: 401, reason: "revoked" });
      expect((await keys.calls(key.id)).map((call) => call.outcome)).toEqual(["expired", "allowed"]);
    });

    it("ignores a key outside its scope (#1172): answered as a call without one, neither logged nor dated, valid, revoked or expired alike", async () => {
      const { key, value } = await created({ name: "triage-beta", scope: "signalements", days: 1 });
      const elsewhere = { method: "GET", path: "/admin/api/livraison" };

      expect(await keys.authorize(value, "livraison", elsewhere)).toEqual({ ok: false, status: 401, reason: "out_of_scope" });
      expect((await keys.list())[0]!.lastUsedAt).toBeNull();
      expect(await keys.calls(key.id)).toEqual([]);

      // In its scope it is let through and counted; out of it, still nothing, before and after it expires or is revoked.
      expect((await keys.authorize(value, "signalements", READ_QUEUE)).ok).toBe(true);
      const lastUsed = (await keys.list())[0]!.lastUsedAt;
      now = new Date("2026-11-26T10:00:00Z");
      expect(await keys.authorize(value, "livraison", elsewhere)).toEqual({ ok: false, status: 401, reason: "out_of_scope" });
      now = new Date("2026-11-27T09:00:00Z");
      expect(await keys.authorize(value, "livraison", elsewhere)).toEqual({ ok: false, status: 401, reason: "out_of_scope" });
      await keys.revoke(key.id);
      expect(await keys.authorize(value, "livraison", elsewhere)).toEqual({ ok: false, status: 401, reason: "out_of_scope" });
      expect((await keys.list())[0]!.lastUsedAt).toEqual(lastUsed);
      expect((await keys.calls(key.id)).map((call) => call.outcome)).toEqual(["allowed"]);
    });

    it("never counts a call outside its scope against its rate limit", async () => {
      const { value } = await created();
      for (let call = 0; call < AGENT_KEY_RATE_LIMIT.calls * 2; call++) await keys.authorize(value, "livraison", READ_QUEUE);

      expect((await keys.authorize(value, "signalements", READ_QUEUE)).ok).toBe(true);
    });

    it(`answers 429 past ${AGENT_KEY_RATE_LIMIT.calls} calls in ${AGENT_KEY_RATE_LIMIT.seconds} seconds`, async () => {
      const { value } = await created();
      for (let call = 0; call < AGENT_KEY_RATE_LIMIT.calls; call++) expect((await keys.authorize(value, "signalements", READ_QUEUE)).ok).toBe(true);

      expect(await keys.authorize(value, "signalements", READ_QUEUE)).toEqual({ ok: false, status: 429, reason: "rate_limited" });
      now = new Date(now.getTime() + AGENT_KEY_RATE_LIMIT.seconds * 1000 + 1);
      expect((await keys.authorize(value, "signalements", READ_QUEUE)).ok).toBe(true);
    });

    it(`still lets only ${AGENT_KEY_RATE_LIMIT.calls} calls through when a flood of refused ones fills its ${AGENT_KEY_LOG_SIZE}-call log`, async () => {
      const { key, value } = await created();
      const allowed: boolean[] = [];
      for (let call = 0; call < AGENT_KEY_LOG_SIZE * 4; call++) allowed.push((await keys.authorize(value, "signalements", READ_QUEUE)).ok);

      expect(allowed.filter(Boolean)).toHaveLength(AGENT_KEY_RATE_LIMIT.calls);
      expect(allowed.indexOf(false)).toBe(AGENT_KEY_RATE_LIMIT.calls);
      expect(await keys.calls(key.id)).toHaveLength(AGENT_KEY_LOG_SIZE);
      now = new Date(now.getTime() + AGENT_KEY_RATE_LIMIT.seconds * 1000 + 1);
      expect((await keys.authorize(value, "signalements", READ_QUEUE)).ok).toBe(true);
    });

    it(`stores beyond its latest ${AGENT_KEY_LOG_SIZE} calls only the allowed ones the rate limit still counts, until they leave the window`, async () => {
      const { key, value } = await created();
      const stored = async () =>
        (await throwaway.pool.query<{ outcome: string }>(`SELECT outcome FROM agent_key_call WHERE agent_key_id = $1 ORDER BY id DESC`, [key.id])).rows.map((row) => row.outcome);
      for (let call = 0; call < AGENT_KEY_LOG_SIZE + 11; call++) await keys.authorize(value, "signalements", READ_QUEUE);

      // 30 allowed then 31 refused: the latest 50, plus the 11 older allowed ones still counted.
      const rows = await stored();
      expect(rows).toHaveLength(AGENT_KEY_LOG_SIZE + 11);
      expect(rows.slice(AGENT_KEY_LOG_SIZE).every((outcome) => outcome === "allowed")).toBe(true);
      expect(rows.length).toBeLessThanOrEqual(AGENT_KEY_LOG_SIZE + AGENT_KEY_RATE_LIMIT.calls);
      expect(await keys.calls(key.id)).toHaveLength(AGENT_KEY_LOG_SIZE);

      // Once out of the window, the next call drops them.
      now = new Date(now.getTime() + AGENT_KEY_RATE_LIMIT.seconds * 1000 + 1);
      expect((await keys.authorize(value, "signalements", READ_QUEUE)).ok).toBe(true);
      expect(await stored()).toHaveLength(AGENT_KEY_LOG_SIZE);
    });

    it(`keeps the log of its latest ${AGENT_KEY_LOG_SIZE} calls, newest first`, async () => {
      const { key, value } = await created();
      for (let call = 0; call < AGENT_KEY_LOG_SIZE + 5; call++) {
        now = new Date(now.getTime() + 60_000);
        await keys.authorize(value, "signalements", { method: "GET", path: `/admin/api/signalements?n=${call}` });
      }

      const calls = await keys.calls(key.id);
      expect(calls).toHaveLength(AGENT_KEY_LOG_SIZE);
      expect(calls[0]!.path).toBe(`/admin/api/signalements?n=${AGENT_KEY_LOG_SIZE + 4}`);
      expect(calls.at(-1)!.path).toBe("/admin/api/signalements?n=5");
    });
  });

  describe("revoking one", () => {
    it("dates its revocation once, and says what it was before and after", async () => {
      const { key } = await created();
      now = new Date("2026-11-28T09:00:00Z");

      const revoked = await keys.revoke(key.id);
      expect(revoked).toEqual({ before: key, after: { ...key, revokedAt: now } });
      now = new Date("2026-11-29T09:00:00Z");
      expect(await keys.revoke(key.id)).toEqual({ before: { ...key, revokedAt: new Date("2026-11-28T09:00:00Z") }, after: { ...key, revokedAt: new Date("2026-11-28T09:00:00Z") } });
      expect(await keys.revoke("not-an-id")).toBeNull();
    });
  });
});

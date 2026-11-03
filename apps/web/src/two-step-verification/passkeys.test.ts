import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_URL, connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createTwoStepVerification, RECENT_SECOND_STEP_MINUTES, type TwoStepVerification } from "./index";
import { addTestPasskey, createTestAuthenticator, type TestAuthenticator } from "./test-authenticator";
import { totpAt } from "./totp";

const SECRET = "test-secret-test-secret-test-secret-0123";

// Passkeys as the second step (#664, ADR-0075): added in Mon compte through @better-auth/passkey, checked by ours.
describe.skipIf(!connectionString)("Two-step verification with passkeys (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let now: Date;
  let twoStep: TwoStepVerification;
  let marie: { candidateId: string; sessionId: string; cookie: string };

  async function signedIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user, session } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { candidateId: user.id as string, sessionId: session.id as string, cookie };
  }

  const addPasskey = (who: { cookie: string }, name: string, key?: TestAuthenticator) => addTestPasskey(testAuth, who.cookie, name, key);

  /** The second step with `key`: the challenge for the session, then the key's answer. */
  async function secondStepWith(by: { candidateId: string; sessionId: string }, key: TestAuthenticator) {
    const options = await twoStep.passkeyChallenge(by);
    if (!options) throw new Error("no passkey challenge");
    return twoStep.verifyPasskey(by, key.authenticate(options));
  }

  const pending = (sessionId: string) => database.query(`UPDATE session SET "twoStepPending" = true WHERE id = $1`, [sessionId]);
  const isPending = async (sessionId: string) => (await database.query(`SELECT "twoStepPending" FROM session WHERE id = $1`, [sessionId])).rows[0]?.twoStepPending;
  const later = (seconds: number) => (now = new Date(now.getTime() + seconds * 1000));

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    now = new Date();
    twoStep = createTwoStepVerification(database, { secret: SECRET, now: () => now, relyingParty: { id: "localhost", origin: BASE_URL } });
    marie = await signedIn("marie.dupont@example.fr");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("turns on with a passkey alone, giving the 10 backup codes as with an authenticator app", async () => {
    const { id } = await addPasskey(marie, "MacBook de Marie");

    const enabled = await twoStep.enableWithPasskey(marie);

    expect(enabled).toEqual({ ok: true, backupCodes: expect.any(Array) });
    expect(enabled.ok && enabled.backupCodes).toHaveLength(10);
    expect(await twoStep.isEnabled(marie.candidateId)).toBe(true);
    expect(await twoStep.status(marie.candidateId)).toEqual({
      enabledAt: now,
      factors: [
        { kind: "passkey", id, name: "MacBook de Marie", device: null, addedAt: expect.any(Date), lastUsedAt: null },
        { kind: "backup_codes", addedAt: now, lastUsedAt: null },
      ],
      backupCodesLeft: 10,
    });
  });

  it("takes one of the account's passkeys as the second step: the session is no longer pending, the passkey's last use dated", async () => {
    const { id, key } = await addPasskey(marie, "Téléphone");
    await twoStep.enableWithPasskey(marie);
    const next = await signedIn("marie.dupont@example.fr");
    await pending(next.sessionId);
    later(60);

    expect(await secondStepWith(next, key)).toEqual({ ok: true, factor: "passkey" });

    expect(await isPending(next.sessionId)).toBe(false);
    expect((await twoStep.status(marie.candidateId)).factors[0]).toEqual({ kind: "passkey", id, name: "Téléphone", device: null, addedAt: expect.any(Date), lastUsedAt: now });
  });

  it("asks the browser for the account's own passkeys alone, and for none while it is off", async () => {
    const { key } = await addPasskey(marie, "Téléphone");
    expect(await twoStep.passkeyChallenge(marie)).toBeNull();
    await twoStep.enableWithPasskey(marie);

    const options = await twoStep.passkeyChallenge(marie);

    expect(options).toMatchObject({ rpId: "localhost", allowCredentials: [{ id: key.credentialId, type: "public-key" }] });
  });

  it("refuses a passkey of another account: the session stays pending", async () => {
    await addPasskey(marie, "Téléphone");
    await twoStep.enableWithPasskey(marie);
    const paul = await signedIn("paul.martin@example.fr");
    const { key: paulsKey } = await addPasskey(paul, "Clé de Paul");
    await twoStep.enableWithPasskey(paul);
    const next = await signedIn("marie.dupont@example.fr");
    await pending(next.sessionId);

    expect(await secondStepWith(next, paulsKey)).toEqual({ ok: false, error: "invalid_passkey" });
    expect(await isPending(next.sessionId)).toBe(true);
  });

  it("takes each challenge once: an answer replayed, or made to no challenge, is refused", async () => {
    const { key } = await addPasskey(marie, "Téléphone");
    await twoStep.enableWithPasskey(marie);
    const next = await signedIn("marie.dupont@example.fr");
    await pending(next.sessionId);
    const answer = key.authenticate((await twoStep.passkeyChallenge(next))!);

    expect(await twoStep.verifyPasskey(next, answer)).toEqual({ ok: true, factor: "passkey" });
    expect(await twoStep.verifyPasskey(next, answer)).toEqual({ ok: false, error: "invalid_passkey" });
    expect(await twoStep.verifyPasskey(next, { id: key.credentialId })).toEqual({ ok: false, error: "invalid_passkey" });
  });

  it("refuses a passkey that is not this site's, and counts every refusal towards the lock", async () => {
    await addPasskey(marie, "Téléphone");
    await twoStep.enableWithPasskey(marie);
    const elsewhere = createTestAuthenticator({ origin: "https://evil.example" });

    for (let attempt = 1; attempt < 5; attempt++) expect(await secondStepWith(marie, elsewhere)).toEqual({ ok: false, error: "invalid_passkey" });
    expect(await secondStepWith(marie, elsewhere)).toEqual({ ok: false, error: "locked", retryAt: expect.any(Date) });
  });

  it("still takes the backup codes when it was turned on with a passkey", async () => {
    await addPasskey(marie, "Téléphone");
    const enabled = await twoStep.enableWithPasskey(marie);

    expect(await twoStep.verify(marie, "123456")).toEqual({ ok: false, error: "invalid_code" });
    expect(await twoStep.verify(marie, enabled.ok ? enabled.backupCodes[0]! : "")).toEqual({ ok: true, factor: "backup_code" });
  });

  it("cannot be turned on with a passkey without one, nor twice", async () => {
    expect(await twoStep.enableWithPasskey(marie)).toEqual({ ok: false, error: "no_passkey" });
    await addPasskey(marie, "Téléphone");
    await twoStep.enableWithPasskey(marie);

    expect(await twoStep.enableWithPasskey(marie)).toEqual({ ok: false, error: "already_enabled" });
  });

  it("removes a passkey that is not the last factor at once", async () => {
    const first = await addPasskey(marie, "Téléphone");
    await twoStep.enableWithPasskey(marie);
    const second = await addPasskey(marie, "Clé USB");

    expect(await twoStep.removePasskey({ candidateId: marie.candidateId, secondStepAt: null }, first.id)).toEqual({ ok: true, disabled: false });

    const { factors } = await twoStep.status(marie.candidateId);
    expect(factors.map((factor) => (factor.kind === "passkey" ? factor.id : factor.kind))).toEqual([second.id, "backup_codes"]);
    expect(await twoStep.isEnabled(marie.candidateId)).toBe(true);
  });

  it(`turns it off with the last factor, which takes a second step done less than ${RECENT_SECOND_STEP_MINUTES} minutes ago`, async () => {
    const { id } = await addPasskey(marie, "Téléphone");
    await twoStep.enableWithPasskey(marie);
    const old = new Date(now.getTime() - RECENT_SECOND_STEP_MINUTES * 60_000);

    expect(await twoStep.removePasskey({ candidateId: marie.candidateId, secondStepAt: old }, id)).toEqual({ ok: false, error: "recent_second_step_required" });
    expect(await twoStep.isEnabled(marie.candidateId)).toBe(true);

    expect(await twoStep.removePasskey({ candidateId: marie.candidateId, secondStepAt: now }, id)).toEqual({ ok: true, disabled: true });
    expect(await twoStep.status(marie.candidateId)).toEqual({ enabledAt: null, factors: [], backupCodesLeft: 0 });
  });

  it("keeps it on when a passkey goes but the authenticator app stays", async () => {
    const { secret } = await twoStep.startSetup(marie.candidateId, "marie.dupont@example.fr");
    await twoStep.confirmSetup(marie, totpAt(secret, now));
    const { id } = await addPasskey(marie, "Téléphone");

    expect(await twoStep.removePasskey({ candidateId: marie.candidateId, secondStepAt: null }, id)).toEqual({ ok: true, disabled: false });
    expect((await twoStep.status(marie.candidateId)).factors.map((factor) => factor.kind)).toEqual(["authenticator_app", "backup_codes"]);
  });

  it("removes only the Candidate's own passkeys", async () => {
    const paul = await signedIn("paul.martin@example.fr");
    const { id } = await addPasskey(paul, "Clé de Paul");

    expect(await twoStep.removePasskey({ candidateId: marie.candidateId, secondStepAt: now }, id)).toEqual({ ok: false, error: "not_found" });
    expect((await twoStep.status(paul.candidateId)).factors).toHaveLength(1);
  });

  it("turned off, forgets the passkeys too", async () => {
    await addPasskey(marie, "Téléphone");
    await twoStep.enableWithPasskey(marie);

    await twoStep.disable(marie.candidateId);

    expect(await twoStep.status(marie.candidateId)).toEqual({ enabledAt: null, factors: [], backupCodesLeft: 0 });
  });

  it("names the device a passkey was made with when its authenticator says so", async () => {
    const windowsHello = Uint8Array.from(Buffer.from("08987058cadc4b81b6e130de50dcbe96", "hex"));
    await addPasskey(marie, "PC", createTestAuthenticator({ origin: BASE_URL, aaguid: windowsHello }));

    expect((await twoStep.status(marie.candidateId)).factors[0]).toMatchObject({ kind: "passkey", device: "Windows Hello" });
  });

  it("is never a way to sign in, nor removed past Mon compte: Better Auth's passkey sign-in and deletion are refused", async () => {
    const { id } = await addPasskey(marie, "Téléphone");

    expect((await testAuth.request("/api/auth/passkey/generate-authenticate-options", { cookie: marie.cookie })).status).toBe(404);
    expect((await testAuth.request("/api/auth/passkey/verify-authentication", { body: { response: { id } } })).status).toBe(404);
    expect((await testAuth.request("/api/auth/passkey/delete-passkey", { cookie: marie.cookie, body: { id } })).status).toBe(404);
    expect((await twoStep.status(marie.candidateId)).factors).toHaveLength(1);
  });

  it("renames a passkey through Better Auth's plugin, the account's own only", async () => {
    const { id } = await addPasskey(marie, "Téléphone");
    const paul = await signedIn("paul.martin@example.fr");

    expect((await testAuth.request("/api/auth/passkey/update-passkey", { cookie: paul.cookie, body: { id, name: "À moi" } })).ok).toBe(false);
    expect((await testAuth.request("/api/auth/passkey/update-passkey", { cookie: marie.cookie, body: { id, name: "iPhone de Marie" } })).ok).toBe(true);
    expect((await twoStep.status(marie.candidateId)).factors[0]).toMatchObject({ name: "iPhone de Marie" });
  });
});

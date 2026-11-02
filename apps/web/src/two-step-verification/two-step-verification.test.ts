import type { ExternalApiCall } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createTwoStepVerification, LOCK_MINUTES, MAX_FAILED_ATTEMPTS, type TwoStepVerification } from "./index";
import { totpAt } from "./totp";

const SECRET = "test-secret-test-secret-test-secret-0123";

describe.skipIf(!connectionString)("Two-step verification (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let now: Date;
  let calls: ExternalApiCall[];
  let twoStep: TwoStepVerification;
  let marie: { candidateId: string; sessionId: string };

  async function signedIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user, session } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { candidateId: user.id as string, sessionId: session.id as string };
  }

  /** Turns it on for `who` with an authenticator app: returns the app's secret and the backup codes shown. */
  async function turnOn(who = marie) {
    const { secret } = await twoStep.startSetup(who.candidateId, "marie.dupont@example.fr");
    const confirmed = await twoStep.confirmSetup(who, totpAt(secret, now));
    if (!confirmed.ok) throw new Error(confirmed.error);
    return { secret, backupCodes: confirmed.backupCodes };
  }

  const later = (seconds: number) => (now = new Date(now.getTime() + seconds * 1000));

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    now = new Date("2026-11-02T09:30:00Z");
    calls = [];
    twoStep = createTwoStepVerification(database, { secret: SECRET, now: () => now, externalApis: { record: (call) => void calls.push(call) } });
    marie = await signedIn("marie.dupont@example.fr");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("is off until the Candidate confirms an authenticator app with its first code", async () => {
    expect(await twoStep.status(marie.candidateId)).toEqual({ enabledAt: null, factors: [], backupCodesLeft: 0 });

    const { secret, uri } = await twoStep.startSetup(marie.candidateId, "marie.dupont@example.fr");
    expect(uri).toContain(`secret=${secret}`);
    expect(await twoStep.isEnabled(marie.candidateId)).toBe(false);

    expect(await twoStep.confirmSetup(marie, "000000")).toEqual({ ok: false, error: "invalid_code" });
    expect(await twoStep.isEnabled(marie.candidateId)).toBe(false);

    const confirmed = await twoStep.confirmSetup(marie, totpAt(secret, now));
    expect(confirmed).toEqual({ ok: true, backupCodes: expect.any(Array) });
    expect(await twoStep.isEnabled(marie.candidateId)).toBe(true);
    expect(await twoStep.status(marie.candidateId)).toEqual({
      enabledAt: now,
      factors: [
        { kind: "authenticator_app", addedAt: now, lastUsedAt: null },
        { kind: "backup_codes", addedAt: now, lastUsedAt: null },
      ],
      backupCodesLeft: 10,
    });
  });

  it("gives 10 different backup codes, kept only hashed, the authenticator app's secret only encrypted", async () => {
    const { secret, backupCodes } = await turnOn();

    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10);
    for (const code of backupCodes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    const stored = JSON.stringify((await database.query(`SELECT * FROM two_step_verification`)).rows);
    expect(stored).not.toContain(secret);
    for (const code of backupCodes) expect(stored).not.toContain(code.replace("-", ""));
  });

  it("cannot be set up again while it is on", async () => {
    await turnOn();

    await expect(twoStep.startSetup(marie.candidateId, "marie.dupont@example.fr")).rejects.toThrow(/already/i);
  });

  it("accepts the authenticator app's code as the second step, once: the same code cannot be used again", async () => {
    const { secret } = await turnOn();
    later(60);
    const code = totpAt(secret, now);

    expect(await twoStep.verify(marie, code)).toEqual({ ok: true, factor: "authenticator_app" });
    expect(await twoStep.verify(marie, code)).toEqual({ ok: false, error: "invalid_code" });
    expect((await twoStep.status(marie.candidateId)).factors[0]).toEqual({ kind: "authenticator_app", addedAt: expect.any(Date), lastUsedAt: now });
  });

  it("accepts each backup code once, however it is typed", async () => {
    const { backupCodes } = await turnOn();
    const [first, second] = backupCodes as [string, string];

    expect(await twoStep.verify(marie, ` ${first.toUpperCase().replace("-", "")} `)).toEqual({ ok: true, factor: "backup_code" });
    expect(await twoStep.verify(marie, first)).toEqual({ ok: false, error: "invalid_code" });
    expect(await twoStep.verify(marie, second)).toEqual({ ok: true, factor: "backup_code" });
    expect((await twoStep.status(marie.candidateId)).backupCodesLeft).toBe(8);
    expect((await twoStep.status(marie.candidateId)).factors[1]).toMatchObject({ kind: "backup_codes", lastUsedAt: now });
  });

  it(`waits ${LOCK_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS} wrong codes, even for a right one`, async () => {
    const { secret } = await turnOn();
    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt++) expect(await twoStep.verify(marie, "000000")).toEqual({ ok: false, error: "invalid_code" });
    const retryAt = new Date(now.getTime() + LOCK_MINUTES * 60_000);

    expect(await twoStep.verify(marie, "000000")).toEqual({ ok: false, error: "locked", retryAt });
    later(60);
    expect(await twoStep.verify(marie, totpAt(secret, now))).toEqual({ ok: false, error: "locked", retryAt });

    later(LOCK_MINUTES * 60);
    expect(await twoStep.verify(marie, totpAt(secret, now))).toEqual({ ok: true, factor: "authenticator_app" });
    expect(await twoStep.verify(marie, "000000")).toEqual({ ok: false, error: "invalid_code" });
  });

  it("counts every second step in the Tools' calls, never the code", async () => {
    const { secret, backupCodes } = await turnOn();
    later(60);
    await twoStep.verify(marie, "123456");
    await twoStep.verify(marie, totpAt(secret, now));
    await twoStep.verify(marie, backupCodes[0]!);

    expect(calls.map(({ provider, operation, ok, httpStatus }) => ({ provider, operation, ok, httpStatus }))).toEqual([
      { provider: "two_step_verification", operation: "setup", ok: true, httpStatus: 200 },
      { provider: "two_step_verification", operation: "second_step", ok: false, httpStatus: 401 },
      { provider: "two_step_verification", operation: "second_step", ok: true, httpStatus: 200 },
      { provider: "two_step_verification", operation: "second_step", ok: true, httpStatus: 200 },
    ]);
    expect(JSON.stringify(calls)).not.toContain("123456");
  });

  it("is not a second step while it is off", async () => {
    expect(await twoStep.verify(marie, "123456")).toEqual({ ok: false, error: "not_enabled" });
  });

  it("marks the session's second step done, so it is no longer pending, with the time it was done", async () => {
    const { secret } = await turnOn();
    await database.query(`UPDATE session SET "twoStepPending" = true WHERE id = $1`, [marie.sessionId]);
    later(60);

    await twoStep.verify(marie, totpAt(secret, now));

    const { rows } = await database.query(`SELECT "twoStepPending", "twoStepVerifiedAt" FROM session WHERE id = $1`, [marie.sessionId]);
    expect(rows[0]).toEqual({ twoStepPending: false, twoStepVerifiedAt: now });
  });

  it("renews the backup codes: the old ones no longer work", async () => {
    const { backupCodes } = await turnOn();
    later(60);

    const renewed = await twoStep.regenerateBackupCodes(marie.candidateId);

    expect(renewed).toHaveLength(10);
    expect(await twoStep.verify(marie, backupCodes[0]!)).toEqual({ ok: false, error: "invalid_code" });
    expect(await twoStep.verify(marie, renewed![0]!)).toEqual({ ok: true, factor: "backup_code" });
    expect((await twoStep.status(marie.candidateId)).factors[1]).toMatchObject({ kind: "backup_codes", addedAt: now });
  });

  it("turned off, forgets the app and the codes", async () => {
    const { backupCodes } = await turnOn();

    expect(await twoStep.disable(marie.candidateId)).toBe(true);

    expect(await twoStep.status(marie.candidateId)).toEqual({ enabledAt: null, factors: [], backupCodesLeft: 0 });
    expect(await twoStep.verify(marie, backupCodes[0]!)).toEqual({ ok: false, error: "not_enabled" });
    expect(await twoStep.disable(marie.candidateId)).toBe(false);
  });

  it("turned off, signs out the sessions still waiting for their second step, and only those", async () => {
    await turnOn();
    const pending = await signedIn("marie.dupont@example.fr");
    await database.query(`UPDATE session SET "twoStepPending" = true WHERE id = $1`, [pending.sessionId]);

    await twoStep.disable(marie.candidateId);

    const { rows } = await database.query(`SELECT id FROM session WHERE "userId" = $1`, [marie.candidateId]);
    expect(rows.map((row) => row.id)).toEqual([marie.sessionId]);
  });

  it("still takes the backup codes when the app's secret no longer opens (AUTH_SECRET rotated)", async () => {
    const { secret, backupCodes } = await turnOn();
    const rotated = createTwoStepVerification(database, { secret: "another-secret-another-secret-another-0", now: () => now });
    later(60);

    expect(await rotated.verify(marie, totpAt(secret, now))).toEqual({ ok: false, error: "invalid_code" });
    expect(await rotated.verify(marie, backupCodes[0]!)).toEqual({ ok: true, factor: "backup_code" });
  });
});

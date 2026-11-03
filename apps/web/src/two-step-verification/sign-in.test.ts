import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { createTwoStepVerification } from "./index";
import { mustHaveTwoStepVerification } from "./obligation";
import { totpAt } from "./totp";

describe.skipIf(!connectionString)("Signing in with Two-step verification on (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;

  beforeEach(async () => {
    testAuth = await startTestAuth();
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  async function sessionOf(cookie: string) {
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as { user: { id: string }; session: { id: string; twoStepPending: boolean } };
  }

  it("a magic link opens a pending session for an account that has it, a session that is not pending otherwise", async () => {
    const database = testAuth.auth.options.database as Pool;
    const twoStep = createTwoStepVerification(database, { secret: testAuth.config.secret });
    const first = await sessionOf(await signInWithMagicLink(testAuth, "marie.dupont@example.fr"));
    expect(first.session.twoStepPending).toBe(false);

    const { secret } = await twoStep.startSetup(first.user.id, "marie.dupont@example.fr");
    await twoStep.confirmSetup({ candidateId: first.user.id, sessionId: first.session.id }, totpAt(secret, new Date()));

    const second = await sessionOf(await signInWithMagicLink(testAuth, "marie.dupont@example.fr"));
    expect(second.session.twoStepPending).toBe(true);
    expect((await sessionOf(await signInWithMagicLink(testAuth, "jean.martin@example.fr"))).session.twoStepPending).toBe(false);
  });

  it("a magic link opens a pending session for an account that must have it and has no factor yet (#665)", async () => {
    await testAuth.stop();
    testAuth = await startTestAuth({ mustHaveTwoStepVerification: (candidateId) => mustHaveTwoStepVerification(testAuth.database, candidateId, ["claire@jobbbox.fr"]) });
    await migrateDatabase(testAuth.config);

    expect((await sessionOf(await signInWithMagicLink(testAuth, "claire@jobbbox.fr"))).session.twoStepPending).toBe(true);
    expect((await sessionOf(await signInWithMagicLink(testAuth, "jean.martin@example.fr"))).session.twoStepPending).toBe(false);
  }, 60_000);
});

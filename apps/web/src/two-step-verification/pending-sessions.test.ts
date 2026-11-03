import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createTwoStepVerification } from "./index";
import { createPendingSessions } from "./pending-sessions";
import { totpAt } from "./totp";

describe.skipIf(!connectionString)("Telling a pending session by its cookie (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  const headersOf = (cookie: string) => new Headers({ cookie });

  it("is pending from a magic link until the second step is done, never for an account without it nor without a session", async () => {
    const twoStep = createTwoStepVerification(database, { secret: testAuth.config.secret });
    const pending = createPendingSessions(database);
    const first = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const { user, session } = await (await testAuth.request("/api/auth/get-session", { cookie: first })).json();
    const { secret } = await twoStep.startSetup(user.id, "marie.dupont@example.fr");
    await twoStep.confirmSetup({ candidateId: user.id, sessionId: session.id }, totpAt(secret, new Date()));
    expect(await pending.of(headersOf(first))).toBeNull();

    const second = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const secondSession = (await database.query(`SELECT id FROM session WHERE "userId" = $1 AND "twoStepPending"`, [user.id])).rows[0];
    expect(await pending.of(headersOf(second))).toEqual({ sessionId: secondSession.id, candidateId: user.id });

    await twoStep.verify({ candidateId: user.id, sessionId: secondSession.id }, totpAt(secret, new Date(Date.now() + 30_000)));
    expect(await pending.of(headersOf(second))).toBeNull();

    expect(await pending.of(headersOf("better-auth.session_token=unknown.signature"))).toBeNull();
    expect(await pending.of(new Headers())).toBeNull();
  });
});

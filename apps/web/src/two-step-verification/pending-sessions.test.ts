import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { createTwoStepVerification, type TwoStepVerification } from "./index";
import { createPendingSessions } from "./pending-sessions";
import { totpAt } from "./totp";

describe.skipIf(!connectionString)("Telling a pending session by its cookie (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let twoStep: TwoStepVerification;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    twoStep = createTwoStepVerification(database, { secret: testAuth.config.secret });
    // The Back Office Roles and the Human Coaches decide who must have it.
    await migrateDatabase(testAuth.config);
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  });

  const headersOf = (cookie: string) => new Headers({ cookie });
  const sessionOf = async (cookie: string) => (await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as { user: { id: string }; session: { id: string } } | null;
  const signedIn = async (cookie: string) => (await sessionOf(cookie))!;

  it("is pending from a magic link until the second step is done, never for an account without it nor without a session", async () => {
    const pending = createPendingSessions(database);
    const first = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const { user, session } = await signedIn(first);
    const { secret } = await twoStep.startSetup(user.id, "marie.dupont@example.fr");
    await twoStep.confirmSetup({ candidateId: user.id, sessionId: session.id }, totpAt(secret, new Date()));
    expect(await pending.of(headersOf(first))).toBeNull();

    const second = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const secondSession = (await database.query(`SELECT id FROM session WHERE "userId" = $1 AND "twoStepPending"`, [user.id])).rows[0];
    expect(await pending.of(headersOf(second))).toEqual({ sessionId: secondSession.id, candidateId: user.id, step: "second_step" });

    await twoStep.verify({ candidateId: user.id, sessionId: secondSession.id }, totpAt(secret, new Date(Date.now() + 30_000)));
    expect(await pending.of(headersOf(second))).toBeNull();

    expect(await pending.of(headersOf("better-auth.session_token=unknown.signature"))).toBeNull();
    expect(await pending.of(new Headers())).toBeNull();
  });

  describe("an account that must have it (ADR-0075, #665), decided on every request", () => {
    it("sends an ADMIN_EMAILS super-admin signed in by magic link, with no factor, to set it up", async () => {
      const pending = createPendingSessions(database, { adminEmails: ["claire@jobbbox.fr"] });
      const cookie = await signInWithMagicLink(testAuth, "Claire@Jobbbox.fr");
      const { user, session } = await signedIn(cookie);

      expect(await pending.of(headersOf(cookie))).toEqual({ sessionId: session.id, candidateId: user.id, step: "setup" });
    });

    it("sends a Candidate given a Back Office Role while signed in to set it up on the next request, the session pending from then on", async () => {
      const pending = createPendingSessions(database);
      const cookie = await signInWithMagicLink(testAuth, "paul@jobbbox.fr");
      const { user, session } = await signedIn(cookie);
      expect(await pending.of(headersOf(cookie))).toBeNull();

      await database.query(`INSERT INTO administrator_role (candidate_id, role) VALUES ($1, 'support')`, [user.id]);

      expect(await pending.of(headersOf(cookie))).toEqual({ sessionId: session.id, candidateId: user.id, step: "setup" });
      // Wherever the session is read, it is not signed in any more (auth/server.ts, getCurrentSession).
      expect((await database.query(`SELECT "twoStepPending" FROM session WHERE id = $1`, [session.id])).rows[0].twoStepPending).toBe(true);
    });

    it("sends a Candidate made an active Human Coach while signed in to set it up; a retired coach is not asked", async () => {
      const pending = createPendingSessions(database);
      const cookie = await signInWithMagicLink(testAuth, "lea.coach@example.fr");
      const { user, session } = await signedIn(cookie);
      await database.query(`INSERT INTO human_coach (name, email, booking_url, retired_at) VALUES ('Léa', 'lea.coach@example.fr', 'https://cal.com/lea', now())`);
      expect(await pending.of(headersOf(cookie))).toBeNull();

      await database.query(`INSERT INTO human_coach (name, email, booking_url) VALUES ('Léa', 'lea.coach@example.fr', 'https://cal.com/lea')`);
      expect(await pending.of(headersOf(cookie))).toEqual({ sessionId: session.id, candidateId: user.id, step: "setup" });
    });

    it("asks for the second step once it is set up, and nothing once it is done", async () => {
      const pending = createPendingSessions(database, { adminEmails: ["claire@jobbbox.fr"] });
      const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
      const { user, session } = await signedIn(cookie);
      const { secret } = await twoStep.startSetup(user.id, "claire@jobbbox.fr");
      await twoStep.confirmSetup({ candidateId: user.id, sessionId: session.id }, totpAt(secret, new Date()));
      expect(await pending.of(headersOf(cookie))).toBeNull();

      const again = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
      expect(await pending.of(headersOf(again))).toMatchObject({ candidateId: user.id, step: "second_step" });
    });

    it("never asks a session signed in through a Sign-in Provider", async () => {
      const pending = createPendingSessions(database, { adminEmails: ["claire@jobbbox.fr"] });
      const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
      const { session } = await signedIn(cookie);
      await database.query(`UPDATE session SET "signInMethod" = 'google', "twoStepPending" = false WHERE id = $1`, [session.id]);

      expect(await pending.of(headersOf(cookie))).toBeNull();
      expect(await pending.of(headersOf(cookie))).toBeNull();
    });

    it("lets a pending session go once the account no longer must have it and has no factor", async () => {
      const pending = createPendingSessions(database);
      const cookie = await signInWithMagicLink(testAuth, "paul@jobbbox.fr");
      const { user } = await signedIn(cookie);
      await database.query(`INSERT INTO administrator_role (candidate_id, role) VALUES ($1, 'support')`, [user.id]);
      expect(await pending.of(headersOf(cookie))).toMatchObject({ step: "setup" });

      await database.query(`DELETE FROM administrator_role WHERE candidate_id = $1`, [user.id]);
      expect(await pending.of(headersOf(cookie))).toBeNull();
      expect((await database.query(`SELECT "twoStepPending" FROM session WHERE "userId" = $1`, [user.id])).rows[0].twoStepPending).toBe(false);
    });
  });
});

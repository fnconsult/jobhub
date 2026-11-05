import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../migrations";
import { createTwoStepVerification } from "../two-step-verification/index";
import { mustHaveTwoStepVerification } from "../two-step-verification/obligation";
import { totpAt } from "../two-step-verification/totp";
import { askSignInEmail, codeIn, connectionString, cookiesFrom, linkIn, startTestAuth, type TestAuth } from "./test-support";

describe.skipIf(!connectionString)("the sign-in email's code (#686, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  beforeEach(async () => {
    testAuth = await startTestAuth();
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  const signInWithCode = (email: string, otp: string) => testAuth.request("/api/auth/sign-in/email-otp", { body: { email, otp } });
  const sessionOf = (cookie: string) => testAuth.auth.api.getSession({ headers: new Headers({ cookie }) });

  it("comes in the sign-in email, 6 digits, and signs in like its link", async () => {
    const email = await askSignInEmail(testAuth, "marie.dupont@example.fr");

    const signedIn = await signInWithCode("marie.dupont@example.fr", codeIn(email));

    expect(signedIn.status).toBe(200);
    const current = await sessionOf(cookiesFrom(signedIn));
    expect(current?.user.email).toBe("marie.dupont@example.fr");
    expect(current?.session.signInMethod).toBe("magic-link");
  });

  it("works only once", async () => {
    const code = codeIn(await askSignInEmail(testAuth, "marie.dupont@example.fr"));
    await signInWithCode("marie.dupont@example.fr", code);

    const reused = await signInWithCode("marie.dupont@example.fr", code);

    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ code: "INVALID_OTP" });
    expect(reused.headers.getSetCookie()).toEqual([]);
  });

  it("takes 5 wrong codes, then no longer works, the right one included, until another email is asked", async () => {
    const code = codeIn(await askSignInEmail(testAuth, "marie.dupont@example.fr"));
    const wrong = code === "000000" ? "111111" : "000000";

    for (let tries = 0; tries < 5; tries++) {
      const refused = await signInWithCode("marie.dupont@example.fr", wrong);
      expect(await refused.json()).toMatchObject({ code: "INVALID_OTP" });
    }
    const right = await signInWithCode("marie.dupont@example.fr", code);

    expect(right.status).toBe(403);
    expect(await right.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    const next = await signInWithCode("marie.dupont@example.fr", codeIn(await askSignInEmail(testAuth, "marie.dupont@example.fr")));
    expect(next.status).toBe(200);
  });

  it("is replaced by the code of a newer email", async () => {
    const first = codeIn(await askSignInEmail(testAuth, "marie.dupont@example.fr"));
    const second = codeIn(await askSignInEmail(testAuth, "marie.dupont@example.fr"));

    if (first !== second) expect((await signInWithCode("marie.dupont@example.fr", first)).status).toBe(400);
    expect((await signInWithCode("marie.dupont@example.fr", second)).status).toBe(200);
  });

  it("spends the link once used, and every link still pending for that address", async () => {
    const older = await askSignInEmail(testAuth, "Marie.Dupont@example.fr");
    const email = await askSignInEmail(testAuth, "marie.dupont@example.fr");
    const other = await askSignInEmail(testAuth, "jean.martin@example.fr");
    await signInWithCode("marie.dupont@example.fr", codeIn(email));

    for (const message of [email, older]) {
      const refused = await testAuth.request(linkIn(message));
      expect(new URL(refused.headers.get("location")!).searchParams.get("error")).toBe("INVALID_TOKEN");
      expect(refused.headers.getSetCookie().join()).not.toContain("session_token");
    }
    expect((await testAuth.request(linkIn(other))).headers.getSetCookie().join()).toContain("session_token");
  });

  it("is spent once its link is used", async () => {
    const email = await askSignInEmail(testAuth, "marie.dupont@example.fr");
    await testAuth.request(linkIn(email));

    const refused = await signInWithCode("Marie.Dupont@example.fr", codeIn(email));

    expect(refused.status).toBe(400);
    expect(refused.headers.getSetCookie()).toEqual([]);
  });

  describe("and the second step (ADR-0075)", () => {
    it("opens a pending session for an account that has Two-step verification", async () => {
      const twoStep = createTwoStepVerification(testAuth.database, { secret: testAuth.config.secret });
      const first = (await sessionOf(cookiesFrom(await signInWithCode("marie.dupont@example.fr", codeIn(await askSignInEmail(testAuth, "marie.dupont@example.fr"))))))!;
      expect(first.session.twoStepPending).toBe(false);
      const { secret } = await twoStep.startSetup(first.user.id, "marie.dupont@example.fr");
      await twoStep.confirmSetup({ candidateId: first.user.id, sessionId: first.session.id }, totpAt(secret, new Date()));

      const signedIn = await signInWithCode("marie.dupont@example.fr", codeIn(await askSignInEmail(testAuth, "marie.dupont@example.fr")));

      const pending = await testAuth.database.query(`SELECT "twoStepPending" FROM session WHERE token = $1`, [(await signedIn.json()).token]);
      expect(pending.rows[0].twoStepPending).toBe(true);
    });

    it("opens a pending session for an account that must have it (#665)", async () => {
      await testAuth.stop();
      testAuth = await startTestAuth({ mustHaveTwoStepVerification: (candidateId) => mustHaveTwoStepVerification(testAuth.database, candidateId, ["claire@jobbbox.fr"]) });
      await migrateDatabase(testAuth.config);

      for (const [email, pending] of [["claire@jobbbox.fr", true], ["jean.martin@example.fr", false]] as const) {
        const signedIn = await signInWithCode(email, codeIn(await askSignInEmail(testAuth, email)));
        const row = await testAuth.database.query(`SELECT "twoStepPending" FROM session WHERE token = $1`, [(await signedIn.json()).token]);
        expect(row.rows[0].twoStepPending).toBe(pending);
      }
    }, 60_000);
  });

  it("is kept hashed and never written to a log", async () => {
    const logged = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level));
    try {
      const code = codeIn(await askSignInEmail(testAuth, "marie.dupont@example.fr"));
      await signInWithCode("marie.dupont@example.fr", code === "000000" ? "111111" : "000000");

      const stored = await testAuth.database.query(`SELECT value FROM verification WHERE identifier LIKE '%otp%'`);
      expect(stored.rows).toHaveLength(1);
      expect(JSON.stringify(stored.rows)).not.toContain(code);
      for (const spy of logged) expect(JSON.stringify(spy.mock.calls)).not.toContain(code);
    } finally {
      for (const spy of logged) spy.mockRestore();
    }
  });

  it("is emailed with its link alone: the plugin's other endpoints are not served", async () => {
    for (const path of ["send-verification-otp", "check-verification-otp", "verify-email", "request-password-reset", "reset-password", "request-email-change", "change-email"]) {
      const refused = await testAuth.request(`/api/auth/email-otp/${path}`, { body: { email: "marie.dupont@example.fr", type: "sign-in", otp: "123456" } });
      expect(refused.status, path).toBe(404);
    }
    expect((await testAuth.request("/api/auth/forget-password/email-otp", { body: { email: "marie.dupont@example.fr" } })).status).toBe(404);
    expect(testAuth.mailbox).toHaveLength(0);
  });
});

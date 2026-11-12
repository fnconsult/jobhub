import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authConfigFromEnv } from "./config";
import type { ReviewSignInUse } from "./index";
import { isReviewAddress, reviewCodeFor, reviewSignInFromEnv, type ReviewSignIn } from "./review-sign-in";
import { askSignInEmail, codeIn, connectionString, cookiesFrom, startTestAuth, testSignIn, type TestAuth } from "./test-support";

const DEMO = "demo.candidate@jobbbox.ai";
const CODE = "482915";
/** What authConfigFromEnv needs besides (its pool is never connected here). */
const BASE = { DATABASE_URL: "postgres://jobhub:jobhub@localhost:5433/jobhub" };
const ON = { REVIEW_SIGN_IN: "on", REVIEW_SIGN_IN_EMAILS: ` ${DEMO.toUpperCase()} , demo.coach@jobbbox.ai`, REVIEW_SIGN_IN_CODE: CODE };

describe("the store review's sign-in code, as the environment sets it (#981)", () => {
  const quiet = () => undefined;

  it("is off by default, and off unless REVIEW_SIGN_IN is exactly on", () => {
    expect(reviewSignInFromEnv({}, quiet)).toBeNull();
    expect(reviewSignInFromEnv({ REVIEW_SIGN_IN_EMAILS: DEMO, REVIEW_SIGN_IN_CODE: CODE }, quiet)).toBeNull();
    for (const value of ["", "true", "1", "yes", "ON"]) expect(reviewSignInFromEnv({ ...ON, REVIEW_SIGN_IN: value }, quiet)).toBeNull();
    expect(authConfigFromEnv(BASE).reviewSignIn).toBeNull();
  });

  it("names its demo accounts, lowercased, and its code when on", () => {
    expect(reviewSignInFromEnv(ON, quiet)).toEqual({ emails: [DEMO, "demo.coach@jobbbox.ai"], code: CODE });
    expect(authConfigFromEnv({ ...BASE, ...ON }).reviewSignIn).toEqual({ emails: [DEMO, "demo.coach@jobbbox.ai"], code: CODE });
  });

  it("stays off when misconfigured, saying why, never the code", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ REVIEW_SIGN_IN_EMAILS: "" }, /names no address/],
      [{ REVIEW_SIGN_IN_EMAILS: "a@jobbbox.ai,b@jobbbox.ai,c@jobbbox.ai" }, /more than 2/],
      [{ REVIEW_SIGN_IN_EMAILS: "demo" }, /not an address/],
      [{ ADMIN_EMAILS: `claire@jobbbox.ai, ${DEMO}` }, /ADMIN_EMAILS/],
      [{ REVIEW_SIGN_IN_CODE: "" }, /not 6 digits/],
      [{ REVIEW_SIGN_IN_CODE: "48291" }, /not 6 digits/],
      [{ REVIEW_SIGN_IN_CODE: "48291a" }, /not 6 digits/],
      [{ REVIEW_SIGN_IN_CODE: "000000" }, /too easy/],
      [{ REVIEW_SIGN_IN_CODE: "123456" }, /too easy/],
      [{ REVIEW_SIGN_IN_CODE: "987654" }, /too easy/],
    ];
    for (const [change, why] of cases) {
      const warn = vi.fn();
      expect(reviewSignInFromEnv({ ...ON, ...change }, warn), JSON.stringify(change)).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(why));
      expect(JSON.stringify(warn.mock.calls)).not.toContain(CODE);
    }
  });

  it("gives its code to its demo addresses alone", () => {
    const review: ReviewSignIn = { emails: [DEMO], code: CODE };
    expect(reviewCodeFor(review, "Demo.Candidate@Jobbbox.ai")).toBe(CODE);
    expect(reviewCodeFor(review, " demo.candidate@jobbbox.ai")).toBeUndefined();
    expect(reviewCodeFor(review, "marie.dupont@example.fr")).toBeUndefined();
    expect(reviewCodeFor(review, "demo.candidate@jobbbox.ai.example.fr")).toBeUndefined();
    expect(reviewCodeFor(null, DEMO)).toBeUndefined();
    expect(isReviewAddress(review, undefined)).toBe(false);
  });
});

describe.skipIf(!connectionString)("the store review's sign-in code, signing in (#981, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let uses: ReviewSignInUse[];
  const review: ReviewSignIn = { emails: [DEMO, "admin.demo@jobbbox.ai"], code: CODE };

  async function start(reviewSignIn: ReviewSignIn | null) {
    uses = [];
    testAuth = await startTestAuth({
      reviewSignIn,
      recordReviewSignIn: async (use) => void uses.push(use),
      signIn: testSignIn([], { administrators: ["admin.demo@jobbbox.ai"] }),
    });
  }
  beforeEach(async () => start(review));
  afterEach(async () => {
    await testAuth.stop();
  });

  const signInWithCode = (email: string, otp: string) => testAuth.request("/api/auth/sign-in/email-otp", { body: { email, otp } });
  const sessionOf = (cookie: string) => testAuth.auth.api.getSession({ headers: new Headers({ cookie }) });
  const wrongCode = (code: string) => (code === "000000" ? "111111" : "000000");

  it("signs the demo address in with the right code, through the email's code flow and session, and records it", async () => {
    expect((await signInWithCode(DEMO, CODE)).status).toBe(400); // No email asked yet: no code to try.
    const email = await askSignInEmail(testAuth, DEMO);
    expect(codeIn(email)).toBe(CODE);

    const signedIn = await signInWithCode("Demo.Candidate@jobbbox.ai", CODE);

    expect(signedIn.status).toBe(200);
    const current = await sessionOf(cookiesFrom(signedIn));
    expect(current?.user.email).toBe(DEMO);
    expect(current?.session.signInMethod).toBe("magic-link");
    expect(current?.session.twoStepPending).toBe(false);
    expect(uses.at(-1)).toEqual({ candidateId: current!.user.id, email: DEMO, outcome: "succeeded" });
    expect(JSON.stringify(uses)).not.toContain(CODE);
  });

  it("refuses that code for any other address, which gets a random code as before, and records nothing", async () => {
    const other = await askSignInEmail(testAuth, "marie.dupont@example.fr");
    if (codeIn(other) !== CODE) {
      const refused = await signInWithCode("marie.dupont@example.fr", CODE);
      expect(refused.status).toBe(400);
      expect(refused.headers.getSetCookie()).toEqual([]);
    }
    expect((await signInWithCode("marie.dupont@example.fr", codeIn(other))).status).toBe(200);
    // Without any email asked: no code at all.
    expect((await signInWithCode("jean.martin@example.fr", CODE)).status).toBe(400);
    expect(uses).toEqual([]);
  });

  it("is off by default: the demo address gets a random code and the fixed one signs nobody in", async () => {
    await testAuth.stop();
    await start(null);

    const email = await askSignInEmail(testAuth, DEMO);
    if (codeIn(email) !== CODE) expect((await signInWithCode(DEMO, CODE)).status).toBe(400);
    expect((await signInWithCode(DEMO, codeIn(email))).status).toBe(200);
    expect(uses).toEqual([]);
  });

  it("takes 5 wrong codes, then refuses the right one until another email is asked, each wrong code recorded", async () => {
    const signedUp = await signInWithCode(DEMO, codeIn(await askSignInEmail(testAuth, DEMO)));
    expect(signedUp.status).toBe(200);
    uses = [];
    await askSignInEmail(testAuth, DEMO);

    for (let tries = 0; tries < 5; tries++) {
      expect(await (await signInWithCode(DEMO, wrongCode(CODE))).json()).toMatchObject({ code: "INVALID_OTP" });
    }
    const right = await signInWithCode(DEMO, CODE);

    expect(right.status).toBe(403);
    expect(await right.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    expect(uses.map((use) => use.outcome)).toEqual(["failed", "failed", "failed", "failed", "failed", "failed"]);
    await askSignInEmail(testAuth, DEMO);
    expect((await signInWithCode(DEMO, CODE)).status).toBe(200);
  });

  it("works once per email, like the email's code", async () => {
    await askSignInEmail(testAuth, DEMO);
    expect((await signInWithCode(DEMO, CODE)).status).toBe(200);
    expect((await signInWithCode(DEMO, CODE)).status).toBe(400);
  });

  it("never signs an Administrator in, whatever the environment names", async () => {
    await testAuth.request(`/api/auth/sign-in/magic-link`, { body: { email: "admin.demo@jobbbox.ai", callbackURL: "/" } });

    const refused = await signInWithCode("admin.demo@jobbbox.ai", CODE);

    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "REVIEW_SIGN_IN_NOT_ALLOWED" });
    expect(refused.headers.getSetCookie().join()).not.toContain("session_token");
  });

  it("keeps the demo account's second step", async () => {
    await testAuth.stop();
    uses = [];
    testAuth = await startTestAuth({ reviewSignIn: review, recordReviewSignIn: async (use) => void uses.push(use), mustHaveTwoStepVerification: async () => true });
    await askSignInEmail(testAuth, DEMO);

    const signedIn = await signInWithCode(DEMO, CODE);

    const row = await testAuth.database.query(`SELECT "twoStepPending" FROM session WHERE token = $1`, [(await signedIn.json()).token]);
    expect(row.rows[0].twoStepPending).toBe(true);
  });

  it("signs in even when the Back Office Audit cannot be written, and says so without the code", async () => {
    await testAuth.stop();
    testAuth = await startTestAuth({ reviewSignIn: review, recordReviewSignIn: async () => Promise.reject(new Error("audit down")) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await askSignInEmail(testAuth, DEMO);
      expect((await signInWithCode(DEMO, CODE)).status).toBe(200);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[review-sign-in]"), "audit down");
      expect(JSON.stringify(warn.mock.calls)).not.toContain(CODE);
    } finally {
      warn.mockRestore();
    }
  });
});

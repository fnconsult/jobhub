import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createOnboardingArrival, type ArrivalReads, type ArrivingSession } from "./index";

/** The reads of an account with `profiles` Profiles, and another role or not. */
function reads({ profiles = 0, otherRole = false } = {}): ArrivalReads & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async profileCount(candidateId) {
      asked.push(`profiles:${candidateId}`);
      return profiles;
    },
    async hasOtherRole() {
      asked.push("role");
      return otherRole;
    },
  };
}

const unused = { query: () => Promise.reject(new Error("no database here")) };
const session = (postponed = false): ArrivingSession => ({ candidateId: "cand_1", sessionId: "sess_1", postponed });

describe("Leading a new account into the « Entretien d'accueil » (#1050)", () => {
  it("leads a Candidate without any Profile to it", async () => {
    expect(await createOnboardingArrival(unused, reads()).leadsToOnboarding(session())).toBe(true);
  });

  it("never leads an account with at least one Profile, finished or not, archived or not", async () => {
    for (const profiles of [1, 3]) expect(await createOnboardingArrival(unused, reads({ profiles })).leadsToOnboarding(session())).toBe(false);
  });

  it("leaves Human Coaches, Administrators and Associations' accounts alone", async () => {
    expect(await createOnboardingArrival(unused, reads({ otherRole: true })).leadsToOnboarding(session())).toBe(false);
  });

  it("no longer leads a session whose Candidate chose « Plus tard », without reading anything else", async () => {
    const read = reads();
    expect(await createOnboardingArrival(unused, read).leadsToOnboarding(session(true))).toBe(false);
    expect(read.asked).toEqual([]);
  });

  it("asks for the roles only of an account with no Profile", async () => {
    const read = reads({ profiles: 2 });
    await createOnboardingArrival(unused, read).leadsToOnboarding(session());
    expect(read.asked).toEqual(["profiles:cand_1"]);
  });
});

describe.skipIf(!connectionString)("« Plus tard », for the session (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;

  beforeEach(async () => {
    testAuth = await startTestAuth();
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  });

  type Signed = { user: { id: string }; session: { id: string; onboardingPostponed?: boolean } };
  const sessionOf = async (cookie: string) => (await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as Signed;
  const arriving = ({ user, session: signed }: Signed): ArrivingSession => ({ candidateId: user.id, sessionId: signed.id, postponed: signed.onboardingPostponed === true });

  it("starts every session not postponed, and postpones only the session it was chosen in", async () => {
    const arrival = createOnboardingArrival(testAuth.database, reads());
    const first = await signInWithMagicLink(testAuth, "claire.nouvelle@example.fr");
    const second = await signInWithMagicLink(testAuth, "claire.nouvelle@example.fr");
    const signed = await sessionOf(first);
    expect(signed.session.onboardingPostponed).toBe(false);

    await arrival.postpone({ candidateId: signed.user.id, sessionId: signed.session.id });

    expect(await arrival.leadsToOnboarding(arriving(await sessionOf(first)))).toBe(false);
    // Another sign-in, on another device or after signing out, is led to it again.
    expect(await arrival.leadsToOnboarding(arriving(await sessionOf(second)))).toBe(true);
  });

  it("never postpones another Candidate's session", async () => {
    const arrival = createOnboardingArrival(testAuth.database, reads());
    const claire = await sessionOf(await signInWithMagicLink(testAuth, "claire.nouvelle@example.fr"));
    const paul = await sessionOf(await signInWithMagicLink(testAuth, "paul@example.fr"));

    await arrival.postpone({ candidateId: paul.user.id, sessionId: claire.session.id });

    expect((await sessionOf(await signInWithMagicLink(testAuth, "claire.nouvelle@example.fr"))).session.onboardingPostponed).toBe(false);
    const rows = await testAuth.database.query(`SELECT "onboardingPostponed" FROM session WHERE id = $1`, [claire.session.id]);
    expect(rows.rows[0].onboardingPostponed).toBe(false);
  });
});

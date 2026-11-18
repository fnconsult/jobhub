import type { Queryable } from "@/database/pool";

/**
 * Where a new account lands once signed in (#1050): a Candidate without any Profile is led straight into the
 * « Entretien d'accueil », the Onboarding interview on `/profils/nouveau` (ADR-0106), from `/` and from `/compte`,
 * rather than finding an empty page there. « Plus tard », offered as the interview opens, leads to Mon compte and stops
 * that for the rest of the session (the session's `onboardingPostponed`, set here alone): another sign-in, on another
 * device or after signing out, is led there again. An account with a Profile, finished or not, archived or not, never
 * is; nor a Human Coach's, an Administrator's or an Association's, who use Jobbbox for something else. The Acceptance
 * of the CGU is not this module's: the page it leads to asks for it first, on its own screen (ADR-0062).
 */
export interface OnboardingArrival {
  /** Whether this signed-in session is led into the « Entretien d'accueil ». */
  leadsToOnboarding(session: ArrivingSession): Promise<boolean>;
  /** « Plus tard »: this session, the Candidate's own, is no longer led there. */
  postpone(session: { candidateId: string; sessionId: string }): Promise<void>;
}

/** A signed-in session, as its arrival reads it: `postponed`, its `onboardingPostponed`. */
export type ArrivingSession = { candidateId: string; sessionId: string; postponed: boolean };

/** What the arrival reads of the account besides its session. */
export interface ArrivalReads {
  /** How many Profiles the Candidate has: active or archived, finished or « Création à terminer ». */
  profileCount(candidateId: string): Promise<number>;
  /** Whether the account signed in is a Human Coach's, an Administrator's or an Association's. */
  hasOtherRole(): Promise<boolean>;
}

export function createOnboardingArrival(database: Queryable, reads: ArrivalReads): OnboardingArrival {
  return {
    async leadsToOnboarding({ candidateId, postponed }) {
      if (postponed) return false;
      // The roles are read for an account without a Profile only: a Candidate with one never pays for them.
      if ((await reads.profileCount(candidateId)) > 0) return false;
      return !(await reads.hasOtherRole());
    },
    async postpone({ candidateId, sessionId }) {
      await database.query(`UPDATE session SET "onboardingPostponed" = true WHERE id = $1 AND "userId" = $2`, [sessionId, candidateId]);
    },
  };
}

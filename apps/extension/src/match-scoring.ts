/**
 * Scoring a Job Offer from the extension, against one of the signed-in Candidate's Profiles
 * or against a CV (with the Search Criteria read from it, #75). Each Match Score a signed-in
 * Candidate requests uses their Plan Quota, so the last one is kept in the Guest
 * session with the Job Offer and the Profile or CV it belongs to, and shown again rather than
 * computed again until either changes or a new score is asked for (#51). Every
 * analysis page scores one at a time, under one lock, so two pages open on the same
 * Job Offer and CV (one reloading on sign-in, say) compute one Match Score, not two.
 * A Match Score that does not come within SCORE_TIMEOUT_MS, waiting on another page's
 * or on the web app, is given up as "unreachable", so it can be tried again (#66).
 */
import type { JobOffer } from "@jobhub/shared";
import { sameCv, type GuestSession, type GuestSessionContent, type KeptMatchScore } from "./guest-session";
import type { JobbboxApi, ProfileOption, ScoreAgainst } from "./jobbbox-api";

export type ScoreOutcome = Awaited<ReturnType<JobbboxApi["score"]>>;

/** How long a Match Score is waited for, lock and request together, before it is given up. */
export const SCORE_TIMEOUT_MS = 90_000;

export interface MatchScoring {
  /**
   * The Match Score of `jobOffer` against a Profile or a CV: the kept one if it is theirs, unless `rescore`
   * asks for a new one. A CV is scored with the Search Criteria the session read with it.
   */
  score(jobOffer: JobOffer, against: ScoreAgainst, options?: { rescore?: boolean }): Promise<ScoreOutcome>;
}

/** Runs `work` while no other page of the extension runs work under the same lock. */
export type ScoringLock = <T>(work: () => Promise<T>) => Promise<T>;

/** The browser's Web Locks, shared by every page of the extension (its origin). */
export const webLock: ScoringLock = (work) => navigator.locks.request("jobbbox-match-score", work);

export function createMatchScoring({ api, session, lock = webLock }: { api: Pick<JobbboxApi, "score">; session: GuestSession; lock?: ScoringLock }): MatchScoring {
  return {
    score(jobOffer, against, { rescore = false } = {}) {
      let givenUp = false;
      let giveUp!: (outcome: ScoreOutcome) => void;
      const timedOut = new Promise<ScoreOutcome>((resolve) => (giveUp = resolve));
      const timer = setTimeout(() => {
        givenUp = true;
        giveUp({ ok: false, error: "unreachable" });
      }, SCORE_TIMEOUT_MS);
      // The kept Match Score is read under the lock, so a page waiting on another's finds the one it kept.
      // The work settles when the Match Score is given up, so a stalled request lets go of the lock.
      const scored = lock(() => {
        if (givenUp) return timedOut;
        return Promise.race([timedOut, scoreUnderLock()]);
      });
      async function scoreUnderLock(): Promise<ScoreOutcome> {
        const content = await session.read();
        const { matchScore: kept } = content;
        if (!rescore && kept && kept.jobOfferId === jobOffer.id && keptFor(kept, against)) {
          return { ok: true, matchScore: kept.matchScore };
        }
        const outcome = await api.score(jobOffer.id, withSearchCriteria(against, content));
        if (outcome.ok && !givenUp) {
          const scoredFor = "profileId" in against ? { profileId: against.profileId } : { cv: against.cv };
          await session.keepMatchScore({ jobOfferId: jobOffer.id, matchScore: outcome.matchScore, ...scoredFor });
        }
        return outcome;
      }
      return Promise.race([timedOut, scored]).finally(() => clearTimeout(timer));
    },
  };
}

/** Whether the kept Match Score was computed for this Profile, or this CV. */
function keptFor(kept: KeptMatchScore, against: ScoreAgainst): boolean {
  if ("profileId" in against) return "profileId" in kept && kept.profileId === against.profileId;
  return "cv" in kept && sameCv(kept.cv, against.cv);
}

/** A CV goes with the Search Criteria read from it, which the session keeps beside it. */
function withSearchCriteria(against: ScoreAgainst, { cv, searchCriteria }: GuestSessionContent): ScoreAgainst {
  if ("profileId" in against || against.searchCriteria || !searchCriteria || !cv || !sameCv(cv, against.cv)) return against;
  return { cv: against.cv, searchCriteria };
}

/**
 * What the analysis page scores the session's Job Offer against first, given the signed-in Candidate's
 * active Profiles (none for a Guest): the Profile or CV whose Match Score is kept for it, so reopening
 * shows it again; else the Profile last chosen, or the first one. Without Profiles, the CV in the
 * session; null when there is none, and the CV is asked for.
 */
export function firstScoreAgainst(profiles: ProfileOption[], { jobOffer, cv, matchScore: kept, profileId }: GuestSessionContent): ScoreAgainst | null {
  const active = (id: string | undefined) => profiles.some((profile) => profile.id === id);
  if (kept && kept.jobOfferId === jobOffer?.id) {
    if ("cv" in kept && cv && sameCv(kept.cv, cv)) return { cv };
    if ("profileId" in kept && active(kept.profileId)) return { profileId: kept.profileId };
  }
  if (profiles.length === 0) return cv ? { cv } : null;
  return { profileId: active(profileId) ? profileId! : profiles[0]!.id };
}

/**
 * Scoring a CV against a Job Offer from the extension. Each Match Score a signed-in
 * Candidate requests uses their Plan Quota, so the last one is kept in the Guest
 * session with the Job Offer and CV it belongs to, and shown again rather than
 * computed again until either changes or a new score is asked for (#51). Every
 * analysis page scores one at a time, under one lock, so two pages open on the same
 * Job Offer and CV (one reloading on sign-in, say) compute one Match Score, not two.
 */
import type { CvContent, JobOffer } from "@jobhub/shared";
import { sameCv, type GuestSession } from "./guest-session";
import type { JobbboxApi } from "./jobbbox-api";

export type ScoreOutcome = Awaited<ReturnType<JobbboxApi["score"]>>;

export interface MatchScoring {
  /** The Match Score of `cv` against `jobOffer`: the kept one if it is theirs, unless `rescore` asks for a new one. */
  score(jobOffer: JobOffer, cv: CvContent, options?: { rescore?: boolean }): Promise<ScoreOutcome>;
}

/** Runs `work` while no other page of the extension runs work under the same lock. */
export type ScoringLock = <T>(work: () => Promise<T>) => Promise<T>;

/** The browser's Web Locks, shared by every page of the extension (its origin). */
export const webLock: ScoringLock = (work) => navigator.locks.request("jobbbox-match-score", work);

export function createMatchScoring({ api, session, lock = webLock }: { api: Pick<JobbboxApi, "score">; session: GuestSession; lock?: ScoringLock }): MatchScoring {
  return {
    score: (jobOffer, cv, { rescore = false } = {}) =>
      // The kept Match Score is read under the lock, so a page waiting on another's finds the one it kept.
      lock(async () => {
        const { matchScore: kept } = await session.read();
        if (!rescore && kept && kept.jobOfferId === jobOffer.id && sameCv(kept.cv, cv)) {
          return { ok: true, matchScore: kept.matchScore };
        }
        const scored = await api.score(jobOffer.id, cv);
        if (scored.ok) await session.keepMatchScore({ jobOfferId: jobOffer.id, cv, matchScore: scored.matchScore });
        return scored;
      }),
  };
}

/**
 * Scoring a CV against a Job Offer from the extension. Each Match Score a signed-in
 * Candidate requests uses their Plan Quota, so the last one is kept in the Guest
 * session with the Job Offer and CV it belongs to, and shown again rather than
 * computed again until either changes or a new score is asked for (#51).
 */
import type { CvContent, JobOffer } from "@jobhub/shared";
import type { GuestSession } from "./guest-session";
import type { JobbboxApi } from "./jobbbox-api";

export type ScoreOutcome = Awaited<ReturnType<JobbboxApi["score"]>>;

export interface MatchScoring {
  /** The Match Score of `cv` against `jobOffer`: the kept one if it is theirs, unless `rescore` asks for a new one. */
  score(jobOffer: JobOffer, cv: CvContent, options?: { rescore?: boolean }): Promise<ScoreOutcome>;
}

export function createMatchScoring({ api, session }: { api: Pick<JobbboxApi, "score">; session: GuestSession }): MatchScoring {
  return {
    async score(jobOffer, cv, { rescore = false } = {}) {
      const { matchScore: kept } = await session.read();
      if (!rescore && kept && kept.jobOfferId === jobOffer.id && sameCv(kept.cv, cv)) {
        return { ok: true, matchScore: kept.matchScore };
      }
      const scored = await api.score(jobOffer.id, cv);
      if (scored.ok) await session.keepMatchScore({ jobOfferId: jobOffer.id, cv, matchScore: scored.matchScore });
      return scored;
    },
  };
}

/** The CV is kept as read; any change to it (another CV, or the same one read again differently) is another CV. */
function sameCv(a: CvContent, b: CvContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

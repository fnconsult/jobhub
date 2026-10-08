/**
 * Match Scoring: the Match Score of a CV against a stored Job Offer.
 *
 * `createMatchScoring({ jobOffers, profiles })` gives one `score(candidateId,
 * input)`. `input` is untrusted (it comes from the browser) and names the Job
 * Offer plus the CV to score, either:
 *  - `{ jobOfferId, profileId }` — a signed-in Candidate's Master CV, with its
 *    Profile's Search Criteria; or
 *  - `{ jobOfferId, cv, searchCriteria? }` — a CV sent with the request: a
 *    Guest's CV (no account needed) or a Tailored CV.
 * A CV sent with the request is scored and forgotten, never stored (ADR-0003).
 * Each Match Score a signed-in Candidate gets counts against their Plan Quota
 * (`matchScoreQuota`, asked once the request names a Job Offer and a CV it can
 * score, before scoring); a Guest's are not counted (ADR-0014).
 * Problems come back as results, never exceptions.
 */
import { scoreMatch, type MatchScore } from "@jobhub/shared";
import * as z from "zod";
import type { QuotaDecision } from "../billing";
import type { QuotaRefusal } from "../billing/upgrade-prompt";
import type { JobOffers } from "../job-offers";
import { cvContentSchema, searchCriteriaSchema, type Profiles } from "../profiles";
import { fieldErrors, type FieldError } from "../validation";

export type MatchScoreResult =
  | { ok: true; matchScore: MatchScore }
  | { ok: false; error: "invalid"; errors: FieldError[] }
  /** The Profile needs a signed-in Candidate. */
  | { ok: false; error: "unauthorized" }
  /** No such Job Offer, or no such Profile for this Candidate. */
  | { ok: false; error: "not_found" }
  /** The Candidate's Plan Quota allows no more Match Scores this month. */
  | { ok: false; error: "quota_exceeded"; refusal: QuotaRefusal };

/**
 * Records one Match Score for the Candidate if their Plan allows it (billing's
 * `use(candidateId, "matchScores")`). Without one, nothing is counted.
 */
export type MatchScoreQuota = (candidateId: string) => Promise<QuotaDecision>;

export interface MatchScoring {
  /** `candidateId` is the signed-in Candidate, or null for a Guest. */
  score(candidateId: string | null, input: unknown): Promise<MatchScoreResult>;
}

const jobOfferId = z.string().trim().min(1);
const profileRequest = z.object({ jobOfferId, profileId: z.string().trim().min(1) });
const cvRequest = z.object({ jobOfferId, cv: cvContentSchema, searchCriteria: searchCriteriaSchema.optional() });

/** Told apart by `profileId`, so field errors name the fields of the request the caller meant. */
const parse = (input: unknown) =>
  typeof input === "object" && input !== null && "profileId" in input
    ? profileRequest.safeParse(input, { reportInput: true })
    : cvRequest.safeParse(input, { reportInput: true });

export function createMatchScoring({
  jobOffers,
  profiles,
  matchScoreQuota = async () => ({ allowed: true, remaining: null }),
}: {
  jobOffers: JobOffers;
  profiles: Profiles;
  matchScoreQuota?: MatchScoreQuota;
}): MatchScoring {
  /** Null when the Match Score may go ahead; a Guest's always may. */
  async function refused(candidateId: string | null): Promise<MatchScoreResult | null> {
    if (!candidateId) return null;
    const decision = await matchScoreQuota(candidateId);
    return decision.allowed ? null : { ok: false, error: "quota_exceeded", refusal: decision };
  }

  return {
    async score(candidateId, input) {
      const parsed = parse(input);
      if (!parsed.success) return { ok: false, error: "invalid", errors: fieldErrors(parsed.error) };
      const request = parsed.data;

      const jobOffer = await jobOffers.get(request.jobOfferId);
      if (!jobOffer) return { ok: false, error: "not_found" };

      if ("profileId" in request) {
        if (!candidateId) return { ok: false, error: "unauthorized" };
        const profile = await profiles.get(candidateId, request.profileId);
        if (!profile) return { ok: false, error: "not_found" };
        const refusal = await refused(candidateId);
        if (refusal) return refusal;
        return { ok: true, matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }) };
      }
      const refusal = await refused(candidateId);
      if (refusal) return refusal;
      return { ok: true, matchScore: scoreMatch({ cv: request.cv, searchCriteria: request.searchCriteria, jobOffer }) };
    },
  };
}

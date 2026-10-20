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
 *
 * A Match Score comes in up to two phases, and counts once whatever the phases:
 *  1. `scoreMatch` on what the Job Offer states in structured form. A reliable
 *     score of `ENOUGH_FROM_STRUCTURED_DATA` or more is the result.
 *  2. Otherwise, when the Job Offer lacks a detail a criterion needs (e.g. a
 *     Capture without JobPosting data has only a title and its text), an AI
 *     reads the Job Offer's text for it (`readOfferText`: the offer only, never
 *     the CV, so no identity). What it finds is kept on the Job Offer, once per
 *     Job Offer, and the CV is scored again by the same rules, so the score
 *     keeps its explained breakdown. If the AI fails or is too slow, the result
 *     is the phase 1 score, flagged `offerTextUnread`.
 */
import { matchScoreReliability, scoreMatch, type JobOffer, type MatchInput, type MatchScore } from "@jobhub/shared";
import * as z from "zod";
import type { QuotaDecision } from "../billing";
import type { QuotaRefusal } from "../billing/upgrade-prompt";
import type { FieldsFromText, JobOffers } from "../job-offers";
import { cvContentSchema, searchCriteriaSchema, type Profiles } from "../profiles";
import { fieldErrors, type FieldError } from "../validation";

export type MatchScoreResult =
  | { ok: true; matchScore: MatchScore }
  | { ok: false; error: "invalid"; errors: FieldError[] }
  /** The Profile needs a signed-in Candidate. */
  | { ok: false; error: "unauthorized" }
  /** No such Job Offer, or no such Profile for this Candidate. */
  | { ok: false; error: "not_found" }
  /** The Candidate's Plan Quota allows no more Match Scores this week. */
  | { ok: false; error: "quota_exceeded"; refusal: QuotaRefusal };

/**
 * Records one Match Score for the Candidate if their Plan allows it (billing's
 * `use(candidateId, "matchScores")`). Without one, nothing is counted.
 */
export type MatchScoreQuota = (candidateId: string) => Promise<QuotaDecision>;

/**
 * What an AI reads in a Job Offer's text (its title and text, never a CV): the `offer_analysis`
 * task. Throws when it cannot read it.
 */
export type OfferTextReader = (jobOffer: JobOffer, candidateId: string | null) => Promise<FieldsFromText>;

/** A reliable phase 1 Match Score this high needs no AI reading of the Job Offer's text. */
export const ENOUGH_FROM_STRUCTURED_DATA = 70;

/** How long a Match Score waits for the AI reading; it is still kept when it finishes later. */
const DEFAULT_TEXT_READ_TIMEOUT_MS = 20_000;

/** Whether the Job Offer's text could make a criterion known: the offer lacks what the CV or Search Criteria have. */
function offerLacksADetail({ breakdown }: MatchScore): boolean {
  return (
    breakdown.skills.status === "unknown" ||
    (breakdown.seniority.requiredYears === undefined && breakdown.seniority.cvYears !== undefined) ||
    (breakdown.location.offer === undefined && breakdown.location.wanted !== undefined) ||
    (breakdown.salary.offer === undefined && breakdown.salary.wanted !== undefined) ||
    (breakdown.contractType.offer === undefined && breakdown.contractType.wanted !== undefined)
  );
}

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
  readOfferText,
  textReadTimeoutMs = DEFAULT_TEXT_READ_TIMEOUT_MS,
  warn = (message, details) => console.warn(`[match-score] ${message}`, details),
}: {
  jobOffers: JobOffers;
  profiles: Profiles;
  matchScoreQuota?: MatchScoreQuota;
  /** The phase 2 AI reading. Without it, a Match Score is phase 1 only. */
  readOfferText?: OfferTextReader;
  textReadTimeoutMs?: number;
  warn?: (message: string, details: Record<string, unknown>) => void;
}): MatchScoring {
  /** One reading per Job Offer at a time: a second Match Score waits for the first one's. */
  const reading = new Map<string, Promise<JobOffer | null>>();

  /** The Job Offer with the fields its text gave (now or before), or null when the AI could not read it in time. */
  function filledFromText(jobOffer: JobOffer, candidateId: string | null, read: OfferTextReader): Promise<JobOffer | null> {
    let filling = reading.get(jobOffer.id);
    if (!filling) {
      filling = jobOffers
        .fillFromText(jobOffer.id, (stored) => read(stored, candidateId))
        .catch((error: unknown) => {
          warn("Job Offer text unread: Match Score from its structured data only", {
            jobOfferId: jobOffer.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
        .finally(() => reading.delete(jobOffer.id));
      reading.set(jobOffer.id, filling);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        warn("Job Offer text reading too slow: Match Score from its structured data only", { jobOfferId: jobOffer.id });
        resolve(null);
      }, textReadTimeoutMs);
    });
    return Promise.race([filling, timeout]).finally(() => clearTimeout(timer));
  }

  async function twoPhaseScore(candidateId: string | null, input: Omit<MatchInput, "jobOffer">, jobOffer: JobOffer): Promise<MatchScore> {
    const first = scoreMatch({ ...input, jobOffer });
    const enough = first.score >= ENOUGH_FROM_STRUCTURED_DATA && matchScoreReliability(first) === "reliable";
    if (!readOfferText || enough || !offerLacksADetail(first)) return first;
    const filled = await filledFromText(jobOffer, candidateId, readOfferText);
    return filled ? scoreMatch({ ...input, jobOffer: filled }) : { ...first, offerTextUnread: true };
  }

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
        return { ok: true, matchScore: await twoPhaseScore(candidateId, { cv: profile.masterCv.content, searchCriteria: profile.searchCriteria }, jobOffer) };
      }
      const refusal = await refused(candidateId);
      if (refusal) return refusal;
      return { ok: true, matchScore: await twoPhaseScore(candidateId, { cv: request.cv, searchCriteria: request.searchCriteria }, jobOffer) };
    },
  };
}

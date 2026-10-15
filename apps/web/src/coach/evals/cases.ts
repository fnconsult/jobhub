/**
 * The Coach eval set: fictional Candidates (no real person), what they say to the AI Coach,
 * and what a good reply does. The AI judge reads `expected` alongside the playbooks.
 */
import type { ApplicationStatus, JobOfferDetails } from "@jobhub/shared";
import type { CoachMessage } from "../index";

export interface CoachEvalCase {
  id: string;
  /** Where the case comes from when it was ported, e.g. "devarq search-relevance-v1#dsi-aligned". */
  origin?: string;
  /** The fictional Candidate: one active Profile and its Master CV. */
  candidate: {
    firstName: string;
    targetRole: string;
    location?: string;
    summary?: string;
    experience: { title: string; employer: string; period: string; description?: string }[];
    skills: string[];
  };
  /** What the Candidate has In view. None: no page in particular. */
  inView?:
    | { kind: "profile" }
    | { kind: "job_offer"; jobOffer: JobOfferDetails }
    | { kind: "application"; jobOffer: JobOfferDetails; status: ApplicationStatus };
  /** The conversation so far, the Candidate's message last. */
  messages: CoachMessage[];
  /** What a good reply does, in plain words, for the judge. */
  expected: string;
}

/** The version of the eval set, recorded with each run. Bump it when a case changes. */
export const COACH_EVAL_SET_VERSION = "coach-v1";

export const COACH_EVAL_CASES: CoachEvalCase[] = [];

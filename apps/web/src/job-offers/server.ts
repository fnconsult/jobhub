import { readOfferFields, type TaskInstructions } from "@jobhub/ai";
import type { JobOffer } from "@jobhub/shared";
import { getAi } from "@/ai/server";
import { sharedPool } from "@/database/pool";
import { withApplicationTitles } from "@/applications";
import { createJobOffers, type JobOffers } from "./index";
import { recordedReading } from "./summary-reading";

let instance: JobOffers | undefined;
let asCandidatesRead: JobOffers | undefined;

/** The app's Job Offers module, on the database named by DATABASE_URL, each Job Offer under its own title. */
export function getSharedJobOffers(): JobOffers {
  instance ??= createJobOffers(sharedPool());
  return instance;
}

/**
 * The app's Job Offers module as each Candidate reads it (#1130, ADR-0117): read for a Candidate, a Job Offer they renamed
 * their Application on comes under their title.
 */
export function getJobOffers(): JobOffers {
  asCandidatesRead ??= withApplicationTitles(getSharedJobOffers(), sharedPool());
  return asCandidatesRead;
}

/**
 * The Job Offer with its Job Offer Summary, read once from its text (title and text only, no CV, no
 * identity) as the `offer_analysis` task, logged as the Candidate's AI usage; the fields it lacks come
 * with it. `reading`: the served "job-offer-reading" task Playbook (ADR-0026), whose rules and Playbook
 * Agent write the summary and sector. Kept with that reading's Provenance. Throws what the AI layer throws.
 */
export function summarizeJobOffer(jobOfferId: string, candidateId: string, reading: TaskInstructions): Promise<JobOffer | null> {
  return getSharedJobOffers().summarize(jobOfferId, (jobOffer) => recordedReading(getAi(), jobOffer, (ai) => readOfferFields(ai, { candidateId, jobOffer, reading })));
}

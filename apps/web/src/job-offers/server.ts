import { readOfferFields, type TaskInstructions } from "@jobhub/ai";
import type { JobOffer } from "@jobhub/shared";
import { getAi } from "@/ai/server";
import { sharedPool } from "@/database/pool";
import { createJobOffers, type JobOffers } from "./index";
import { recordedReading } from "./summary-reading";

let instance: JobOffers | undefined;

/** The app's Job Offers module, on the database named by DATABASE_URL. */
export function getJobOffers(): JobOffers {
  instance ??= createJobOffers(sharedPool());
  return instance;
}

/**
 * The Job Offer with its Job Offer Summary, read once from its text (title and text only, no CV, no
 * identity) as the `offer_analysis` task, logged as the Candidate's AI usage; the fields it lacks come
 * with it. `reading`: the served "job-offer-reading" task Playbook (ADR-0026), whose rules and Playbook
 * Agent write the summary and sector. Kept with that reading's Provenance. Throws what the AI layer throws.
 */
export function summarizeJobOffer(jobOfferId: string, candidateId: string, reading: TaskInstructions): Promise<JobOffer | null> {
  return getJobOffers().summarize(jobOfferId, (jobOffer) => recordedReading(getAi(), jobOffer, (ai) => readOfferFields(ai, { candidateId, jobOffer, reading })));
}

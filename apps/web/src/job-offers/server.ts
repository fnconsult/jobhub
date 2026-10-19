import { readOfferFields } from "@jobhub/ai";
import type { JobOffer } from "@jobhub/shared";
import { getAi } from "@/ai/server";
import { sharedPool } from "@/database/pool";
import { createJobOffers, type JobOffers } from "./index";

let instance: JobOffers | undefined;

/** The app's Job Offers module, on the database named by DATABASE_URL. */
export function getJobOffers(): JobOffers {
  instance ??= createJobOffers(sharedPool());
  return instance;
}

/**
 * The Job Offer with its Job Offer Summary, read once from its text (title and text only, no CV, no
 * identity) as the `offer_analysis` task, logged as the Candidate's AI usage; the fields it lacks come
 * with it. Throws what the AI layer throws.
 */
export function summarizeJobOffer(jobOfferId: string, candidateId: string): Promise<JobOffer | null> {
  return getJobOffers().summarize(jobOfferId, (jobOffer) => readOfferFields(getAi(), { candidateId, jobOffer }));
}

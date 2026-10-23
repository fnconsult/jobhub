import { getJobOffers } from "@/job-offers/server";
import { getJobSearches } from "@/job-searches/server";
import { jobOfferPage, jobSearchPage, type ActivityElement } from "./index";

/** `/offres/[id]`'s elements for AI Activity, read from the app's Job Offers. */
export function loadJobOfferPage(id: string): Promise<ActivityElement[]> {
  return jobOfferPage(getJobOffers(), id);
}

/** `/recherches/[id]`'s elements for AI Activity, the Candidate's Job Search and the Job Offers it found. */
export function loadJobSearchPage(candidateId: string, id: string): Promise<ActivityElement[]> {
  return jobSearchPage(getJobSearches(), getJobOffers(), candidateId, id);
}

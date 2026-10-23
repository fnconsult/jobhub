import { getJobOffers } from "@/job-offers/server";
import { jobOfferPage, type ActivityElement } from "./index";

/** `/offres/[id]`'s elements for AI Activity, read from the app's Job Offers. */
export function loadJobOfferPage(id: string): Promise<ActivityElement[]> {
  return jobOfferPage(getJobOffers(), id);
}

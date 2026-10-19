import { readOfferFields } from "@jobhub/ai";
import { getAi } from "../ai/server";
import { getBilling } from "../billing/server";
import { getJobOffers } from "../job-offers/server";
import { getProfiles } from "../profiles/server";
import { createMatchScoring, type MatchScoring } from "./index";

let instance: MatchScoring | undefined;

/**
 * The app's Match Scoring module, on the app's Job Offers and Profiles, counting Match Scores against Plan Quotas.
 * Its phase 2 reads a Job Offer's text (title and text only, no CV, no identity) as the `offer_analysis` task.
 */
export function getMatchScoring(): MatchScoring {
  instance ??= createMatchScoring({
    jobOffers: getJobOffers(),
    profiles: getProfiles(),
    matchScoreQuota: (candidateId) => getBilling().use(candidateId, "matchScores"),
    readOfferText: (jobOffer, candidateId) => readOfferFields(getAi(), { candidateId, jobOffer }),
  });
  return instance;
}

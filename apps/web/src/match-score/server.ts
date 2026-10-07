import { getJobOffers } from "../job-offers/server";
import { getProfiles } from "../profiles/server";
import { createMatchScoring, type MatchScoring } from "./index";

let instance: MatchScoring | undefined;

/** The app's Match Scoring module, on the app's Job Offers and Profiles. */
export function getMatchScoring(): MatchScoring {
  instance ??= createMatchScoring({ jobOffers: getJobOffers(), profiles: getProfiles() });
  return instance;
}

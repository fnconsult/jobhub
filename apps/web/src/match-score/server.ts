import { readOfferFields } from "@jobhub/ai";
import { getAi } from "../ai/server";
import { getBilling } from "../billing/server";
import { getJobOffers } from "../job-offers/server";
import { getProfiles } from "../profiles/server";
import { servedTaskRun } from "../task-playbooks";
import { getTaskPlaybooks } from "../task-playbooks/server";
import { createMatchScoring, type MatchScoring } from "./index";

let instance: MatchScoring | undefined;

/**
 * The app's Match Scoring module, on the app's Job Offers and Profiles, counting Match Scores against Plan Quotas.
 * Its phase 2 reads a Job Offer's text (title and text only, no CV, no identity) as the `offer_analysis` task,
 * with its Job Offer Summary and sector only while the "job-offer-reading" task Playbook is served (ADR-0026).
 */
export function getMatchScoring(): MatchScoring {
  instance ??= createMatchScoring({
    jobOffers: getJobOffers(),
    profiles: getProfiles(),
    matchScoreQuota: (candidateId) => getBilling().use(candidateId, "matchScores"),
    readOfferText: async (jobOffer, candidateId, call) => {
      const reading = await servedTaskRun(getTaskPlaybooks(), "job-offer-reading", getAi());
      return readOfferFields(getAi(), { candidateId, jobOffer, reading: reading?.instructions() ?? null, ...call });
    },
  });
  return instance;
}

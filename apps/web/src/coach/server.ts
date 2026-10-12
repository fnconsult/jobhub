import { getAi } from "@/ai/server";
import { getApplications } from "@/applications/server";
import { getJobDigests } from "@/job-digests/server";
import { getJobOffers } from "@/job-offers/server";
import { getJobSearches } from "@/job-searches/server";
import { getProfiles } from "@/profiles/server";
import { createCoach, type Coach } from "./index";

let instance: Coach | undefined;

/** The app's AI Coach, on the app's AI layer, reading the Candidate's workspace. No Coach Memory yet (#125). */
export function getCoach(): Coach {
  instance ??= (() => {
    const jobDigests = getJobDigests();
    return createCoach({
      ai: getAi(),
      profiles: getProfiles(),
      applications: getApplications(),
      jobOffers: getJobOffers(),
      jobSearches: getJobSearches(),
      jobDigests: {
        get: (candidateId, jobDigestId) => jobDigests.get(candidateId, jobDigestId),
        async latest(candidateId, profileId) {
          const latest = (await jobDigests.settings(candidateId, profileId))?.digests[0];
          return latest ? jobDigests.get(candidateId, latest.id) : null;
        },
      },
    });
  })();
  return instance;
}

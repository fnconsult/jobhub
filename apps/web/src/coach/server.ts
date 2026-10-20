import { getAi } from "@/ai/server";
import { getApplications } from "@/applications/server";
import { getCoachMemory } from "@/coach-memory/server";
import { getCoachingPlaybooks } from "@/coaching-playbooks/server";
import { getGuardrails } from "@/guardrails/server";
import { getJobDigests } from "@/job-digests/server";
import { getJobOffers } from "@/job-offers/server";
import { getJobSearches } from "@/job-searches/server";
import { getProfiles } from "@/profiles/server";
import { createCoach, type Coach } from "./index";

let instance: Coach | undefined;

/**
 * The app's AI Coach, on the app's AI layer, reading the Candidate's workspace and Coach Memory (#125),
 * drawing on the Core Digest and the Playbook Agents served in this environment (ADR-0021), behind its Guardrails (ADR-0022).
 */
export function getCoach(): Coach {
  instance ??= (() => {
    const jobDigests = getJobDigests();
    return createCoach({
      ai: getAi(),
      playbooks: getCoachingPlaybooks(),
      guardrails: getGuardrails(),
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
      // Coach Memory needs Coach Conversations, which need the AI Coach: resolved on first use, not at construction.
      coachMemory: {
        async items(candidateId) {
          const items = await getCoachMemory().list(candidateId);
          return items.map((item) => `${item.kind === "goal" ? "Objectif" : item.kind === "constraint" ? "Contrainte" : "Décision"} : ${item.text}`);
        },
      },
    });
  })();
  return instance;
}

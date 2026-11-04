import { getAgenda } from "@/agenda/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { getApplications } from "@/applications/server";
import { getJobDigests } from "@/job-digests/server";
import { getJobSearches } from "@/job-searches/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getProfiles } from "@/profiles/server";
import { readIndustryReference } from "@/reference-data/server";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { candidateObjects } from "./candidate-objects";
import { shippedCoachActions } from "./catalog";
import { e2eCoachActions } from "./e2e-catalog";
import { createCoachActions, type CoachAction, type CoachActions } from "./index";
import { coachActionsSettings } from "./settings";

let instance: CoachActions | undefined;
let catalog: readonly CoachAction[] | undefined;

/** The catalogue shipped, over the Candidate's objects through the domain modules the pages' routes use (#714). */
function shipped(): readonly CoachAction[] {
  return shippedCoachActions(
    candidateObjects({
      profiles: getProfiles(),
      applications: getApplications(),
      jobSearches: getJobSearches(),
      jobDigests: getJobDigests(),
      agenda: {
        async upcoming(candidateId, now) {
          const days = await getAgenda().days(candidateId, { period: "upcoming", now });
          return days.flatMap((day) => day.items);
        },
      },
      tailoredDocuments: getTailoredDocuments(),
      tailoredCvs: getTailoredCvs(),
      industries: readIndustryReference,
    }),
  );
}

/**
 * The Coach Actions this app offers and applies (#713, #715): the catalogue shipped, and on an e2e spec's own server only
 * (JOBHUB_TARGET=e2e and E2E_FAKE_COACH_ACTIONS=1) the suite's fake one, which proposes an Application Status.
 */
export function coachActionsInUse(env: NodeJS.ProcessEnv = process.env): readonly CoachAction[] {
  const fake = env.JOBHUB_TARGET?.trim() === "e2e" && env.E2E_FAKE_COACH_ACTIONS?.trim() === "1";
  catalog ??= fake ? [...shipped(), ...e2eCoachActions(getApplications())] : shipped();
  return catalog;
}

/** The app's Coach Actions (#713): the catalogue in use, switched on and bounded by Paramètres, each call in external_api_usage. */
export function getCoachActions(): CoachActions {
  instance ??= createCoachActions({
    catalog: coachActionsInUse(),
    settings: async () => coachActionsSettings(getPlatformSettingsResolver().current()),
    externalApis: getExternalApiLog(),
  });
  return instance;
}

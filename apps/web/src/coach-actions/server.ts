import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { COACH_ACTIONS } from "./catalog";
import { createCoachActions, type CoachActions } from "./index";
import { coachActionsSettings } from "./settings";

let instance: CoachActions | undefined;

/** The app's Coach Actions (#713): the catalogue shipped, switched on and bounded by Paramètres, each call in external_api_usage. */
export function getCoachActions(): CoachActions {
  instance ??= createCoachActions({
    catalog: COACH_ACTIONS,
    settings: async () => coachActionsSettings(getPlatformSettingsResolver().current()),
    externalApis: getExternalApiLog(),
  });
  return instance;
}

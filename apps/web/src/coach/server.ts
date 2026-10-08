import { getAi } from "@/ai/server";
import { getProfiles } from "@/profiles/server";
import { createCoach, type Coach } from "./index";

let instance: Coach | undefined;

/** The app's AI Coach, on the app's AI layer and Profiles. */
export function getCoach(): Coach {
  instance ??= createCoach({ ai: getAi(), profiles: getProfiles() });
  return instance;
}

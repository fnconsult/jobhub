import { sharedPool } from "@/database/pool";
import { getCoach } from "@/coach/server";
import { getProfiles } from "@/profiles/server";
import { coachCostPerDay, createCoachConversations, type CoachConversations, type CoachCostDay } from "./index";

let instance: CoachConversations | undefined;

/** The app's Coach Conversations, on the database named by DATABASE_URL and the app's AI Coach. */
export function getCoachConversations(): CoachConversations {
  instance ??= createCoachConversations(sharedPool(), { coach: getCoach(), profiles: getProfiles() });
  return instance;
}

/** The AI Coach's cost per day over the last `days` days, newest first (the back office's view). */
export function coachCostOfLastDays(days: number): Promise<CoachCostDay[]> {
  return coachCostPerDay(sharedPool(), new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

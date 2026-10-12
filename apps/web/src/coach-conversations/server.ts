import { sharedPool } from "@/database/pool";
import { getCoach } from "@/coach/server";
import { getProfiles } from "@/profiles/server";
import { createCoachConversations, type CoachConversations } from "./index";

let instance: CoachConversations | undefined;

/** The app's Coach Conversations, on the database named by DATABASE_URL and the app's AI Coach. */
export function getCoachConversations(): CoachConversations {
  instance ??= createCoachConversations(sharedPool(), { coach: getCoach(), profiles: getProfiles() });
  return instance;
}

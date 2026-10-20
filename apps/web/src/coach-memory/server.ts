import { getAi } from "@/ai/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { sharedPool } from "@/database/pool";
import { getTaskPlaybooks } from "@/task-playbooks/server";
import { createCoachMemory, type CoachMemory } from "./index";

let instance: CoachMemory | undefined;

/** The app's Coach Memory, on the database named by DATABASE_URL, the app's AI layer and Coach Conversations. */
export function getCoachMemory(): CoachMemory {
  instance ??= createCoachMemory(sharedPool(), { ai: getAi(), conversations: getCoachConversations(), taskPlaybooks: getTaskPlaybooks() });
  return instance;
}

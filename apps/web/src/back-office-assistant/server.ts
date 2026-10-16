import { getBackOffice, getAdministrators } from "@/admin/server";
import { getAi } from "@/ai/server";
import { getBilling } from "@/billing/server";
import { coachCostOfLastDays } from "@/coach-conversations/server";
import { sharedPool } from "@/database/pool";
import { getHumanCoaches } from "@/human-coaches/server";
import { createAssistantConversations, type AssistantConversations } from "./conversations";
import { createBackOfficeAssistant } from "./index";

let instance: AssistantConversations | undefined;

/** The app's Back Office Assistant and its conversations, on the app's AI layer and the Back Office's data. */
export function getAssistantConversations(): AssistantConversations {
  instance ??= createAssistantConversations(sharedPool(), {
    assistant: createBackOfficeAssistant({
      ai: getAi(),
      sources: {
        planQuotas: () => getBilling().planQuotas(),
        humanCoaches: () => getHumanCoaches().list(),
        coachCost: (days) => coachCostOfLastDays(days),
        administrators: () => getAdministrators().list(),
        journal: (limit) => getBackOffice().journal({ limit }),
      },
    }),
  });
  return instance;
}

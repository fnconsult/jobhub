import { sharedPool } from "@/database/pool";
import { getCoachConversations } from "@/coach-conversations/server";
import { sessionReports } from "./reports";
export const getSessionReports = () => sessionReports(sharedPool(), getCoachConversations());

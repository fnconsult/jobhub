import { sharedPool } from "@/database/pool";
import { getHumanCoaches } from "@/human-coaches/server";
import { coachWorkspace } from "./workspace";
export const getCoachWorkspace = () => coachWorkspace(sharedPool(), getHumanCoaches());

import { getActionCards } from "@/action-cards/server";
import { coachActionsInUse } from "@/coach-actions/server";
import { createCoachProposals, type CoachProposals } from "./index";

let instance: CoachProposals | undefined;

/** The app's Coach proposals in the thread (#715): the Coach Actions in use, their cards among the app's Action Cards. */
export function getCoachProposals(): CoachProposals {
  instance ??= createCoachProposals({ catalog: coachActionsInUse(), actionCards: getActionCards() });
  return instance;
}

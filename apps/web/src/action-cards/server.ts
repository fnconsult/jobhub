import { sharedPool } from "@/database/pool";
import { ATS_FIX_CARD } from "../ats-score";
import { getAtsScoring } from "../ats-score/server";
import { coachActionsInUse } from "../coach-actions/server";
import { COACH_PROPOSAL_CARD, coachProposalHandlers } from "../coach-proposals";
import { ABANDON_CARD, FOLLOW_UP_CARD } from "../follow-ups";
import { getFollowUps } from "../follow-ups/server";
import { createActionCards, type ActionCards } from "./index";

let instance: ActionCards | undefined;

/**
 * The app's Action Cards, on the database named by DATABASE_URL. Each kind of
 * card registers what accepting it applies here, as the kinds arrive (ATS
 * Fixes, Follow-ups…); a kind without a handler only records the decision.
 * ATS Scoring and Follow-ups are reached lazily: they propose cards here too. A Coach proposal in the thread (#715) is
 * applied and put back (« Annuler ») by the Coach Action that prepared it.
 */
export function getActionCards(): ActionCards {
  if (instance) return instance;
  const proposals = coachProposalHandlers(coachActionsInUse());
  instance = createActionCards(sharedPool(), {
    onUndo: proposals.onUndo,
    onAccept: {
      [COACH_PROPOSAL_CARD]: proposals.onAccept[COACH_PROPOSAL_CARD]!,
      [ATS_FIX_CARD]: (card, candidateId) => getAtsScoring().acceptFix(card, candidateId),
      // Marking a Follow-up as sent moves the Application to "Relancée"; accepting the suggestion, to "Abandonnée".
      [FOLLOW_UP_CARD]: (card, candidateId) => getFollowUps().onAccept[FOLLOW_UP_CARD]!(card, candidateId),
      [ABANDON_CARD]: (card, candidateId) => getFollowUps().onAccept[ABANDON_CARD]!(card, candidateId),
    },
  });
  return instance;
}

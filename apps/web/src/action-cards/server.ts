import { Pool } from "pg";
import { ATS_FIX_CARD } from "../ats-score";
import { getAtsScoring } from "../ats-score/server";
import { ABANDON_CARD, FOLLOW_UP_CARD } from "../follow-ups";
import { getFollowUps } from "../follow-ups/server";
import { createActionCards, type ActionCards } from "./index";

let instance: ActionCards | undefined;

/**
 * The app's Action Cards, on the database named by DATABASE_URL. Each kind of
 * card registers what accepting it applies here, as the kinds arrive (ATS
 * Fixes, Follow-ups…); a kind without a handler only records the decision.
 * ATS Scoring and Follow-ups are reached lazily: they propose cards here too.
 */
export function getActionCards(): ActionCards {
  instance ??= createActionCards(new Pool({ connectionString: process.env.DATABASE_URL }), {
    onAccept: {
      [ATS_FIX_CARD]: (card, candidateId) => getAtsScoring().acceptFix(card, candidateId),
      // Marking a Follow-up as sent moves the Application to "Relancée"; accepting the suggestion, to "Abandonnée".
      [FOLLOW_UP_CARD]: (card, candidateId) => getFollowUps().onAccept[FOLLOW_UP_CARD]!(card, candidateId),
      [ABANDON_CARD]: (card, candidateId) => getFollowUps().onAccept[ABANDON_CARD]!(card, candidateId),
    },
  });
  return instance;
}

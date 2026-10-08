import { Pool } from "pg";
import { ATS_FIX_CARD } from "../ats-score";
import { getAtsScoring } from "../ats-score/server";
import { createActionCards, type ActionCards } from "./index";

let instance: ActionCards | undefined;

/**
 * The app's Action Cards, on the database named by DATABASE_URL. Each kind of
 * card registers what accepting it applies here, as the kinds arrive (ATS
 * Fixes, Follow-ups…); a kind without a handler only records the decision.
 * ATS Scoring is reached lazily: it proposes cards here too.
 */
export function getActionCards(): ActionCards {
  instance ??= createActionCards(new Pool({ connectionString: process.env.DATABASE_URL }), {
    onAccept: { [ATS_FIX_CARD]: (card, candidateId) => getAtsScoring().acceptFix(card, candidateId) },
  });
  return instance;
}

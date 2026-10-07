import { Pool } from "pg";
import { createActionCards, type ActionCards } from "./index";

let instance: ActionCards | undefined;

/**
 * The app's Action Cards, on the database named by DATABASE_URL. Each kind of
 * card registers what accepting it applies here, as the kinds arrive (ATS
 * Fixes, Follow-ups…); a kind without a handler only records the decision.
 */
export function getActionCards(): ActionCards {
  instance ??= createActionCards(new Pool({ connectionString: process.env.DATABASE_URL }), { onAccept: {} });
  return instance;
}

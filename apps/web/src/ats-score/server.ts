import { Pool } from "pg";
import { getActionCards } from "../action-cards/server";
import { getBilling } from "../billing/server";
import { getProfiles } from "../profiles/server";
import { createAtsScoring, type AtsScoring } from "./index";

let instance: AtsScoring | undefined;

/** The app's ATS Scoring, on the app's Profiles and Action Cards, counting ATS Scores against Plan Quotas. */
export function getAtsScoring(): AtsScoring {
  instance ??= createAtsScoring({
    database: new Pool({ connectionString: process.env.DATABASE_URL }),
    profiles: getProfiles(),
    actionCards: getActionCards(),
    atsScoreQuota: (candidateId) => getBilling().use(candidateId, "atsScores"),
  });
  return instance;
}

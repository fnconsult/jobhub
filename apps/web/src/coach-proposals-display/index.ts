/**
 * Propositions du coach (setting) (#717, ADR-0077), kept with the Candidate's account: « Carte » (default) or
 * « Formulaire » (./choice). One small module in front of Postgres:
 *  - `of` the Candidate's choice, « Carte » until they make one;
 *  - `choose` it, from Mon compte's Préférences;
 *  - `coachProposalsDisplayOf`, what the Data export holds of it (the value and since when).
 * Its table is the Candidate's: deleted with their account.
 */
import type { Pool } from "pg";
import { DEFAULT_COACH_PROPOSALS_DISPLAY, readCoachProposalsDisplay, type CoachProposalsDisplay } from "./choice";

export { COACH_PROPOSALS_DISPLAYS, DEFAULT_COACH_PROPOSALS_DISPLAY, formOpenedOnArrival, readCoachProposalsDisplay, type CoachProposalsDisplay } from "./choice";

export interface CoachProposalsDisplays {
  of(candidateId: string): Promise<CoachProposalsDisplay>;
  choose(candidateId: string, display: CoachProposalsDisplay): Promise<CoachProposalsDisplay>;
}

/** What the Data export holds of the setting: the value, and when the Candidate chose it (null: never, the default). */
export interface ExportedCoachProposalsDisplay {
  display: CoachProposalsDisplay;
  chosenAt: Date | null;
}

export function createCoachProposalsDisplays(database: Pick<Pool, "query">, deps: { now?: () => Date } = {}): CoachProposalsDisplays {
  const now = deps.now ?? (() => new Date());
  return {
    async of(candidateId) {
      return (await coachProposalsDisplayOf(database, candidateId)).display;
    },
    async choose(candidateId, display) {
      await database.query(
        `INSERT INTO coach_proposals_display (candidate_id, display, chosen_at) VALUES ($1, $2, $3)
         ON CONFLICT (candidate_id) DO UPDATE SET display = EXCLUDED.display, chosen_at = EXCLUDED.chosen_at`,
        [candidateId, display, now()],
      );
      return display;
    },
  };
}

export async function coachProposalsDisplayOf(database: Pick<Pool, "query">, candidateId: string): Promise<ExportedCoachProposalsDisplay> {
  const { rows } = await database.query<{ display: string; chosenAt: Date }>(`SELECT display, chosen_at AS "chosenAt" FROM coach_proposals_display WHERE candidate_id = $1`, [candidateId]);
  const row = rows[0];
  return row ? { display: readCoachProposalsDisplay(row.display), chosenAt: row.chosenAt } : { display: DEFAULT_COACH_PROPOSALS_DISPLAY, chosenAt: null };
}

/** Creates the setting's table. Run after Candidate accounts. Safe to run repeatedly. */
export async function migrateCoachProposalsDisplay(database: Pool): Promise<void> {
  await database.query(`
    -- « Propositions du coach » in Mon compte (#717): what a Coach Action's proposal shows first. No row: « Carte ».
    CREATE TABLE IF NOT EXISTS coach_proposals_display (
      candidate_id text PRIMARY KEY REFERENCES candidate (id) ON DELETE CASCADE,
      display text NOT NULL CHECK (display IN ('card', 'form')),
      chosen_at timestamptz NOT NULL
    );
  `);
}

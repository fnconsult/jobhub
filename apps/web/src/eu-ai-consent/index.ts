/**
 * EU AI consent (ADR-0007 amendment): the Candidate's explicit, dated choice that the AI calls
 * carrying their identity go to an EU AI provider (Mistral). The AI layer asks `has` before
 * routing such a call (see @/ai/server).
 */
import type { Pool } from "pg";

export interface EuAiConsents {
  /** When the Candidate gave EU AI consent, or null if they have not (or withdrew it). */
  givenAt(candidateId: string): Promise<Date | null>;
  has(candidateId: string): Promise<boolean>;
  /** Records the consent, dated now. Already given: kept with its first date. Returns that date. */
  give(candidateId: string): Promise<Date>;
  /** Removes the consent, so it can only be given again with a new date. */
  withdraw(candidateId: string): Promise<void>;
}

export function createEuAiConsents(database: Pool, options: { now?: () => Date } = {}): EuAiConsents {
  const now = options.now ?? (() => new Date());

  async function givenAt(candidateId: string): Promise<Date | null> {
    const { rows } = await database.query<{ given_at: Date }>(`SELECT given_at FROM eu_ai_consent WHERE candidate_id = $1`, [candidateId]);
    return rows[0]?.given_at ?? null;
  }

  return {
    givenAt,
    async has(candidateId) {
      return (await givenAt(candidateId)) !== null;
    },
    async give(candidateId) {
      await database.query(
        `INSERT INTO eu_ai_consent (candidate_id, given_at) VALUES ($1, $2) ON CONFLICT (candidate_id) DO NOTHING`,
        [candidateId, now()],
      );
      return (await givenAt(candidateId))!;
    },
    async withdraw(candidateId) {
      await database.query(`DELETE FROM eu_ai_consent WHERE candidate_id = $1`, [candidateId]);
    },
  };
}

/** Creates or upgrades the EU AI consent table. Run after the Candidate table. Safe to run repeatedly. */
export async function migrateEuAiConsents(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS eu_ai_consent (
      candidate_id text PRIMARY KEY REFERENCES candidate (id) ON DELETE CASCADE,
      given_at timestamptz NOT NULL
    )
  `);
}

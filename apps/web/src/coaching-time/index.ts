import { COACHING_DEFAULT_ZONE, coachingTimeZone } from "@jobhub/shared/coaching-time";
import type { Queryable } from "../database/pool";

/** Explicit preferences; a Candidate without one is offered their device's zone on Mon compte. */
export function coachingTimeZones(database: Queryable) {
  return {
    async candidate(candidateId: string): Promise<string | null> {
      const { rows } = await database.query<{ time_zone: string }>("SELECT time_zone FROM candidate_coaching_time_zone WHERE candidate_id = $1", [candidateId]);
      return rows[0]?.time_zone ?? null;
    },
    async coach(coachId: string): Promise<string> {
      const { rows } = await database.query<{ time_zone: string }>("SELECT z.time_zone FROM coach_coaching_time_zone z JOIN human_coach h ON h.id = z.coach_id AND h.retired_at IS NULL WHERE z.coach_id = $1", [coachId]);
      return rows[0]?.time_zone ?? COACHING_DEFAULT_ZONE;
    },
    async saveCandidate(candidateId: string, value: unknown): Promise<boolean> {
      const zone = coachingTimeZone(value);
      if (!zone) return false;
      const result = await database.query("INSERT INTO candidate_coaching_time_zone (candidate_id, time_zone) SELECT id, $2 FROM candidate WHERE id = $1 ON CONFLICT (candidate_id) DO UPDATE SET time_zone = EXCLUDED.time_zone", [candidateId, zone]);
      return result.rowCount === 1;
    },
    async saveCoach(coachId: string, value: unknown): Promise<boolean> {
      const zone = coachingTimeZone(value);
      if (!zone) return false;
      const result = await database.query("INSERT INTO coach_coaching_time_zone (coach_id, time_zone) SELECT id, $2 FROM human_coach WHERE id = $1 AND retired_at IS NULL ON CONFLICT (coach_id) DO UPDATE SET time_zone = EXCLUDED.time_zone", [coachId, zone]);
      return result.rowCount === 1;
    },
  };
}

export async function migrateCoachingTimeZones(database: Queryable): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS candidate_coaching_time_zone (
      candidate_id text PRIMARY KEY REFERENCES candidate(id) ON DELETE CASCADE,
      time_zone text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS coach_coaching_time_zone (
      coach_id uuid PRIMARY KEY REFERENCES human_coach(id),
      time_zone text NOT NULL
    );
  `);
}

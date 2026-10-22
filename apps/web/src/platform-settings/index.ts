/**
 * Platform Settings in the database (CONTEXT.md, ADR-0033): the values super-admins set in
 * the Back Office's Paramètres, which win over env's. One row per setting set; « Rétablir »
 * will delete it. Nothing writes the table yet: the editing slices will, recording each
 * change in the Back Office Audit and announcing it with NOTIFY on PLATFORM_SETTINGS_CHANNEL
 * in the same transaction.
 *
 * `platformSettingsReader(database).load()` is what the resolver (./resolver.ts) reads. The
 * table names no Candidate (an Administrator by email only), so it stays out of a
 * Candidate's data export.
 */
import type { Pool } from "pg";
import { platformSetting } from "./catalog";
import type { StoredPlatformSettings } from "./resolver";

/** The Postgres channel a change is announced on. Its payload is empty. */
export const PLATFORM_SETTINGS_CHANNEL = "platform_settings_changed";

export interface PlatformSettingsReader {
  /** What the Back Office set, by name; a row whose name is not a Platform Setting is left out. */
  load(): Promise<StoredPlatformSettings>;
}

export function platformSettingsReader(database: Pick<Pool, "query">): PlatformSettingsReader {
  return {
    async load() {
      const { rows } = await database.query<{ name: string; value: string; updated_by_email: string; updated_at: Date }>(
        "SELECT name, value, updated_by_email, updated_at FROM platform_setting ORDER BY name",
      );
      const stored: StoredPlatformSettings = {};
      for (const row of rows) {
        if (platformSetting(row.name)) stored[row.name] = { value: row.value, updatedBy: row.updated_by_email, updatedAt: row.updated_at };
      }
      return stored;
    },
  };
}

/** Creates the Platform Settings table. Safe to run repeatedly. */
export async function migratePlatformSettings(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS platform_setting (
      -- The env variable it stands for, e.g. ANTHROPIC_ENDPOINT.
      name text PRIMARY KEY,
      -- As env would hold it; not secret (ADR-0033): shown, and recorded in the Back Office Audit.
      value text NOT NULL,
      -- The Administrator by email only: no Candidate id, so this table is never part of a Candidate's data export.
      updated_by_email text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

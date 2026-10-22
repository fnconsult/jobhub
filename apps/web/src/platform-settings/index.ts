/**
 * Platform Settings in the database (CONTEXT.md, ADR-0033): the values super-admins set in
 * the Back Office's Paramètres, which win over env's. One row per setting set; « Rétablir »
 * deletes it.
 *
 *  - `platformSettingsReader(database).load()` is what the resolver (./resolver.ts) reads.
 *  - `platformSettingsStore(database, env, { check })` also sets and restores an editable setting
 *    (`isEditable`), parsed as env's value is, and says its value and source before and after.
 *    `check` is asked about each change first, with the settings in use before and after it (an AI
 *    route the AI layer would refuse, a model that fails its test call, #301): what it refuses is not kept.
 *    Each change is announced with NOTIFY on PLATFORM_SETTINGS_CHANNEL in the transaction it is
 *    given (the Back Office records it in the same one), so it is in use within seconds in the
 *    web app and the worker.
 *
 * The table names no Candidate (an Administrator by email only), so it stays out of a
 * Candidate's data export.
 */
import type { FailureReason, TechnicalReason } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";
import { isEditable, parseSetting, platformSetting } from "./catalog";
import { snapshotOfSettings, type PlatformSettingSource, type StoredPlatformSettings } from "./resolver";

/** The Postgres channel a change is announced on. Its payload is empty. */
export const PLATFORM_SETTINGS_CHANNEL = "platform_settings_changed";

export interface PlatformSettingsReader {
  /** What the Back Office set, by name; a row whose name is not a Platform Setting is left out. */
  load(): Promise<StoredPlatformSettings>;
}

export function platformSettingsReader(database: Queryable): PlatformSettingsReader {
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

/** A Platform Setting's value in use, and where it comes from: what a change records before and after. */
export interface PlatformSettingState {
  value: string;
  source: PlatformSettingSource;
}

/** `changed`: false when the Back Office already held that value (set), or held none (restore): nothing written. */
export type PlatformSettingChange = { ok: true; changed: boolean; before: PlatformSettingState; after: PlatformSettingState };

type Env = Record<string, string | undefined>;

/** Why a change's check refused it: its Failure Reason, and the technical detail (not secret). */
export interface PlatformSettingRefusal {
  reason: FailureReason;
  technical: TechnicalReason;
}

/** A change about to be written: env with the Back Office's values over it, before and after. */
export interface ProposedPlatformSettingChange {
  name: string;
  before: Env;
  after: Env;
}

/** Asked about each change before it is written: null to let it through. */
export type PlatformSettingCheck = (change: ProposedPlatformSettingChange) => Promise<PlatformSettingRefusal | null>;

/** A change its check refused (#301): nothing was written. */
export type RefusedPlatformSettingChange = { ok: false; error: "refused" } & PlatformSettingRefusal;

/**
 * Why a value is refused: `invalid`, the setting does not take it (out of its bounds, not of its type);
 * `empty`, nothing entered; `not_editable`, not a Platform Setting super-admins edit (yet); `refused`, its
 * check turned the change down.
 */
export type SetPlatformSettingResult = PlatformSettingChange | RefusedPlatformSettingChange | { ok: false; error: "invalid" | "empty" | "not_editable" };
export type RestorePlatformSettingResult = PlatformSettingChange | RefusedPlatformSettingChange | { ok: false; error: "not_editable" };

export interface PlatformSettingsStore extends PlatformSettingsReader {
  /** Sets `name` to `raw`, as its parser takes it (trimmed, a number as a number: "0.150" is "0.15"), by the Administrator `email`. */
  set(name: string, raw: string, email: string, within?: Queryable): Promise<SetPlatformSettingResult>;
  /** « Rétablir »: clears the Back Office's value of `name`, so env's is used, else the code's default. */
  restore(name: string, within?: Queryable): Promise<RestorePlatformSettingResult>;
}

export function platformSettingsStore(database: Queryable, env: Env, options: { check?: PlatformSettingCheck } = {}): PlatformSettingsStore {
  /** The value and source of `name` in use, given what the Back Office holds. */
  const stateOf = (stored: StoredPlatformSettings, name: string): PlatformSettingState => {
    const { value, source } = snapshotOfSettings(env, stored).setting(name)!;
    return { value, source };
  };

  /**
   * Changes `name` on `within` to what `proposed` makes of the Back Office's values (null: nothing to
   * change), once its check lets it through, and announces it; says the setting before and after.
   */
  async function change(
    within: Queryable,
    name: string,
    proposed: (stored: StoredPlatformSettings) => StoredPlatformSettings | null,
    write: () => Promise<unknown>,
  ): Promise<PlatformSettingChange | RefusedPlatformSettingChange> {
    // The row is locked while it changes, so two Administrators saving at once each record what they replaced.
    await within.query("SELECT 1 FROM platform_setting WHERE name = $1 FOR UPDATE", [name]);
    const stored = await platformSettingsReader(within).load();
    const before = stateOf(stored, name);
    const next = proposed(stored);
    if (!next) return { ok: true, changed: false, before, after: before };
    const refusal = await options.check?.({ name, before: snapshotOfSettings(env, stored).env, after: snapshotOfSettings(env, next).env });
    if (refusal) return { ok: false, error: "refused", ...refusal };
    await write();
    await within.query("SELECT pg_notify($1, '')", [PLATFORM_SETTINGS_CHANNEL]);
    return { ok: true, changed: true, before, after: stateOf(await platformSettingsReader(within).load(), name) };
  }

  return {
    ...platformSettingsReader(database),

    async set(name, raw, email, within = database) {
      const setting = platformSetting(name);
      if (!setting || !isEditable(setting)) return { ok: false, error: "not_editable" };
      if (!raw.trim()) return { ok: false, error: "empty" };
      const parsed = parseSetting(setting, raw);
      if (!parsed.ok) return { ok: false, error: "invalid" };
      const value = String(parsed.value);
      return change(
        within,
        name,
        (stored) => (stored[name]?.value === value ? null : { ...stored, [name]: { value, updatedBy: email, updatedAt: new Date() } }),
        () =>
          within.query(
            `INSERT INTO platform_setting (name, value, updated_by_email) VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_by_email = excluded.updated_by_email, updated_at = now()`,
            [name, value, email.trim().toLowerCase()],
          ),
      );
    },

    async restore(name, within = database) {
      const setting = platformSetting(name);
      if (!setting || !isEditable(setting)) return { ok: false, error: "not_editable" };
      return change(
        within,
        name,
        (stored) => (stored[name] ? Object.fromEntries(Object.entries(stored).filter(([kept]) => kept !== name)) : null),
        () => within.query("DELETE FROM platform_setting WHERE name = $1", [name]),
      );
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

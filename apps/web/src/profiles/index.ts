/**
 * A Candidate's Profiles: each one a Master CV (versioned) and Search Criteria.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createProfiles(database)` — `create` a Profile from a reviewed CV draft
 *    (validated here; field errors come back, never an exception), `duplicate`,
 *    `rename`, `archive` and `restore` one, `list` a Candidate's Profiles and
 *    `get` one; edit the Master CV (`saveMasterCv`, each change a new version),
 *    list its versions and restore one (`restoreMasterCv`). Every read and
 *    change is scoped to the Candidate.
 *    The number of active Profiles respects the Plan Quota (`profileQuota`).
 *  - `migrateProfiles(database)` — creates / upgrades the tables.
 * Profiles belong to their Candidate and are deleted with the account (ADR-0010).
 */
import {
  CONTRACT_TYPES,
  REMOTE_WORK_OPTIONS,
  type MasterCvContent,
  type SearchCriteria,
} from "@jobhub/shared";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import * as z from "zod";
import { PROFILE_NAME_MAX_LENGTH } from "./limits";
import { fieldErrors, type FieldError } from "../validation";

export interface Profile {
  id: string;
  /** Shown to the Candidate to tell their Profiles apart; the target role when created. */
  name: string;
  /** An archived Profile is kept, but left out of the Profile switcher until restored. */
  archived: boolean;
  searchCriteria: SearchCriteria;
  /** The current version of the Profile's Master CV. */
  masterCv: { version: number; content: MasterCvContent };
}

export interface ProfileSummary {
  id: string;
  name: string;
  archived: boolean;
}

export type { FieldError as ProfileFieldError } from "../validation";

type SavedProfile = { ok: true; profile: Profile } | { ok: false; errors: FieldError[] };

/** Refused because the Candidate already has as many active Profiles as their Plan Quota allows. */
export type PlanQuotaReached = { ok: false; error: "plan_quota_reached" };

export type CreateProfileResult = SavedProfile | PlanQuotaReached;

/** One saved version of a Master CV. */
export interface MasterCvVersion {
  version: number;
  savedAt: Date;
  /** The earlier version this one restored, or null for an edit (or the first version). */
  restoredFrom: number | null;
  content: MasterCvContent;
}

export type SaveMasterCvResult =
  | { ok: true; profile: Profile }
  | { ok: false; errors: FieldError[] }
  /** Another save landed since the Candidate opened the editor (`basedOnVersion` is no longer the current one). */
  | { ok: false; conflict: { currentVersion: number } };

/** The outcome of changing an existing Profile. "not_found" also covers someone else's Profile. */
export type ProfileChangeResult = CreateProfileResult | { ok: false; error: "not_found" };

/**
 * How many active (not archived) Profiles the Candidate's Plan allows, or null
 * for no limit. The app takes it from billing (`profilePlanQuota`); without
 * one, there is no limit.
 */
export type ProfileQuota = (candidateId: string) => Promise<number | null>;

export interface Profiles {
  /** Saves a reviewed CV draft as a new Profile. `input` is untrusted (it comes from the browser). */
  create(candidateId: string, input: unknown): Promise<CreateProfileResult>;
  /**
   * A new Profile under the name in `input` ({ name }, untrusted), with a copy of the
   * Profile's Search Criteria and of the current version of its Master CV (as version 1).
   */
  duplicate(candidateId: string, profileId: string, input: unknown): Promise<ProfileChangeResult>;
  /** Renames a Profile. `input` ({ name }) is untrusted. */
  rename(candidateId: string, profileId: string, input: unknown): Promise<ProfileChangeResult>;
  /** Whether the Plan Quota leaves room for one more active Profile (to offer creating or duplicating one). */
  canAddProfile(candidateId: string): Promise<boolean>;
  /** Archives a Profile: kept with its Master CV, but out of the Profile switcher. Archiving twice is harmless. */
  archive(candidateId: string, profileId: string): Promise<ProfileChangeResult>;
  /** Brings an archived Profile back, if the Plan Quota leaves room for it. */
  restore(candidateId: string, profileId: string): Promise<ProfileChangeResult>;
  /** Every Profile of the Candidate, archived ones included, oldest first. */
  list(candidateId: string): Promise<ProfileSummary[]>;
  /** The Profile, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, profileId: string): Promise<Profile | null>;
  /**
   * Saves the Candidate's edits to a Profile's Master CV as its next version.
   * `input` is untrusted: `{ basedOnVersion, content }`, where `basedOnVersion` is the
   * version the Candidate edited. Null if the Profile does not exist or belongs to someone else.
   */
  saveMasterCv(candidateId: string, profileId: string, input: unknown): Promise<SaveMasterCvResult | null>;
  /** Every version of the Profile's Master CV, newest first. Null like `get`. */
  masterCvVersions(candidateId: string, profileId: string): Promise<MasterCvVersion[] | null>;
  /**
   * Makes an earlier version current again by saving its content as the next version,
   * so the history is kept. Null if the Profile or the version does not exist.
   */
  restoreMasterCv(candidateId: string, profileId: string, version: number): Promise<Profile | null>;
}

const text = z.string().trim();
const required = z.string().trim().min(1);
const notBlank = (value: object) => Object.values(value).some((field) => field !== "");

export { PROFILE_NAME_MAX_LENGTH } from "./limits";
const nameSchema = z.object({ name: required.max(PROFILE_NAME_MAX_LENGTH) });

/** A CV in sections (Master or Tailored) as the browser sends it: trimmed, blank entries dropped. */
export const cvContentSchema = z.object({
  fullName: text,
  headline: text,
  email: text,
  phone: text,
  location: text,
  summary: text,
  experience: z
    .array(z.object({ title: text, employer: text, location: text, period: text, description: text }))
    .transform((items) => items.filter(notBlank)),
  education: z.array(z.object({ degree: text, institution: text, year: text })).transform((items) => items.filter(notBlank)),
  skills: z.array(text).transform((items) => items.filter(Boolean)),
  languages: z.array(z.object({ name: text, level: text })).transform((items) => items.filter(notBlank)),
});

/** Search Criteria as the browser sends them: a target role and a location at least. */
export const searchCriteriaSchema = z.object({
  // The Profile is named after it, so it obeys the same limit as a Profile name.
  targetRole: required.max(PROFILE_NAME_MAX_LENGTH),
  location: required,
  minSalary: z.number().int().positive().max(10_000_000).optional(),
  contractType: z.enum(CONTRACT_TYPES).optional(),
  remoteWork: z.enum(REMOTE_WORK_OPTIONS).optional(),
});

const inputSchema = z.object({ masterCv: cvContentSchema, searchCriteria: searchCriteriaSchema });

interface ProfileRow {
  id: string;
  name: string;
  archived: boolean;
  target_role: string;
  location: string;
  min_salary: number | null;
  contract_type: SearchCriteria["contractType"] | null;
  remote_work: SearchCriteria["remoteWork"] | null;
  version: number;
  content: MasterCvContent;
}

function profileFrom(row: ProfileRow): Profile {
  const searchCriteria: SearchCriteria = { targetRole: row.target_role, location: row.location };
  if (row.min_salary !== null) searchCriteria.minSalary = row.min_salary;
  if (row.contract_type !== null) searchCriteria.contractType = row.contract_type;
  if (row.remote_work !== null) searchCriteria.remoteWork = row.remote_work;
  return { id: row.id, name: row.name, archived: row.archived, searchCriteria, masterCv: { version: row.version, content: row.content } };
}

const saveInputSchema = z.object({ basedOnVersion: z.number().int().positive(), content: cvContentSchema });

const NOT_FOUND = { ok: false, error: "not_found" } as const;
const found = (profile: Profile | null): ProfileChangeResult => (profile ? { ok: true, profile } : NOT_FOUND);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUOTA_REACHED: PlanQuotaReached = { ok: false, error: "plan_quota_reached" };

export function createProfiles(database: Pool, { profileQuota = async () => null }: { profileQuota?: ProfileQuota } = {}): Profiles {
  async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Whether one more active Profile fits the Plan Quota. Inside a transaction,
   * holds the Candidate's lock until it ends, so concurrent requests cannot both
   * take the last place.
   */
  async function roomForOneMore(candidateId: string, client: Pool | PoolClient = database): Promise<boolean> {
    const quota = await profileQuota(candidateId);
    if (quota === null) return true;
    if (client !== database) await client.query(`SELECT pg_advisory_xact_lock(hashtext('profile:' || $1))`, [candidateId]);
    const { rows } = await client.query<{ active: number }>(
      `SELECT count(*)::int AS active FROM profile WHERE candidate_id = $1 AND archived_at IS NULL`,
      [candidateId],
    );
    return rows[0]!.active < quota;
  }

  /** False if `version` is already taken: the primary key (profile_id, version) refuses concurrent saves of the same next version. */
  async function appendVersion(profileId: string, version: number, content: MasterCvContent, restoredFrom: number | null) {
    const inserted = await database.query(
      `INSERT INTO master_cv_version (profile_id, version, content, restored_from) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [profileId, version, content, restoredFrom],
    );
    return inserted.rowCount === 1;
  }

  async function get(candidateId: string, profileId: string): Promise<Profile | null> {
    if (!UUID.test(profileId)) return null;
    const { rows } = await database.query<ProfileRow>(
      `SELECT p.id, p.name, p.archived_at IS NOT NULL AS archived, p.target_role, p.location, p.min_salary, p.contract_type, p.remote_work, v.version, v.content
         FROM profile p
         JOIN master_cv_version v ON v.profile_id = p.id
        WHERE p.id = $1 AND p.candidate_id = $2
        ORDER BY v.version DESC
        LIMIT 1`,
      [profileId, candidateId],
    );
    return rows[0] ? profileFrom(rows[0]) : null;
  }

  /** Stores a new Profile with version 1 of its Master CV, if the Plan Quota leaves room for it. */
  function insert(
    candidateId: string,
    { name, searchCriteria, masterCv }: { name: string; searchCriteria: SearchCriteria; masterCv: MasterCvContent },
  ): Promise<CreateProfileResult> {
    return transaction(async (client) => {
      if (!(await roomForOneMore(candidateId, client))) return QUOTA_REACHED;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO profile (candidate_id, name, target_role, location, min_salary, contract_type, remote_work)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          candidateId,
          name,
          searchCriteria.targetRole,
          searchCriteria.location,
          searchCriteria.minSalary ?? null,
          searchCriteria.contractType ?? null,
          searchCriteria.remoteWork ?? null,
        ],
      );
      const id = rows[0]!.id;
      await client.query(`INSERT INTO master_cv_version (profile_id, version, content) VALUES ($1, 1, $2)`, [id, masterCv]);
      return { ok: true, profile: { id, name, archived: false, searchCriteria, masterCv: { version: 1, content: masterCv } } };
    });
  }

  async function setArchived(candidateId: string, profileId: string, archived: boolean): Promise<ProfileChangeResult> {
    const profile = await get(candidateId, profileId);
    if (!profile) return NOT_FOUND;
    if (profile.archived === archived) return { ok: true, profile };
    return transaction(async (client) => {
      if (!archived && !(await roomForOneMore(candidateId, client))) return QUOTA_REACHED;
      await client.query(`UPDATE profile SET archived_at = CASE WHEN $3 THEN now() END WHERE id = $1 AND candidate_id = $2`, [
        profileId,
        candidateId,
        archived,
      ]);
      return { ok: true, profile: { ...profile, archived } };
    });
  }

  return {
    get,

    async saveMasterCv(candidateId, profileId, input) {
      const profile = await get(candidateId, profileId);
      if (!profile) return null;
      const parsed = saveInputSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { basedOnVersion, content } = parsed.data;
      if (basedOnVersion !== profile.masterCv.version) return { ok: false, conflict: { currentVersion: profile.masterCv.version } };

      if (isDeepStrictEqual(content, profile.masterCv.content)) return { ok: true, profile };

      const version = basedOnVersion + 1;
      if (!(await appendVersion(profileId, version, content, null))) {
        const current = await get(candidateId, profileId);
        return { ok: false, conflict: { currentVersion: current!.masterCv.version } };
      }
      return { ok: true, profile: { ...profile, masterCv: { version, content } } };
    },

    async masterCvVersions(candidateId, profileId) {
      if (!(await get(candidateId, profileId))) return null;
      const { rows } = await database.query<{ version: number; created_at: Date; restored_from: number | null; content: MasterCvContent }>(
        `SELECT version, created_at, restored_from, content FROM master_cv_version WHERE profile_id = $1 ORDER BY version DESC`,
        [profileId],
      );
      return rows.map((row) => ({ version: row.version, savedAt: row.created_at, restoredFrom: row.restored_from, content: row.content }));
    },

    async restoreMasterCv(candidateId, profileId, version) {
      if (!Number.isSafeInteger(version)) return null;
      for (;;) {
        const profile = await get(candidateId, profileId);
        if (!profile) return null;
        const { rows } = await database.query<{ content: MasterCvContent }>(
          `SELECT content FROM master_cv_version WHERE profile_id = $1 AND version = $2`,
          [profileId, version],
        );
        if (!rows[0]) return null;
        const { content } = rows[0];
        if (isDeepStrictEqual(content, profile.masterCv.content)) return profile;
        const next = profile.masterCv.version + 1;
        // Another save took that version number meanwhile: restore on top of it.
        if (await appendVersion(profileId, next, content, version)) return { ...profile, masterCv: { version: next, content } };
      }
    },

    async create(candidateId, input) {
      // reportInput: Zod v4 leaves `issue.input` out otherwise, and fieldErrors()
      // needs it to tell a missing field from a filled but invalid one.
      const parsed = inputSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { masterCv, searchCriteria } = parsed.data;

      return insert(candidateId, { name: searchCriteria.targetRole, searchCriteria, masterCv });
    },

    async duplicate(candidateId, profileId, input) {
      const parsed = nameSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const original = await get(candidateId, profileId);
      if (!original) return NOT_FOUND;
      const { searchCriteria, masterCv } = original;
      return insert(candidateId, { name: parsed.data.name, searchCriteria, masterCv: masterCv.content });
    },

    async rename(candidateId, profileId, input) {
      const parsed = nameSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!UUID.test(profileId)) return NOT_FOUND;
      const { rowCount } = await database.query(`UPDATE profile SET name = $3 WHERE id = $1 AND candidate_id = $2`, [
        profileId,
        candidateId,
        parsed.data.name,
      ]);
      return rowCount ? found(await get(candidateId, profileId)) : NOT_FOUND;
    },

    canAddProfile: (candidateId) => roomForOneMore(candidateId),

    archive: (candidateId, profileId) => setArchived(candidateId, profileId, true),
    restore: (candidateId, profileId) => setArchived(candidateId, profileId, false),

    async list(candidateId) {
      const { rows } = await database.query<ProfileSummary>(
        `SELECT id, name, archived_at IS NOT NULL AS archived FROM profile WHERE candidate_id = $1 ORDER BY created_at, id`,
        [candidateId],
      );
      return rows;
    },
  };
}

/** Creates or upgrades the Profile tables. Run after the Candidate account tables. Safe to run repeatedly. */
export async function migrateProfiles(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS profile (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      name text NOT NULL,
      target_role text NOT NULL,
      location text NOT NULL,
      min_salary integer,
      contract_type text,
      remote_work text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE profile ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    CREATE INDEX IF NOT EXISTS profile_candidate_id_idx ON profile (candidate_id);
    CREATE TABLE IF NOT EXISTS master_cv_version (
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      version integer NOT NULL,
      content jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (profile_id, version)
    );
    ALTER TABLE master_cv_version ADD COLUMN IF NOT EXISTS restored_from integer;
  `);
}

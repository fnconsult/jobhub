/**
 * A Candidate's Profiles: each one a Master CV (versioned) and Search Criteria.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createProfiles(database)` — `create` a Profile from a reviewed CV draft
 *    (validated here; field errors come back, never an exception), `list` a
 *    Candidate's Profiles and `get` one. Every read is scoped to the Candidate.
 *  - `migrateProfiles(database)` — creates / upgrades the tables.
 * Profiles belong to their Candidate and are deleted with the account (ADR-0010).
 */
import {
  CONTRACT_TYPES,
  REMOTE_WORK_OPTIONS,
  type MasterCvContent,
  type SearchCriteria,
} from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";

export interface Profile {
  id: string;
  /** Shown to the Candidate to tell their Profiles apart; the target role when created. */
  name: string;
  searchCriteria: SearchCriteria;
  /** The current version of the Profile's Master CV. */
  masterCv: { version: number; content: MasterCvContent };
}

export interface ProfileSummary {
  id: string;
  name: string;
}

/** A field the Candidate must fix, as a dotted path (e.g. "searchCriteria.location"). */
export interface ProfileFieldError {
  field: string;
  code: "required" | "invalid";
}

export type CreateProfileResult = { ok: true; profile: Profile } | { ok: false; errors: ProfileFieldError[] };

export interface Profiles {
  /** Saves a reviewed CV draft as a new Profile. `input` is untrusted (it comes from the browser). */
  create(candidateId: string, input: unknown): Promise<CreateProfileResult>;
  list(candidateId: string): Promise<ProfileSummary[]>;
  /** The Profile, or null if it does not exist or belongs to someone else. */
  get(candidateId: string, profileId: string): Promise<Profile | null>;
}

const text = z.string().trim();
const required = z.string().trim().min(1);
const notBlank = (value: object) => Object.values(value).some((field) => field !== "");

const inputSchema = z.object({
  masterCv: z.object({
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
  }),
  searchCriteria: z.object({
    targetRole: required,
    location: required,
    minSalary: z.number().int().positive().max(10_000_000).optional(),
    contractType: z.enum(CONTRACT_TYPES).optional(),
    remoteWork: z.enum(REMOTE_WORK_OPTIONS).optional(),
  }),
});

function fieldErrors(error: z.ZodError): ProfileFieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    code:
      (issue.code === "too_small" && issue.origin === "string") || (issue.code === "invalid_type" && issue.input === undefined)
        ? "required"
        : "invalid",
  }));
}

interface ProfileRow {
  id: string;
  name: string;
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
  return { id: row.id, name: row.name, searchCriteria, masterCv: { version: row.version, content: row.content } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createProfiles(database: Pool): Profiles {
  async function get(candidateId: string, profileId: string): Promise<Profile | null> {
    if (!UUID.test(profileId)) return null;
    const { rows } = await database.query<ProfileRow>(
      `SELECT p.id, p.name, p.target_role, p.location, p.min_salary, p.contract_type, p.remote_work, v.version, v.content
         FROM profile p
         JOIN master_cv_version v ON v.profile_id = p.id
        WHERE p.id = $1 AND p.candidate_id = $2
        ORDER BY v.version DESC
        LIMIT 1`,
      [profileId, candidateId],
    );
    return rows[0] ? profileFrom(rows[0]) : null;
  }

  return {
    get,

    async create(candidateId, input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const { masterCv, searchCriteria } = parsed.data;

      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO profile (candidate_id, name, target_role, location, min_salary, contract_type, remote_work)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            candidateId,
            searchCriteria.targetRole,
            searchCriteria.targetRole,
            searchCriteria.location,
            searchCriteria.minSalary ?? null,
            searchCriteria.contractType ?? null,
            searchCriteria.remoteWork ?? null,
          ],
        );
        const id = rows[0]!.id;
        await client.query(`INSERT INTO master_cv_version (profile_id, version, content) VALUES ($1, 1, $2)`, [id, masterCv]);
        await client.query("COMMIT");
        return { ok: true, profile: { id, name: searchCriteria.targetRole, searchCriteria, masterCv: { version: 1, content: masterCv } } };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async list(candidateId) {
      const { rows } = await database.query<ProfileSummary>(
        `SELECT id, name FROM profile WHERE candidate_id = $1 ORDER BY created_at, id`,
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
    CREATE INDEX IF NOT EXISTS profile_candidate_id_idx ON profile (candidate_id);
    CREATE TABLE IF NOT EXISTS master_cv_version (
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      version integer NOT NULL,
      content jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (profile_id, version)
    );
  `);
}

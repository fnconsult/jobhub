/**
 * The Back Office's writes, each recorded in the Back Office Audit (CONTEXT.md, #203).
 *
 * One deep module. `createBackOffice(database, deps)` answers:
 *  - change what the Jobbbox team runs     `setPlanQuotas`, `addHumanCoach`, `retireHumanCoach`
 *  - record any other Back Office write    `record`, the one seam every write goes through
 *  - read the record                       `journal`, newest first, by section
 * and `purgeExpiredBackOfficeAudit(database, now)` (the worker, daily) and
 * `migrateBackOfficeAudit(database)`.
 *
 * A change and its entry are kept together or not at all: both go in one
 * transaction. An entry names its Administrator by Candidate id and by the email
 * they had then, so it outlives their account (the id becomes null). Secret
 * values are never recorded, only that they were replaced. Entries are Jobbbox's
 * operations record, not the Administrator's personal data export; they are kept
 * RETENTION_YEARS.
 */
import type { Plan, PlanQuotas } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Billing } from "../billing";
import type { Queryable } from "../database/pool";
import type { AddHumanCoachResult, HumanCoaches } from "../human-coaches";

/** How long a Back Office Audit entry is kept. */
export const RETENTION_YEARS = 3;

/** What part of the Back Office a change was made in. */
export const BACK_OFFICE_SECTIONS = [
  "roles",
  "plan_quotas",
  "human_coaches",
  "provider_secrets",
  "job_discovery_sources",
  "job_discovery_sites",
  "job_sites",
] as const;
export type BackOfficeSection = (typeof BACK_OFFICE_SECTIONS)[number];

export const isBackOfficeSection = (value: unknown): value is BackOfficeSection => BACK_OFFICE_SECTIONS.includes(value as BackOfficeSection);

/**
 * What can be done to a secret (a Provider Secret): replaced, replaced although its
 * connection test failed ("save anyway"), or cleared (back to env). Its value is never
 * recorded, before or after.
 */
export const SECRET_ACTIONS = ["replaced", "replaced_despite_failed_test", "cleared"] as const;
export type SecretAction = (typeof SECRET_ACTIONS)[number];

/**
 * What was done to the target. `retired` keeps its history (a Human Coach), `removed`
 * deletes it (a search site).
 */
export type BackOfficeAction = "added" | "updated" | "retired" | "removed" | SecretAction;

export const isSecretAction = (action: BackOfficeAction): action is SecretAction => SECRET_ACTIONS.includes(action as SecretAction);

/** A value as recorded: what JSON can hold. */
export type Recorded = string | number | boolean | null | Recorded[] | { [key: string]: Recorded };

/** One change to record. */
export type BackOfficeChange = {
  section: BackOfficeSection;
  /** What was changed: a Plan, a Human Coach's email, an Administrator's email... */
  target: string;
} & (
  | { action: Exclude<BackOfficeAction, SecretAction>; before: Recorded; after: Recorded }
  /** A secret was replaced or cleared: no value is recorded, before or after. */
  | { action: SecretAction }
);

/** The Administrator making a change, as signed in. */
export interface BackOfficeActor {
  /** Their Candidate id. */
  id: string;
  email: string;
}

/** One entry of the Back Office Audit, as the Journal lists it. */
export interface BackOfficeAuditEntry {
  id: string;
  at: Date;
  /** Who made the change: their Candidate id (null once their account is deleted) and the email they had then. */
  actor: { candidateId: string | null; email: string };
  section: BackOfficeSection;
  target: string;
  action: BackOfficeAction;
  /** Null when there was nothing before (added), and for a secret. */
  before: Recorded;
  /** Null when there is nothing after (retired, removed), and for a secret. */
  after: Recorded;
}

export interface BackOfficeDeps {
  billing: Pick<Billing, "setPlanQuotas">;
  humanCoaches: Pick<HumanCoaches, "add" | "retire">;
}

export interface BackOffice {
  /** Replaces one Plan's quotas. */
  setPlanQuotas(actor: BackOfficeActor, plan: Plan, quotas: PlanQuotas): Promise<void>;
  /** Adds a Human Coach. `input` is untrusted (see HumanCoaches.add); nothing is recorded when refused. */
  addHumanCoach(actor: BackOfficeActor, input: unknown): Promise<AddHumanCoachResult>;
  /** Retires a Human Coach; nothing is recorded for an unknown or already retired one. */
  retireHumanCoach(actor: BackOfficeActor, coachId: string): Promise<void>;
  /**
   * Runs one Back Office write and records it, in one transaction: `write` runs on the
   * transaction it is given, then `changeOf` says what it changed (null: nothing to record).
   * If the write, or recording it, fails, neither is kept and the error is thrown.
   */
  record<T>(actor: BackOfficeActor, write: (within: Queryable) => Promise<T>, changeOf: (result: T) => BackOfficeChange | null): Promise<T>;
  /** The Back Office Audit, newest first: everything, or one section. At most `limit` entries (default 200). */
  journal(filter?: { section?: BackOfficeSection; limit?: number }): Promise<BackOfficeAuditEntry[]>;
}

interface EntryRow {
  id: string;
  created_at: Date;
  candidate_id: string | null;
  actor_email: string;
  section: BackOfficeSection;
  target: string;
  action: BackOfficeAction;
  before: Recorded;
  after: Recorded;
}

const entryFrom = (row: EntryRow): BackOfficeAuditEntry => ({
  id: row.id,
  at: row.created_at,
  actor: { candidateId: row.candidate_id, email: row.actor_email },
  section: row.section,
  target: row.target,
  action: row.action,
  before: row.before,
  after: row.after,
});

/** A recorded value as a jsonb parameter; nothing is SQL NULL. */
const json = (value: Recorded): string | null => (value === null ? null : JSON.stringify(value));

/** A Plan's quotas as recorded. */
const recordedQuotas = (quotas: PlanQuotas): Recorded => ({ ...quotas });

export function createBackOffice(database: Pool, deps: BackOfficeDeps): BackOffice {
  async function record<T>(actor: BackOfficeActor, write: (within: Queryable) => Promise<T>, changeOf: (result: T) => BackOfficeChange | null): Promise<T> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await write(client);
      const change = changeOf(result);
      if (change) {
        const secret = isSecretAction(change.action);
        await client.query(
          `INSERT INTO back_office_audit (candidate_id, actor_email, section, target, action, before, after)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
          [
            actor.id,
            actor.email.trim().toLowerCase(),
            change.section,
            change.target,
            change.action,
            secret || !("before" in change) ? null : json(change.before),
            secret || !("after" in change) ? null : json(change.after),
          ],
        );
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    record,

    async setPlanQuotas(actor, plan, quotas) {
      await record(
        actor,
        (within) => deps.billing.setPlanQuotas(plan, quotas, within),
        (before) => ({ section: "plan_quotas", target: plan, action: "updated", before: recordedQuotas(before), after: recordedQuotas(quotas) }),
      );
    },

    addHumanCoach(actor, input) {
      return record(
        actor,
        (within) => deps.humanCoaches.add(input, within),
        (added) => (added.ok ? { section: "human_coaches", target: added.coach.email, action: "added", before: null, after: { ...added.coach } } : null),
      );
    },

    async retireHumanCoach(actor, coachId) {
      await record(
        actor,
        (within) => deps.humanCoaches.retire(coachId, within),
        (retired) => (retired ? { section: "human_coaches", target: retired.email, action: "retired", before: { ...retired }, after: null } : null),
      );
    },

    async journal({ section, limit = 200 } = {}) {
      // Ordered by the table's id, a number: a bare "id" would be the text column selected (10 before 9).
      const { rows } = await database.query<EntryRow>(
        `SELECT id::text, created_at, candidate_id, actor_email, section, target, action, before, after
         FROM back_office_audit WHERE $1::text IS NULL OR section = $1
         ORDER BY back_office_audit.id DESC LIMIT $2`,
        [section ?? null, limit],
      );
      return rows.map(entryFrom);
    },
  };
}

/**
 * Deletes the Back Office Audit entries RETENTION_YEARS old or more at `now`;
 * returns how many. Safe to run again.
 */
export async function purgeExpiredBackOfficeAudit(database: Queryable, now: Date): Promise<number> {
  const { rowCount } = await database.query("DELETE FROM back_office_audit WHERE created_at <= $1::timestamptz - make_interval(years => $2)", [
    now,
    RETENTION_YEARS,
  ]);
  return rowCount ?? 0;
}

/** Creates or upgrades the Back Office Audit table. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateBackOfficeAudit(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS back_office_audit (
      id bigserial PRIMARY KEY,
      candidate_id text REFERENCES candidate (id) ON DELETE SET NULL,
      actor_email text NOT NULL,
      section text NOT NULL,
      target text NOT NULL,
      action text NOT NULL,
      before jsonb,
      after jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS back_office_audit_section_idx ON back_office_audit (section, id DESC);
    CREATE INDEX IF NOT EXISTS back_office_audit_created_at_idx ON back_office_audit (created_at);
    CREATE INDEX IF NOT EXISTS back_office_audit_candidate_id_idx ON back_office_audit (candidate_id);
  `);
}

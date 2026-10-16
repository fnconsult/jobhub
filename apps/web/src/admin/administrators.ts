/**
 * Administrators and their Back Office Roles (CONTEXT.md, ADR-0014 addendum #193).
 *
 * One deep module. `createAdministrators(database, deps)` answers:
 *  - what may this person do in the Back Office    `access`, read from the database every time
 *  - who are the Administrators                     `list`
 *  - change who holds which role                    `grant`, `revoke`
 * and `migrateAdministratorRoles(database)`.
 *
 * Roles live in `administrator_role`, one row per Candidate and role; the
 * Candidate table is untouched (ADR-0011). ADMIN_EMAILS members are permanent
 * super-admins: they hold the role with no row, and nobody can revoke it. Only
 * super-admins grant and revoke, never their own super-admin role nor the last
 * one, and only to an existing, verified Candidate account. Every grant and revoke
 * is checked, made and recorded in the Back Office Audit in one transaction, one
 * at a time.
 */
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";
import { backOfficeAccess, BACK_OFFICE_ROLES, isBackOfficeRole, type BackOfficeAccess, type BackOfficeRole, type PermanentSuperAdmins } from "./access";
import type { BackOffice, BackOfficeChange } from "./back-office";

/** A signed-in person, as the Back Office sees them. */
export interface Person {
  /** Their Candidate id. */
  id: string;
  email: string;
  emailVerified: boolean;
}

/** What a person may do in the Back Office. */
export interface AdministratorAccess extends BackOfficeAccess {
  /** Listed in ADMIN_EMAILS: a super-admin nobody can revoke. */
  permanent: boolean;
}

export interface AdministratorsDeps {
  backOffice: Pick<BackOffice, "record">;
  /** The permanent super-admins (ADMIN_EMAILS). */
  isPermanentSuperAdmin: PermanentSuperAdmins;
}

/** One Administrator, as the Administrateurs page lists them. */
export interface Administrator {
  candidateId: string;
  email: string;
  roles: BackOfficeRole[];
  /** Listed in ADMIN_EMAILS: a super-admin nobody can revoke. */
  permanent: boolean;
}

type GrantError = "forbidden" | "no_role" | "unknown_account" | "unverified_account";
type RevokeError = "forbidden" | "own_super_admin" | "permanent" | "last_super_admin";
export type GrantResult = { ok: true } | { ok: false; error: GrantError };
export type RevokeResult = { ok: true } | { ok: false; error: RevokeError };

/** What a grant or revoke's transaction did: refused, or changed one account's roles. */
type Outcome<Error> = { refused: Error } | { email: string; before: BackOfficeRole[]; after: BackOfficeRole[] };

interface AccountRow {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface Administrators {
  /** What `person` may do in the Back Office now. Never cached: a revoked role is gone on the next request. */
  access(person: Person): Promise<AdministratorAccess>;
  /** Every Administrator with an account, by email. */
  list(): Promise<Administrator[]>;
  /**
   * `actor` gives `roles` (untrusted: unknown ones are ignored) to the Candidate account
   * with `email`, on top of those they hold. Super-admins only; an email with no account,
   * or not verified, is refused, nothing is kept for later.
   */
  grant(actor: Person, email: string, roles: readonly unknown[]): Promise<GrantResult>;
  /**
   * `actor` takes `role` (untrusted) from the Candidate `candidateId`; a role they do not
   * hold changes nothing. Super-admins only, never their own super-admin role, never
   * an ADMIN_EMAILS member's, never the last super-admin's.
   */
  revoke(actor: Person, candidateId: string, role: unknown): Promise<RevokeResult>;
}

/** Roles in their canonical order, each once. */
const inOrder = (roles: Iterable<string>): BackOfficeRole[] => {
  const held = new Set(roles);
  return BACK_OFFICE_ROLES.filter((role) => held.has(role));
};

/** The roles a Candidate holds as recorded in the Back Office Audit: null for none. */
const recorded = (roles: readonly BackOfficeRole[]) => (roles.length === 0 ? null : { roles: [...roles] });

/** The change to a Candidate's roles, for the Back Office Audit; null when nothing changed. */
function rolesChange(email: string, before: BackOfficeRole[], after: BackOfficeRole[]): BackOfficeChange | null {
  if (before.join() === after.join()) return null;
  const action = before.length === 0 ? "added" : after.length === 0 ? "retired" : "updated";
  return { section: "roles", target: email, action, before: recorded(before), after: recorded(after) };
}

export function createAdministrators(database: Pool, deps: AdministratorsDeps): Administrators {
  async function storedRoles(candidateId: string, within: Queryable = database): Promise<BackOfficeRole[]> {
    const { rows } = await within.query<{ role: string }>("SELECT role FROM administrator_role WHERE candidate_id = $1", [candidateId]);
    // A role since dropped from the code grants nothing.
    return inOrder(rows.map((row) => row.role));
  }

  /**
   * Inside a grant or revoke's transaction: waits for every other change of roles to
   * finish (one at a time, so two super-admins revoking each other cannot both succeed),
   * locks the actor's account (and `others`), and says whether the actor is a
   * super-admin now, as recorded.
   */
  async function isSuperAdminWithin(within: Queryable, actorId: string, ...others: string[]): Promise<boolean> {
    await within.query("SELECT pg_advisory_xact_lock(hashtext('administrator_role'))");
    const { rows } = await within.query<AccountRow>(`SELECT id, email, "emailVerified" FROM candidate WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, [
      [actorId, ...others],
    ]);
    const actor = rows.find((row) => row.id === actorId);
    if (!actor?.emailVerified) return false;
    return deps.isPermanentSuperAdmin(actor) || (await storedRoles(actorId, within)).includes("super-admin");
  }

  /** How many super-admins there are: those with the role recorded and the ADMIN_EMAILS members with an account, all with a verified email. */
  async function superAdminCount(within: Queryable): Promise<number> {
    const { rows } = await within.query<{ count: string }>(
      `SELECT count(*) FROM candidate c
       WHERE c."emailVerified"
         AND (lower(c.email) = ANY($1::text[]) OR EXISTS (SELECT 1 FROM administrator_role r WHERE r.candidate_id = c.id AND r.role = 'super-admin'))`,
      [deps.isPermanentSuperAdmin.emails],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function access(person: Person): Promise<AdministratorAccess> {
    const permanent = deps.isPermanentSuperAdmin(person);
    // Roles count only for a verified email, as ADMIN_EMAILS does.
    const stored = person.emailVerified ? await storedRoles(person.id) : [];
    return { ...backOfficeAccess(permanent ? [...stored, "super-admin"] : stored), permanent };
  }

  return {
    access,

    async list() {
      const { rows } = await database.query<{ id: string; email: string; emailVerified: boolean; roles: string[] }>(
        `SELECT c.id, lower(c.email) AS email, c."emailVerified", coalesce(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
         FROM candidate c LEFT JOIN administrator_role r ON r.candidate_id = c.id
         WHERE r.role IS NOT NULL OR (c."emailVerified" AND lower(c.email) = ANY($1::text[]))
         GROUP BY c.id ORDER BY lower(c.email)`,
        [deps.isPermanentSuperAdmin.emails],
      );
      return rows
        .map((row) => {
          const permanent = deps.isPermanentSuperAdmin(row);
          return { candidateId: row.id, email: row.email, roles: inOrder(permanent ? [...row.roles, "super-admin"] : row.roles), permanent };
        })
        .filter((administrator) => administrator.roles.length > 0);
    },

    async grant(actor, email, requested) {
      const roles = inOrder(requested.filter(isBackOfficeRole));
      if (roles.length === 0) return { ok: false, error: "no_role" };

      const outcome = await deps.backOffice.record(
        actor,
        async (within): Promise<Outcome<GrantError>> => {
          if (!(await isSuperAdminWithin(within, actor.id))) return { refused: "forbidden" };
          const { rows } = await within.query<AccountRow>(`SELECT id, email, "emailVerified" FROM candidate WHERE lower(email) = lower($1) FOR UPDATE`, [email.trim()]);
          const account = rows[0];
          if (!account) return { refused: "unknown_account" };
          // Roles count only for a verified email: a grant to anyone else would give nothing, yet.
          if (!account.emailVerified) return { refused: "unverified_account" };
          const before = await storedRoles(account.id, within);
          await within.query(
            `INSERT INTO administrator_role (candidate_id, role, granted_by)
             SELECT $1, role, $3 FROM unnest($2::text[]) AS role
             ON CONFLICT (candidate_id, role) DO NOTHING`,
            [account.id, roles, actor.id],
          );
          return { email: account.email.toLowerCase(), before, after: inOrder([...before, ...roles]) };
        },
        (done) => ("refused" in done ? null : rolesChange(done.email, done.before, done.after)),
      );
      return "refused" in outcome ? { ok: false, error: outcome.refused } : { ok: true };
    },

    async revoke(actor, candidateId, role) {
      const outcome = await deps.backOffice.record(
        actor,
        async (within): Promise<Outcome<RevokeError> | null> => {
          if (!(await isSuperAdminWithin(within, actor.id, candidateId))) return { refused: "forbidden" };
          if (!isBackOfficeRole(role)) return null;
          const { rows } = await within.query<AccountRow>(`SELECT id, email, "emailVerified" FROM candidate WHERE id = $1`, [candidateId]);
          const account = rows[0];
          if (!account) return null;
          const before = await storedRoles(candidateId, within);
          if (role === "super-admin") {
            if (deps.isPermanentSuperAdmin(account)) return { refused: "permanent" };
            if (before.includes(role) && (await superAdminCount(within)) <= 1) return { refused: "last_super_admin" };
            if (candidateId === actor.id) return { refused: "own_super_admin" };
          }
          await within.query("DELETE FROM administrator_role WHERE candidate_id = $1 AND role = $2", [candidateId, role]);
          return { email: account.email.toLowerCase(), before, after: before.filter((held) => held !== role) };
        },
        (done) => (done === null || "refused" in done ? null : rolesChange(done.email, done.before, done.after)),
      );
      return outcome !== null && "refused" in outcome ? { ok: false, error: outcome.refused } : { ok: true };
    },
  };
}

/** Creates the Back Office Roles table. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateAdministratorRoles(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS administrator_role (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      role text NOT NULL,
      -- Who granted it, by Candidate id. Not a reference: deleting them must not take the role
      -- away, and the Back Office Audit keeps the lasting record (with their email).
      granted_by text,
      granted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (candidate_id, role)
    );
  `);
}

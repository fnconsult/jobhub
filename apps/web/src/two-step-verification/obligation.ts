/**
 * Who must have Two-step verification (ADR-0075, #665): an Administrator, who holds a Back Office Role or is in
 * ADMIN_EMAILS (not exempt, unlike Require SSO for Administrators), or a Human Coach, whose email matches an active
 * `human_coach` row (ADR-0016). Only a verified email counts, as for the Back Office and the Espace coach. Read afresh
 * on every call, never remembered: a role granted, or a coach added, counts on the next request.
 *
 *   await mustHaveTwoStepVerification(pool, candidateId, adminEmails);
 *   `SELECT ${mustHaveSql("c", "$2")} FROM candidate c WHERE c.id = $1`   // the same rule, inside a larger query
 *
 * Whether the account has a factor is the other half of the decision (hasFactorSql): a session signed in by magic link
 * for an account that must have it and has none can only reach the setup page.
 */
import type { Queryable } from "../database/pool";
import { BACK_OFFICE_ROLES } from "../admin/access";

/** The Back Office Roles, as an SQL list: a role no longer in the code grants nothing. */
const ROLES = BACK_OFFICE_ROLES.map((role) => `'${role}'`).join(", ");

/**
 * The rule as an SQL condition on the Candidate row aliased `candidate`, the ADMIN_EMAILS addresses (lower case) bound
 * to the `adminEmails` parameter (a `text[]`, e.g. "$2").
 */
export function mustHaveSql(candidate: string, adminEmails: string): string {
  return `(${candidate}."emailVerified" AND (
    lower(${candidate}.email) = ANY(${adminEmails}::text[])
    OR EXISTS (SELECT 1 FROM administrator_role r WHERE r.candidate_id = ${candidate}.id AND r.role IN (${ROLES}))
    OR EXISTS (SELECT 1 FROM human_coach h WHERE h.email = lower(${candidate}.email) AND h.retired_at IS NULL)
  ))`;
}

/** Whether the account `candidateId` has a factor, as an SQL condition on the column or expression `candidateId`. */
export function hasFactorSql(candidateId: string): string {
  return `EXISTS (SELECT 1 FROM two_step_verification t WHERE t.candidate_id = ${candidateId} AND t.enabled_at IS NOT NULL)`;
}

/** Whether the Candidate `candidateId` must have Two-step verification now. `adminEmails`: ADMIN_EMAILS, lower case. */
export async function mustHaveTwoStepVerification(database: Queryable, candidateId: string, adminEmails: readonly string[]): Promise<boolean> {
  const { rows } = await database.query<{ must: boolean }>(`SELECT ${mustHaveSql("c", "$2")} AS must FROM candidate c WHERE c.id = $1`, [candidateId, adminEmails]);
  return rows[0]?.must ?? false;
}

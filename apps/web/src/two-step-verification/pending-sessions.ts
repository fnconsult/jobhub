/**
 * Which request comes with a session that must do a step before anything else (ADR-0075), read from its session
 * cookie, for the proxy (src/proxy.ts) to apply the gate (gate.ts) before anything else runs:
 *  - `second_step`: pending since a magic link signed in an account that has Two-step verification;
 *  - `setup`: signed in by magic link for an account that must have it (obligation.ts) and has no factor yet: it sets
 *    one up first. Decided on every request: someone given a Back Office Role, or made a Human Coach, while signed in
 *    is asked on their next request, and the session is marked pending from then on, so that wherever it is read it
 *    is not signed in (auth/server.ts, getCurrentSession). A pending session whose account no longer must have it and
 *    has no factor has nothing left to do: it is let go.
 * A session signed in through a Sign-in Provider never has a step to do (both steps, ADR-0075): it is remembered (a
 * bounded number of them), so the database is asked once for it. No cookie, no question.
 */
import { getSessionCookie } from "better-auth/cookies";
import type { Pool } from "pg";
import { MAGIC_LINK } from "../sign-in-providers/catalog";
import { hasFactorSql, mustHaveSql } from "./obligation";

/** What a session must do before anything else: its second step, or set up Two-step verification first. */
export type PendingStep = "second_step" | "setup";

export interface PendingSession {
  sessionId: string;
  candidateId: string;
  step: PendingStep;
}

export interface PendingSessions {
  /** The step the session of the request's cookie must do; null when it has none, or no session. */
  of(headers: Headers): Promise<PendingSession | null>;
}

/** The session's token in its cookie's value: `token.signature`, maybe URL-encoded. */
function tokenOf(cookie: string): string {
  let value = cookie;
  try {
    value = decodeURIComponent(cookie);
  } catch {
    // Not encoded.
  }
  const dot = value.lastIndexOf(".");
  return dot > 0 ? value.slice(0, dot) : value;
}

interface Row {
  id: string;
  userId: string;
  pending: boolean | null;
  method: string | null;
  has_factor: boolean;
  must: boolean;
}

/** The step a session has to do, from what its row says. A session signed in before `signInMethod` was kept counts as a magic link's. */
function stepOf(row: Row): PendingStep | null {
  if (row.pending) return row.has_factor ? "second_step" : row.must ? "setup" : null;
  const byMagicLink = row.method === null || row.method === MAGIC_LINK;
  return byMagicLink && row.must && !row.has_factor ? "setup" : null;
}

/**
 * `adminEmails`: the ADMIN_EMAILS addresses, lower case (permanentSuperAdminsFromEnv). `remembered`: how many
 * sessions signed in through a provider are remembered.
 */
export function createPendingSessions(database: Pick<Pool, "query">, options: { adminEmails?: readonly string[]; remembered?: number } = {}): PendingSessions {
  const limit = options.remembered ?? 10_000;
  const adminEmails = options.adminEmails ?? [];
  /** Tokens of sessions signed in through a Sign-in Provider: they never have a step to do. */
  const settled = new Set<string>();

  return {
    async of(headers) {
      const cookie = getSessionCookie(headers);
      if (!cookie) return null;
      const token = tokenOf(cookie);
      if (settled.has(token)) return null;
      const { rows } = await database.query<Row>(
        `SELECT s.id, s."userId", s."twoStepPending" AS pending, s."signInMethod" AS method,
                ${hasFactorSql('s."userId"')} AS has_factor, ${mustHaveSql("c", "$2")} AS must
           FROM session s JOIN candidate c ON c.id = s."userId"
          WHERE s.token = $1 AND s."expiresAt" > now()`,
        [token, adminEmails],
      );
      const row = rows[0];
      if (!row) return null;
      const step = stepOf(row);
      if (step && !row.pending) await database.query(`UPDATE session SET "twoStepPending" = true WHERE id = $1`, [row.id]);
      if (!step && row.pending) await database.query(`UPDATE session SET "twoStepPending" = false WHERE id = $1`, [row.id]);
      if (step) return { sessionId: row.id, candidateId: row.userId, step };
      if (row.method !== null && row.method !== MAGIC_LINK) {
        if (settled.size >= limit) settled.delete(settled.values().next().value!);
        settled.add(token);
      }
      return null;
    },
  };
}

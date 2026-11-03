/**
 * Which request comes with a session pending its second step (ADR-0075), read from its session cookie, for the proxy
 * (src/proxy.ts) to apply the gate (gate.ts) before anything else runs. A session is pending from its sign-in until its
 * second step is done, never again afterwards: a session found not pending is remembered (a bounded number of them),
 * so the database is asked once per session, then only while it is pending. No cookie, no question.
 */
import { getSessionCookie } from "better-auth/cookies";
import type { Pool } from "pg";

export interface PendingSession {
  sessionId: string;
  candidateId: string;
}

export interface PendingSessions {
  /** The pending session the request's cookie is for; null when it has none, or one that is not pending. */
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

export function createPendingSessions(database: Pick<Pool, "query">, options: { remembered?: number } = {}): PendingSessions {
  const limit = options.remembered ?? 10_000;
  /** Tokens of sessions found not pending: they never are again. */
  const settled = new Set<string>();

  return {
    async of(headers) {
      const cookie = getSessionCookie(headers);
      if (!cookie) return null;
      const token = tokenOf(cookie);
      if (settled.has(token)) return null;
      const { rows } = await database.query<{ id: string; userId: string; twoStepPending: boolean | null }>(
        `SELECT id, "userId", "twoStepPending" FROM session WHERE token = $1 AND "expiresAt" > now()`,
        [token],
      );
      const row = rows[0];
      if (!row) return null;
      if (row.twoStepPending) return { sessionId: row.id, candidateId: row.userId };
      if (settled.size >= limit) settled.delete(settled.values().next().value!);
      settled.add(token);
      return null;
    },
  };
}

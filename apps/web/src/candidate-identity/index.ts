/**
 * What the AI layer knows of a Candidate's identity, to take it out of each of their AI calls before it
 * leaves (redaction, ADR-0007 amendment of 2026-10-20): their account's name and email, and the identity
 * block of their latest Master CV, any Profile (full name, email, phone, and its location when it holds a
 * digit: a postal address, not a bare city that the career also names). A Master CV has no links field,
 * so no link is known: a link is only redacted when it holds an email address.
 *
 *   createAiLayerFromEnv(env, { identityOf: candidateIdentityOf(database) });
 *
 * Read for each call (the AI layer keeps it a minute). The AI layer never lets it fail a call: a lookup
 * that throws is warned about and the call is redacted by shape alone (emails, phone numbers).
 */
import { givenNameOf, type CandidateIdentity } from "@jobhub/ai";
import type { Queryable } from "../database/pool";

interface IdentityRow {
  name: string | null;
  email: string | null;
  /** The latest Master CV version's content, as stored (JSON); null without a Profile. */
  cv: Record<string, unknown> | null;
}

const text = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const distinct = (...values: string[]): string[] => [...new Set(values.filter(Boolean))];

/** The Candidate's identity as the AI layer's `identityOf` takes it; null for an id with no account. */
export function candidateIdentityOf(database: Queryable): (candidateId: string) => Promise<CandidateIdentity | null> {
  return async (candidateId) => {
    const { rows } = await database.query<IdentityRow>(
      `SELECT c.name, c.email,
              (SELECT v.content FROM master_cv_version v JOIN profile p ON p.id = v.profile_id
                WHERE p.candidate_id = c.id ORDER BY v.created_at DESC, v.version DESC LIMIT 1) AS cv
         FROM candidate c WHERE c.id = $1`,
      [candidateId],
    );
    const row = rows[0];
    if (!row) return null;
    const cv = row.cv ?? {};
    const cvName = text(cv.fullName);
    const accountName = text(row.name);
    const location = text(cv.location);
    // The first name stays in calls (the AI Coach uses it); it tells the last name apart within a full name.
    const firstName = givenNameOf([accountName, cvName].find((name) => name.includes(" ")) ?? (cvName || accountName));
    return {
      fullName: distinct(cvName, accountName),
      ...(firstName ? { firstName } : {}),
      email: distinct(text(row.email), text(cv.email)),
      phone: distinct(text(cv.phone)),
      address: /\d/.test(location) ? [location] : [],
    };
  };
}

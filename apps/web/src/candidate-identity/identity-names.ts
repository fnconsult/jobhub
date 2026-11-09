/**
 * The Candidate's Given Name, Family Name and Preferred Name (#918), kept on their account (`candidate`, as Better
 * Auth's additional fields, which only this module writes). One small module in front of Postgres:
 *  - `of` the three, null each that is empty;
 *  - `save` the three at once, from Mon compte › Identité: trimmed, an empty one cleared, none past
 *    IDENTITY_NAME_MAX_LENGTH; the account's `name`, which everything else reads, follows as « Prénom Nom »;
 *  - `migrateIdentityNames`: once, at the deployment that brings them, the names of the accounts there are worked
 *    out of the account's name, else their latest Master CV's full name (`backfillIdentityNames`).
 * The Data export reads them with the rest of the account (candidate-data).
 */
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
import { cleanName, fullNameOf, IDENTITY_NAME_MAX_LENGTH, namesFromFullName } from "./names";

export interface Names {
  givenName: string | null;
  familyName: string | null;
  preferredName: string | null;
}

export type NameField = keyof Names;

export const NAME_FIELDS: readonly NameField[] = ["givenName", "familyName", "preferredName"];

export type SaveNamesResult = { ok: true; names: Names } | { ok: false; field: NameField };

export interface IdentityNames {
  /** The Candidate's names; null for an id with no account. */
  of(candidateId: string): Promise<Names | null>;
  /** Replaces the three (an empty one is cleared) and sets the account's name to « Prénom Nom ». Refuses a name too long, saving nothing. */
  save(candidateId: string, names: Record<NameField, string>): Promise<SaveNamesResult>;
}

const NAME_COLUMNS = `given_name AS "givenName", family_name AS "familyName", preferred_name AS "preferredName"`;

export function createIdentityNames(database: Queryable): IdentityNames {
  return {
    async of(candidateId) {
      const { rows } = await database.query<Names>(`SELECT ${NAME_COLUMNS} FROM candidate WHERE id = $1`, [candidateId]);
      return rows[0] ?? null;
    },
    async save(candidateId, entered) {
      const names = { givenName: null, familyName: null, preferredName: null } as Names;
      for (const field of NAME_FIELDS) {
        const name = cleanName(entered[field]);
        if (name.length > IDENTITY_NAME_MAX_LENGTH) return { ok: false, field };
        names[field] = name || null;
      }
      await database.query(`UPDATE candidate SET given_name = $2, family_name = $3, preferred_name = $4, name = $5, "updatedAt" = now() WHERE id = $1`, [
        candidateId,
        names.givenName,
        names.familyName,
        names.preferredName,
        fullNameOf(names),
      ]);
      return { ok: true, names };
    },
  };
}

interface BackfillRow extends Names {
  id: string;
  name: string | null;
  /** The latest Master CV version's full name; null without a Profile. */
  cvName: string | null;
}

/**
 * Fills in the names of each account missing some, from its name, else its latest Master CV's full name
 * (`namesFromFullName`: « DUPONT Marie » gives Marie, Dupont); the Preferred Name is the Given Name. A name already
 * there is kept; the account's name becomes « Prénom Nom ». Returns how many accounts changed: run again, none.
 */
export async function backfillIdentityNames(database: Queryable): Promise<number> {
  const { rows } = await database.query<BackfillRow>(
    `SELECT c.id, c.name, ${NAME_COLUMNS},
            (SELECT v.content ->> 'fullName' FROM master_cv_version v JOIN profile p ON p.id = v.profile_id
              WHERE p.candidate_id = c.id ORDER BY v.created_at DESC, v.version DESC LIMIT 1) AS "cvName"
       FROM candidate c
      WHERE c.given_name IS NULL OR c.family_name IS NULL OR c.preferred_name IS NULL`,
  );
  let changed = 0;
  for (const row of rows) {
    const found = namesFromFullName(cleanName(row.name ?? "") || cleanName(row.cvName ?? ""));
    const givenName = row.givenName ?? (found.givenName || null);
    const names: Names = { givenName, familyName: row.familyName ?? (found.familyName || null), preferredName: row.preferredName ?? givenName };
    if (NAME_FIELDS.every((field) => names[field] === row[field])) continue;
    await database.query(`UPDATE candidate SET given_name = $2, family_name = $3, preferred_name = $4, name = $5 WHERE id = $1`, [
      row.id,
      names.givenName,
      names.familyName,
      names.preferredName,
      fullNameOf(names),
    ]);
    changed++;
  }
  return changed;
}

/**
 * Works out the names of the accounts there are, once (`backfillIdentityNames`): run again, it changes nothing, so a
 * name the Candidate cleared stays cleared. Run after Candidate accounts and Profiles. Safe to run repeatedly.
 */
export async function migrateIdentityNames(database: Pool): Promise<void> {
  await database.query(`
    -- When the names of the accounts there were were worked out (#918): one row, once.
    CREATE TABLE IF NOT EXISTS identity_names_backfill (
      once boolean PRIMARY KEY DEFAULT true CHECK (once),
      done_at timestamptz NOT NULL
    );
  `);
  await inTransaction(database, async (client) => {
    const { rowCount } = await client.query(`INSERT INTO identity_names_backfill (done_at) VALUES (now()) ON CONFLICT DO NOTHING`);
    if (rowCount === 1) await backfillIdentityNames(client);
  });
}

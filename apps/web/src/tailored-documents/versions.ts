/**
 * Tailored Document Versions (#1079): the saved states of an Application's Tailored CV, Cover Letter and Outreach
 * Message, as Master CV Versions are a Master CV's, so that no change ever loses the text before it.
 *
 * One deep module in front of Postgres. The documents stay where they are (`tailored_document`, `tailored_cv.saved`):
 * each change made to one there, in its own transaction, then calls `keepVersion`, which copies the document as it now
 * stands into `tailored_document_version` as its next version. Callers get
 * `createTailoredDocumentVersions(database, { applications })`:
 *  - `list` an Application's versions, newest first per document, the current one marked;
 *  - `restore` an earlier version: its content becomes the document's again, as a new version.
 *
 * Rules kept here:
 *  - Every change of a document's text keeps a version: a drafting or a new drafting by the AI Coach, a Tailored CV
 *    proposal saved once reviewed, a Coach proposal applied (ADR-0109) and its « Annuler », the Candidate's save, a
 *    Restore. One save is one version; a save that changes nothing makes none.
 *  - Each version keeps its date, where it came from (`VersionSource`), its Document Language and, for an Outreach
 *    Message, its subject.
 *  - A Restore never deletes anything: it saves the earlier content as a new version (`restoredFrom`). Restoring the
 *    current version changes nothing. From a version seen (a Coach proposal's card), a document changed since is a conflict.
 *  - Each document keeps its last MAX_DOCUMENT_VERSIONS versions: past it, the oldest goes first.
 *  - Versions live with their Application (deleted with it, and so with the account) and are in the Data export.
 * Every read and change is scoped to the Candidate; inputs are untrusted and problems come back as results.
 */
import { readProvenance, type CvContent, type DocumentLanguage, type Provenance } from "@jobhub/shared";
import type { Pool, PoolClient } from "pg";
import { isDeepStrictEqual } from "node:util";
import * as z from "zod";
import type { Applications } from "../applications";
import { inTransaction } from "../database/pool";
import type { Origin } from "../origin";
import { fieldErrors, type FieldError } from "../validation";
import { MAX_DOCUMENT_VERSIONS, VERSIONED_DOCUMENTS, VERSION_SOURCES, type VersionedDocument, type VersionSource } from "./kinds";

/** One saved state of a Tailored Document. */
export interface TailoredDocumentVersion {
  /** Numbered from 1 per document; the highest is the current one. */
  version: number;
  savedAt: Date;
  source: VersionSource;
  /** The earlier version a Restore saved again, else null. */
  restoredFrom: number | null;
  /** The document as it is now. */
  current: boolean;
  language: DocumentLanguage;
  /** An Outreach Message's subject; null for a Cover Letter or a Tailored CV. */
  subject: string | null;
  /** A Cover Letter's or Outreach Message's text; null for a Tailored CV. */
  text: string | null;
  /** A Tailored CV's content; null for a Cover Letter or an Outreach Message. */
  cv: CvContent | null;
  /** What served the drafting it keeps (ADR-0034), as the document kept it; null when none was kept. */
  provenance: Provenance | null;
}

/** Each document's versions, newest first; empty when the document has none. */
export type DocumentVersions = Record<VersionedDocument, TailoredDocumentVersion[]>;

export type RestoreVersionResult =
  /** `version`: the document's version now (the new one, or the one restored when it was already current); `before`, the one current before. */
  | { ok: true; version: number; before: number }
  | { ok: false; errors: FieldError[] }
  /** No such Application for this Candidate, or no such version of that document (dropped past the limit included). */
  | { ok: false; error: "not_found" }
  /** The document changed since the version seen (`options.current`): nothing was restored. */
  | { ok: false; error: "conflict" };

/**
 * How a Restore runs: from the current version seen (`current`; changed since, a conflict) and, applied from a Coach
 * proposal's card, keeping its Origin on a Cover Letter or an Outreach Message.
 */
export interface RestoreOptions {
  current?: number;
  origin?: Origin | null;
}

export interface TailoredDocumentVersions {
  /** The Application's versions, or null if it does not exist or belongs to someone else. */
  list(candidateId: string, applicationId: string): Promise<DocumentVersions | null>;
  /** Makes an earlier version current again, as a new version. `input`: { document, version }. */
  restore(candidateId: string, applicationId: string, input: unknown, options?: RestoreOptions): Promise<RestoreVersionResult>;
}

export interface TailoredDocumentVersionsDeps {
  applications: Pick<Applications, "get">;
}

const restoreSchema = z.object({ document: z.enum(VERSIONED_DOCUMENTS), version: z.number().int().min(1) });

/** A Cover Letter or Outreach Message as kept in a version: everything its row holds that a Restore puts back. */
interface DraftSnapshot {
  text: string;
  subject: string;
  channel: string | null;
  contactRoles: string[];
  contact: unknown;
  draftedAt: string;
  provenance: unknown;
  origin: unknown;
}

/** A Tailored CV as kept in a version: the saved one, as `tailored_cv.saved` holds it. */
interface CvSnapshot {
  language: DocumentLanguage;
  content: CvContent;
  savedAt: string;
  provenance?: unknown;
  [key: string]: unknown;
}

type Snapshot = DraftSnapshot | CvSnapshot;

interface VersionRow {
  document: VersionedDocument;
  version: number;
  saved_at: Date;
  source: VersionSource;
  restored_from: number | null;
  language: DocumentLanguage;
  snapshot: Snapshot;
}

const NOT_FOUND = { ok: false, error: "not_found" } as const;

/** The document as it stands, with its language, read under the caller's lock; null when there is none. */
async function currentOf(client: Pick<PoolClient, "query">, applicationId: string, document: VersionedDocument): Promise<{ language: DocumentLanguage; snapshot: Snapshot } | null> {
  if (document === "tailored_cv") {
    const { rows } = await client.query<{ saved: CvSnapshot | null }>(`SELECT saved FROM tailored_cv WHERE application_id = $1`, [applicationId]);
    const saved = rows[0]?.saved;
    return saved ? { language: saved.language, snapshot: saved } : null;
  }
  const { rows } = await client.query<{
    language: DocumentLanguage;
    text: string;
    subject: string;
    channel: string | null;
    contact_roles: string[];
    contact: unknown;
    drafted_at: Date;
    provenance: unknown;
    origin: unknown;
  }>(`SELECT language, text, subject, channel, contact_roles, contact, drafted_at, provenance, origin FROM tailored_document WHERE application_id = $1 AND kind = $2`, [
    applicationId,
    document,
  ]);
  const row = rows[0];
  if (!row) return null;
  return {
    language: row.language,
    snapshot: {
      text: row.text,
      subject: row.subject,
      channel: row.channel,
      contactRoles: row.contact_roles,
      contact: row.contact,
      draftedAt: row.drafted_at.toISOString(),
      provenance: row.provenance,
      origin: row.origin,
    },
  };
}

/** What makes two versions of a document the same: its language and content, not when it was saved nor what served it. */
function essence(document: VersionedDocument, language: DocumentLanguage, snapshot: Snapshot): unknown {
  if (document === "tailored_cv") return { language, content: (snapshot as CvSnapshot).content };
  const { text, subject, channel, contactRoles, contact } = snapshot as DraftSnapshot;
  return { language, text, subject, channel: channel ?? null, contactRoles: contactRoles ?? [], contact: contact ?? null };
}

/** The number of the latest version kept of a document (its current one), 0 when it has none. Call it under the document's lock. */
export async function latestVersion(client: Pick<PoolClient, "query">, applicationId: string, document: VersionedDocument): Promise<number> {
  return (await latestOf(client, applicationId, document))?.version ?? 0;
}

/** The latest version kept of a document, or null. */
async function latestOf(client: Pick<PoolClient, "query">, applicationId: string, document: VersionedDocument) {
  const { rows } = await client.query<Pick<VersionRow, "version" | "language" | "snapshot">>(
    `SELECT version, language, snapshot FROM tailored_document_version WHERE application_id = $1 AND document = $2 ORDER BY version DESC LIMIT 1`,
    [applicationId, document],
  );
  return rows[0] ?? null;
}

/**
 * Keeps the document as it now stands as its next version, unless it is the same as its latest one. Called by each change
 * to a document, in its transaction, once the document's row is written (and so locked). `restoredFrom`: the earlier
 * version a Restore saved again; "previous" for « Annuler », which puts back the version before the latest.
 * Returns the version kept, or null when none was.
 */
export async function keepVersion(
  client: Pick<PoolClient, "query">,
  applicationId: string,
  document: VersionedDocument,
  { source, restoredFrom = null }: { source: VersionSource; restoredFrom?: number | "previous" | null },
): Promise<number | null> {
  const [current, latest] = await Promise.all([currentOf(client, applicationId, document), latestOf(client, applicationId, document)]);
  if (!current) return null;
  if (latest && isDeepStrictEqual(essence(document, latest.language, latest.snapshot), essence(document, current.language, current.snapshot))) return null;
  const version = (latest?.version ?? 0) + 1;
  const from = restoredFrom === "previous" ? (latest && latest.version > 1 ? latest.version - 1 : null) : restoredFrom;
  await client.query(
    `INSERT INTO tailored_document_version (application_id, document, version, source, restored_from, language, snapshot) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [applicationId, document, version, source, from, current.language, JSON.stringify(current.snapshot)],
  );
  // The last MAX_DOCUMENT_VERSIONS only: the oldest goes first.
  await client.query(`DELETE FROM tailored_document_version WHERE application_id = $1 AND document = $2 AND version <= $3`, [applicationId, document, version - MAX_DOCUMENT_VERSIONS]);
  return version;
}

/** A kept version as the Candidate reads it. */
function versionOf(row: VersionRow, current: boolean): TailoredDocumentVersion {
  const cv = row.document === "tailored_cv" ? (row.snapshot as CvSnapshot) : null;
  const draft = row.document === "tailored_cv" ? null : (row.snapshot as DraftSnapshot);
  return {
    version: row.version,
    savedAt: row.saved_at,
    source: row.source,
    restoredFrom: row.restored_from,
    current,
    language: row.language,
    subject: row.document === "outreach_message" ? (draft?.subject ?? "") : null,
    text: draft ? draft.text : null,
    cv: cv ? cv.content : null,
    provenance: readProvenance(row.snapshot.provenance),
  };
}

export function createTailoredDocumentVersions(database: Pool, deps: TailoredDocumentVersionsDeps): TailoredDocumentVersions {
  /** Puts `snapshot` back as the document's content, under the lock taken. */
  async function write(client: PoolClient, applicationId: string, document: VersionedDocument, language: DocumentLanguage, snapshot: Snapshot, origin: Origin | null) {
    if (document === "tailored_cv") {
      // Saved again now: the Tailored CV says the day it was restored, and keeps no Origin but the one restoring it (ADR-0113).
      const saved: CvSnapshot = { ...(snapshot as CvSnapshot), savedAt: new Date().toISOString() };
      delete saved.origin;
      if (origin) saved.origin = { ...origin, appliedAt: origin.appliedAt.toISOString() };
      await client.query(`UPDATE tailored_cv SET saved = $2 WHERE application_id = $1`, [applicationId, saved]);
      return;
    }
    const draft = snapshot as DraftSnapshot;
    await client.query(
      `UPDATE tailored_document SET language = $3, text = $4, subject = $5, channel = $6, contact_roles = $7, contact = $8, drafted_at = $9, provenance = $10, origin = $11, updated_at = now()
       WHERE application_id = $1 AND kind = $2`,
      [
        applicationId,
        document,
        language,
        draft.text,
        draft.subject,
        draft.channel,
        draft.contactRoles ?? [],
        draft.contact === null || draft.contact === undefined ? null : JSON.stringify(draft.contact),
        draft.draftedAt,
        draft.provenance === null || draft.provenance === undefined ? null : JSON.stringify(draft.provenance),
        origin ? JSON.stringify({ ...origin, appliedAt: origin.appliedAt.toISOString() }) : null,
      ],
    );
  }

  /** Takes the document's row lock: two changes to one document are kept one after the other. False when there is no document. */
  async function lock(client: PoolClient, applicationId: string, document: VersionedDocument): Promise<boolean> {
    const { rowCount } =
      document === "tailored_cv"
        ? await client.query(`SELECT 1 FROM tailored_cv WHERE application_id = $1 AND saved IS NOT NULL FOR UPDATE`, [applicationId])
        : await client.query(`SELECT 1 FROM tailored_document WHERE application_id = $1 AND kind = $2 FOR UPDATE`, [applicationId, document]);
    return (rowCount ?? 0) > 0;
  }

  return {
    async list(candidateId, applicationId) {
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return null;
      const { rows } = await database.query<VersionRow>(
        `SELECT document, version, saved_at, source, restored_from, language, snapshot FROM tailored_document_version WHERE application_id = $1 ORDER BY document, version DESC`,
        [application.id],
      );
      const versions: DocumentVersions = { tailored_cv: [], cover_letter: [], outreach_message: [] };
      for (const row of rows) versions[row.document].push(versionOf(row, versions[row.document].length === 0));
      return versions;
    },

    async restore(candidateId, applicationId, input, options = {}) {
      const parsed = restoreSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const application = await deps.applications.get(candidateId, applicationId);
      if (!application) return NOT_FOUND;
      const { document, version } = parsed.data;
      return inTransaction(database, async (client): Promise<RestoreVersionResult> => {
        if (!(await lock(client, application.id, document))) return NOT_FOUND;
        const { rows } = await client.query<VersionRow>(
          `SELECT document, version, saved_at, source, restored_from, language, snapshot FROM tailored_document_version WHERE application_id = $1 AND document = $2 AND version = $3`,
          [application.id, document, version],
        );
        const wanted = rows[0];
        if (!wanted) return NOT_FOUND;
        const latest = await latestOf(client, application.id, document);
        const before = latest?.version ?? 0;
        if (options.current !== undefined && options.current !== before) return { ok: false, error: "conflict" };
        const current = await currentOf(client, application.id, document);
        if (current && isDeepStrictEqual(essence(document, wanted.language, wanted.snapshot), essence(document, current.language, current.snapshot))) return { ok: true, version: before, before };
        await write(client, application.id, document, wanted.language, wanted.snapshot, options.origin ?? null);
        const kept = await keepVersion(client, application.id, document, { source: "restored", restoredFrom: version });
        return { ok: true, version: kept ?? before, before };
      });
    },
  };
}

/**
 * Creates the Tailored Document Version table, then makes each document that has no version yet its version 1: the
 * Cover Letters and Outreach Messages (and the saved Tailored CVs, once their table exists) as they stand. Run after
 * migrateTailoredDocuments and migrateTailoredCvs, which call it too. Safe to run repeatedly.
 */
export async function migrateTailoredDocumentVersions(database: Pool): Promise<void> {
  const documents = VERSIONED_DOCUMENTS.map((document) => `'${document}'`).join(", ");
  const sources = VERSION_SOURCES.map((source) => `'${source}'`).join(", ");
  await database.query(`
    CREATE TABLE IF NOT EXISTS tailored_document_version (
      application_id uuid NOT NULL REFERENCES application (id) ON DELETE CASCADE,
      document text NOT NULL CHECK (document IN (${documents})),
      version integer NOT NULL CHECK (version >= 1),
      saved_at timestamptz NOT NULL DEFAULT now(),
      source text NOT NULL CHECK (source IN (${sources})),
      restored_from integer,
      language text NOT NULL,
      -- The document as it stood: what a Restore puts back.
      snapshot jsonb NOT NULL,
      PRIMARY KEY (application_id, document, version)
    );
  `);
  // A Cover Letter or Outreach Message with no version: its version 1, from a Coach proposal applied (it keeps its
  // Origin), changed by the Candidate after its drafting, or as drafted.
  await database.query(`
    INSERT INTO tailored_document_version (application_id, document, version, saved_at, source, language, snapshot)
    SELECT d.application_id, d.kind, 1, d.updated_at,
           CASE WHEN d.origin IS NOT NULL THEN 'coach' WHEN d.updated_at > d.drafted_at + interval '1 second' THEN 'candidate' ELSE 'drafted' END,
           d.language,
           jsonb_build_object('text', d.text, 'subject', d.subject, 'channel', d.channel, 'contactRoles', to_jsonb(d.contact_roles), 'contact', d.contact,
                              'draftedAt', to_jsonb(d.drafted_at), 'provenance', d.provenance, 'origin', d.origin)
    FROM tailored_document d
    WHERE NOT EXISTS (SELECT 1 FROM tailored_document_version v WHERE v.application_id = d.application_id AND v.document = d.kind)
  `);
  const { rows } = await database.query<{ exists: boolean }>(`SELECT to_regclass('tailored_cv') IS NOT NULL AS exists`);
  if (!rows[0]?.exists) return;
  // A saved Tailored CV with no version: its version 1, as the proposal it was saved from was written by the AI Coach.
  await database.query(`
    INSERT INTO tailored_document_version (application_id, document, version, saved_at, source, language, snapshot)
    SELECT t.application_id, 'tailored_cv', 1, COALESCE((t.saved->>'savedAt')::timestamptz, now()), 'drafted', t.saved->>'language', t.saved
    FROM tailored_cv t
    WHERE t.saved IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM tailored_document_version v WHERE v.application_id = t.application_id AND v.document = 'tailored_cv')
  `);
}

/**
 * Extension Events (#924, CONTEXT.md): one thing the extension did, recorded for the Back Office. An action (a Capture,
 * a Match Score, a CV draft, a Profile or an Application made from it) or an error (a page that cannot be captured, a
 * failed call, an unexpected failure). Each keeps when, which kind, the Candidate (none for a Guest, and no other
 * identifier of any kind), the Extension Version it stated (EXTENSION_VERSION_HEADER) and, for an action, its object; for
 * an error, its code, message key, route and HTTP status, where it happened, the browser's family and major version, and
 * the page's domain alone. Never a page's address, its text, a stack trace or an IP address.
 *
 * One deep module in front of Postgres:
 *  - `extensionCallFrom(headers, candidateId, webOrigin)`: whether a request is the extension's (its Surface, #919), with
 *    who made it and the Extension Version it states; null for any other Surface, so the web and the app record nothing;
 *  - `recordExtensionAction(within, call, kind, object?)`: the routes the extension calls write their action's row, on
 *    the action's own transaction where it has one (as Consumption is counted);
 *  - `createExtensionEvents(database).record(call, kind, object?)`: the same for an action that saves nothing (a Match
 *    Score, a CV draft), so has no transaction;
 *  - `createExtensionEvents(database).report(call, body, context)`: an error the extension sends (POST
 *    /api/extension/events), checked against its schema (fields outside it, a `url` among them, are dropped), at most
 *    REPORTING_LIMIT per requester within REPORTING_WINDOW_MINUTES, counted in this process only;
 *  - `extensionEventsOf(database, candidateId)`, the Candidate's own for their Data export;
 *  - `purgeExtensionEvents(database, now)`, the worker's, nightly: RETENTION_MONTHS, GUEST_RETENTION_DAYS for a Guest's;
 *  - `migrateExtensionEvents(database)`.
 * Tied to the Candidate: deleted with their account (ON DELETE CASCADE, ADR-0010).
 */
import { readExtensionVersion, EXTENSION_VERSION_HEADER } from "@jobhub/shared";
import type { Pool } from "pg";
import { z } from "zod";
import { utcBefore } from "../database/before";
import type { Queryable } from "../database/pool";
import { requestSurface } from "../request-surface";
import { browserFamilyOf } from "../signalements/context";
import { fieldErrors, type FieldError } from "../validation";

/** The actions an Extension Event records, each written by the route that does it. */
export const EXTENSION_ACTION_KINDS = ["capture", "match_score", "cv_draft", "profile_created", "application_created"] as const;
export type ExtensionActionKind = (typeof EXTENSION_ACTION_KINDS)[number];

export const EXTENSION_EVENT_KINDS = [...EXTENSION_ACTION_KINDS, "error"] as const;
export type ExtensionEventKind = (typeof EXTENSION_EVENT_KINDS)[number];

/** Where in the extension an error happened: its Side Panel, the content script reading a page, or the button it adds to a Job Site's page. */
export const ERROR_PLACES = ["side_panel", "content_script", "page_button"] as const;
export type ErrorPlace = (typeof ERROR_PLACES)[number];

/** What an action made or read. */
export const EVENT_OBJECT_TYPES = ["job_offer", "profile", "application"] as const;
export type EventObjectType = (typeof EVENT_OBJECT_TYPES)[number];
export interface EventObject {
  type: EventObjectType;
  id: string;
}

/** How long an Extension Event is kept. */
export const RETENTION_MONTHS = 12;
/** How long a Guest's (no Candidate) is kept. */
export const GUEST_RETENTION_DAYS = 30;

/** Errors one requester (a Candidate, or a Guest by their address, held in memory only) may report within the window. */
export const REPORTING_LIMIT = 30;
export const REPORTING_WINDOW_MINUTES = 10;

/** A request from the extension, as its route knows it: who made it (null: a Guest) and the Extension Version it states. */
export interface ExtensionCall {
  candidateId: string | null;
  extensionVersion: string | null;
}

/** The extension's call, when the request with `headers` comes from it (its Surface, #919); null for any other. */
export function extensionCallFrom(headers: Headers, candidateId: string | null, webOrigin: string): ExtensionCall | null {
  if (requestSurface(headers, webOrigin) !== "extension") return null;
  return { candidateId, extensionVersion: readExtensionVersion(headers.get(EXTENSION_VERSION_HEADER)) };
}

/** Writes the row of an action done from the extension, on `within`: the action's transaction where it has one. */
export async function recordExtensionAction(within: Queryable, call: ExtensionCall, kind: ExtensionActionKind, object?: EventObject): Promise<void> {
  await within.query(`INSERT INTO extension_event (kind, candidate_id, extension_version, object_type, object_id) VALUES ($1, $2, $3, $4, $5)`, [
    kind,
    call.candidateId,
    call.extensionVersion,
    object?.type ?? null,
    object?.id ?? null,
  ]);
}

/** A stable code or message key: letters, digits, `_`, `.` and `-`, starting with a letter. Never a sentence. */
const code = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/);

/**
 * An error as the extension reports it. Fields outside these are dropped (zod's default), a page's `url` among them:
 * only its domain is kept, and a domain is a host name, never an address.
 */
const reportSchema = z.object({
  errorCode: code,
  messageKey: code.optional(),
  /** The web app's route that failed, as a path; its query and `#…` are cut. */
  route: z
    .string()
    .max(300)
    .transform((route) => route.split(/[?#]/)[0]!)
    .pipe(z.string().regex(/^\/api\/[A-Za-z0-9/_.-]{0,200}$/))
    .optional(),
  /** The HTTP status the call was answered with; 0 for one that was never answered (the network). */
  httpStatus: z.number().int().min(0).max(599).optional(),
  place: z.enum(ERROR_PLACES),
  pageDomain: z
    .string()
    .max(253)
    .transform((domain) => domain.trim().toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}\.)*[a-z0-9-]{1,63}$/))
    .optional(),
});

/** What the request says of where a report comes from: the server's knowledge, never the body's. */
export interface ReportingContext {
  /** The request's User-Agent, read for the browser's family and major version, then dropped. */
  userAgent: string | null;
  /** Who the reporting limit counts against: the Candidate's id, or a Guest's address. Held in memory only, never written. */
  requester: string;
}

export type ReportResult = { ok: true } | { ok: false; errors: FieldError[] } | { ok: false; refused: "too_many" };

export interface ExtensionEvents {
  /** Writes the row of an action that has no transaction of its own (a Match Score, a CV draft: they save nothing). */
  record(call: ExtensionCall, kind: ExtensionActionKind, object?: EventObject): Promise<void>;
  /** Records an error the extension reports (`body`: { errorCode, messageKey?, route?, httpStatus?, place, pageDomain? }). */
  report(call: ExtensionCall, body: unknown, context: ReportingContext): Promise<ReportResult>;
}

export function createExtensionEvents(database: Queryable, { now = () => new Date() }: { now?: () => Date } = {}): ExtensionEvents {
  const reported = new Map<string, number[]>();

  /** Whether `requester` may report one more now; counts it when so. Forgets requesters whose window has passed. */
  function withinLimit(requester: string): boolean {
    const at = now().getTime();
    const windowMs = REPORTING_WINDOW_MINUTES * 60_000;
    for (const [key, times] of reported) if (times.every((time) => at - time >= windowMs)) reported.delete(key);
    const recent = (reported.get(requester) ?? []).filter((time) => at - time < windowMs);
    if (recent.length >= REPORTING_LIMIT) return false;
    reported.set(requester, [...recent, at]);
    return true;
  }

  return {
    record: (call, kind, object) => recordExtensionAction(database, call, kind, object),

    async report(call, body, context) {
      const parsed = reportSchema.safeParse(body, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      if (!withinLimit(context.requester)) return { ok: false, refused: "too_many" };
      const error = parsed.data;
      await database.query(
        `INSERT INTO extension_event (at, kind, candidate_id, extension_version, error_code, message_key, route, http_status, place, browser, page_domain)
         VALUES ($1, 'error', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          now(),
          call.candidateId,
          call.extensionVersion,
          error.errorCode,
          error.messageKey ?? null,
          error.route ?? null,
          error.httpStatus ?? null,
          error.place,
          browserFamilyOf(context.userAgent),
          error.pageDomain ?? null,
        ],
      );
      return { ok: true };
    },
  };
}

/** An Extension Event as the Candidate's Data export holds it. */
export interface ExportedExtensionEvent {
  at: Date;
  kind: ExtensionEventKind;
  extensionVersion: string | null;
  object: EventObject | null;
  error: {
    code: string;
    messageKey: string | null;
    route: string | null;
    httpStatus: number | null;
    place: ErrorPlace | null;
    browser: string | null;
    pageDomain: string | null;
  } | null;
}

interface ExtensionEventRow {
  at: Date;
  kind: ExtensionEventKind;
  extension_version: string | null;
  object_type: EventObjectType | null;
  object_id: string | null;
  error_code: string | null;
  message_key: string | null;
  route: string | null;
  http_status: number | null;
  place: ErrorPlace | null;
  browser: string | null;
  page_domain: string | null;
}

/** The Candidate's Extension Events, newest first: for their Data export. */
export async function extensionEventsOf(database: Queryable, candidateId: string): Promise<ExportedExtensionEvent[]> {
  const { rows } = await database.query<ExtensionEventRow>(
    `SELECT at, kind, extension_version, object_type, object_id, error_code, message_key, route, http_status, place, browser, page_domain
       FROM extension_event WHERE candidate_id = $1 ORDER BY at DESC, id DESC`,
    [candidateId],
  );
  return rows.map((row) => ({
    at: row.at,
    kind: row.kind,
    extensionVersion: row.extension_version,
    object: row.object_type && row.object_id ? { type: row.object_type, id: row.object_id } : null,
    error:
      row.kind === "error"
        ? { code: row.error_code ?? "", messageKey: row.message_key, route: row.route, httpStatus: row.http_status, place: row.place, browser: row.browser, pageDomain: row.page_domain }
        : null,
  }));
}

/** Deletes the Extension Events RETENTION_MONTHS old, and a Guest's GUEST_RETENTION_DAYS old; how many went. */
export async function purgeExtensionEvents(database: Queryable, now: Date): Promise<number> {
  const { rowCount } = await database.query(
    `DELETE FROM extension_event
      WHERE at < ${utcBefore("$1", "make_interval(months => $2)")}
         OR (candidate_id IS NULL AND at < ${utcBefore("$1", "make_interval(days => $3)")})`,
    [now, RETENTION_MONTHS, GUEST_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}

export async function migrateExtensionEvents(database: Pool): Promise<void> {
  const kinds = EXTENSION_EVENT_KINDS.map((kind) => `'${kind}'`).join(", ");
  const places = ERROR_PLACES.map((place) => `'${place}'`).join(", ");
  const objects = EVENT_OBJECT_TYPES.map((type) => `'${type}'`).join(", ");
  await database.query(`
    -- Extension Events (#924): one thing the extension did, for the Back Office. No page address, text, stack or IP;
    -- a Guest's names no one. Kept 12 months, a Guest's 30 days; deleted with the Candidate's account.
    CREATE TABLE IF NOT EXISTS extension_event (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      kind text NOT NULL CHECK (kind IN (${kinds})),
      candidate_id text REFERENCES candidate (id) ON DELETE CASCADE,
      extension_version text,
      object_type text CHECK (object_type IN (${objects})),
      object_id text,
      error_code text,
      message_key text,
      route text,
      http_status integer,
      place text CHECK (place IN (${places})),
      browser text,
      page_domain text,
      CHECK ((kind = 'error') = (error_code IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS extension_event_at ON extension_event (at);
    CREATE INDEX IF NOT EXISTS extension_event_candidate ON extension_event (candidate_id, at) WHERE candidate_id IS NOT NULL;
  `);
}

/**
 * Email intake in the Back Office (#449, ADR-0051): what Activité › Emails reçus and the Journal show of it, naming no
 * Candidate. One deep module in front of two tables of its own, neither tied to a Candidate:
 *
 *   const activity = createEmailIntakeActivity(database);
 *   await activity.receivedEmails(query);   // Activité › Emails reçus, newest first (`query` untrusted: outcome, kind, period)
 *   await activity.linkedMailboxEvents(n);  // the Journal's « Boîtes reliées »: switched on, replaced, off, daily cap reached
 *
 * Email intake writes them as it goes, in the transaction of what they record: `recordReceivedEmail` when an email is
 * taken (inbound.ts), `recordReading` once it is read (the worker, #445), `recordLinkedMailboxEvent` when a Forwarding
 * address is given, replaced or stopped, or a Linked mailbox first reaches its daily cap of the day.
 *
 * A row keeps the date, the sender's domain, whether the Candidate forwarded it by hand, its kind, the offers new and
 * already stored, its outcome and its Guardrail verdict: never the email's content, never who received it. The
 * Candidate's own Received offer email points to its row, not the other way round, so a row outlives the Candidate's
 * account and is not in their Data export. Both tables are kept ACTIVITY_RETENTION_MONTHS (`purgeEmailIntakeActivity`,
 * with Email intake's hourly purge in the worker).
 */
import type { Pool } from "pg";
import * as z from "zod";
import type { Queryable } from "../database/pool";
import type { ReceivedOfferEmailOutcome } from "./inbound";

/** How long the Back Office keeps a row of Emails reçus and a Linked mailbox event. */
export const ACTIVITY_RETENTION_MONTHS = 24;
/** How many rows Emails reçus shows at most. */
export const LIST_LIMIT = 200;

/** What the reading (#445) makes of an email: offers found, « autre » (not an offer), set aside by a Guardrail, or « échec » (its last try failed). */
export const READING_OUTCOMES = ["offers_found", "other", "set_aside_by_guardrail", "failed"] as const;
export type ReadingOutcome = (typeof READING_OUTCOMES)[number];

/** Every outcome of a Received offer email (CONTEXT.md), as Emails reçus filters by it. */
export const RECEIVED_EMAIL_OUTCOMES = [
  "awaiting_reading",
  "offers_found",
  "other",
  "set_aside_by_guardrail",
  "unrecognised_sender",
  "over_daily_cap",
  "forwarding_confirmation",
  "failed",
] as const satisfies readonly (ReceivedOfferEmailOutcome | ReadingOutcome)[];
export type ReceivedEmailOutcome = (typeof RECEIVED_EMAIL_OUTCOMES)[number];

/** What kind of email the reading found it to be: an alert, a recruiter's message, or « autre ». */
export const RECEIVED_EMAIL_KINDS = ["alert", "recruiter", "other"] as const;
export type ReceivedEmailKind = (typeof RECEIVED_EMAIL_KINDS)[number];

/** What the « Contenu piégé dans un email » Guardrail made of the email: let through, flagged or blocked. */
export const EMAIL_GUARDRAIL_VERDICTS = ["passed", "flagged", "blocked"] as const;
export type EmailGuardrailVerdict = (typeof EMAIL_GUARDRAIL_VERDICTS)[number];

/** The periods Emails reçus is filtered by: today (Paris), the last 7 or 30 days, or everything kept. */
export const RECEIVED_EMAIL_PERIODS = ["today", "7d", "30d", "all"] as const;
export type ReceivedEmailPeriod = (typeof RECEIVED_EMAIL_PERIODS)[number];
export const DEFAULT_PERIOD: ReceivedEmailPeriod = "7d";

/** One row of Activité › Emails reçus. */
export interface ReceivedEmailRow {
  id: string;
  receivedAt: Date;
  senderDomain: string;
  /** Forwarded by hand by the Candidate from one of their own addresses. */
  manualForward: boolean;
  /** Null until it is read, and for an email never read. */
  kind: ReceivedEmailKind | null;
  /** The Job Offers it gave, new and already stored; null until it is read, and for an email never read. */
  offers: { new: number; alreadyStored: number } | null;
  outcome: ReceivedEmailOutcome;
  /** Null until it is read, and for an email never read. */
  guardrail: EmailGuardrailVerdict | null;
}

/** What `recordReceivedEmail` keeps of an email Email intake took. */
export interface ReceivedEmailRecord {
  receivedAt: Date;
  senderDomain: string;
  manualForward: boolean;
  outcome: ReceivedOfferEmailOutcome;
}

/**
 * What `recordReading` keeps of an email once read: its kind, the offers new for the Candidate and those already
 * stored for them (« déjà vue »), its outcome, and the Guardrail's verdict when one ran; or « échec », nothing read.
 */
export type ReadingRecord =
  | {
      kind: ReceivedEmailKind;
      newOffers: number;
      alreadyStored: number;
      outcome: Exclude<ReadingOutcome, "failed">;
      /** Left out while no Guardrail runs on the reading. */
      guardrail?: EmailGuardrailVerdict;
    }
  /** « échec », or set aside by a Guardrail (#446): no kind, no offers; the Guardrail blocked it. */
  | { outcome: "failed" | "set_aside_by_guardrail" };

/** What happened to a Linked mailbox, as the Journal lists it. */
export const LINKED_MAILBOX_EVENTS = ["switched_on", "replaced", "switched_off", "daily_cap_reached"] as const;
export type LinkedMailboxEventKind = (typeof LINKED_MAILBOX_EVENTS)[number];

/** One Linked mailbox event: when and what, naming no Candidate and no address. */
export interface LinkedMailboxEvent {
  id: string;
  at: Date;
  event: LinkedMailboxEventKind;
}

export interface ReceivedEmailsFilter {
  outcome?: ReceivedEmailOutcome;
  kind?: ReceivedEmailKind;
  period: ReceivedEmailPeriod;
}

/** Each field on its own: one that cannot be read is dropped, the others still filter. */
const filterSchema = z.object({
  outcome: z.enum(RECEIVED_EMAIL_OUTCOMES).optional().catch(undefined),
  kind: z.enum(RECEIVED_EMAIL_KINDS).optional().catch(undefined),
  period: z.enum(RECEIVED_EMAIL_PERIODS).optional().catch(undefined),
});

/** The filter of an untrusted input, every unreadable field left out; the period is DEFAULT_PERIOD unless one is read. */
export function receivedEmailsFilter(input: unknown): ReceivedEmailsFilter {
  const parsed = filterSchema.safeParse(typeof input === "object" && input !== null ? input : {});
  if (!parsed.success) return { period: DEFAULT_PERIOD };
  const { outcome, kind, period } = parsed.data;
  return { ...(outcome ? { outcome } : {}), ...(kind ? { kind } : {}), period: period ?? DEFAULT_PERIOD };
}

export interface EmailIntakeActivity {
  /** The newest rows first, at most LIST_LIMIT. `filter` is untrusted (the page's query string): `{ outcome?, kind?, period? }`. */
  receivedEmails(filter?: unknown): Promise<ReceivedEmailRow[]>;
  /** The newest `limit` Linked mailbox events first. */
  linkedMailboxEvents(limit: number): Promise<LinkedMailboxEvent[]>;
}

interface ReceivedEmailDbRow {
  id: string;
  received_at: Date;
  sender_domain: string;
  manual_forward: boolean;
  kind: ReceivedEmailKind | null;
  new_offers: number | null;
  already_stored: number | null;
  outcome: ReceivedEmailOutcome;
  guardrail: EmailGuardrailVerdict | null;
}

const rowOf = (row: ReceivedEmailDbRow): ReceivedEmailRow => ({
  id: row.id,
  receivedAt: row.received_at,
  senderDomain: row.sender_domain,
  manualForward: row.manual_forward,
  kind: row.kind,
  offers: row.new_offers === null || row.already_stored === null ? null : { new: row.new_offers, alreadyStored: row.already_stored },
  outcome: row.outcome,
  guardrail: row.guardrail,
});

export function createEmailIntakeActivity(database: Queryable, deps: { now?: () => Date } = {}): EmailIntakeActivity {
  const now = deps.now ?? (() => new Date());
  return {
    async receivedEmails(input) {
      const filter = receivedEmailsFilter(input);
      const conditions: string[] = [];
      const params: unknown[] = [];
      const where = (condition: (param: string) => string, value: unknown) => {
        params.push(value);
        conditions.push(condition(`$${params.length}`));
      };
      if (filter.outcome) where((param) => `outcome = ${param}`, filter.outcome);
      if (filter.kind) where((param) => `kind = ${param}`, filter.kind);
      if (filter.period === "today") where((param) => `(received_at AT TIME ZONE 'Europe/Paris')::date = (${param}::timestamptz AT TIME ZONE 'Europe/Paris')::date`, now());
      if (filter.period === "7d" || filter.period === "30d") where((param) => `received_at >= ${param}::timestamptz`, new Date(now().getTime() - (filter.period === "7d" ? 7 : 30) * 86_400_000));
      params.push(LIST_LIMIT);
      const { rows } = await database.query<ReceivedEmailDbRow>(
        `SELECT id, received_at, sender_domain, manual_forward, kind, new_offers, already_stored, outcome, guardrail
           FROM received_email_activity ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
          ORDER BY received_at DESC, id LIMIT $${params.length}`,
        params,
      );
      return rows.map(rowOf);
    },

    async linkedMailboxEvents(limit) {
      const { rows } = await database.query<LinkedMailboxEvent>(`SELECT id, at, event FROM linked_mailbox_event ORDER BY at DESC, id LIMIT $1`, [limit]);
      return rows;
    },
  };
}

/** Keeps a row of Emails reçus for an email Email intake took; its id, for the Candidate's Received offer email to point to. */
export async function recordReceivedEmail(client: Queryable, email: ReceivedEmailRecord): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO received_email_activity (received_at, sender_domain, manual_forward, outcome) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email.receivedAt, email.senderDomain, email.manualForward, email.outcome],
  );
  return rows[0]!.id;
}

/** Records on its row of Emails reçus what reading the Received offer email `receivedOfferEmailId` gave (#445). */
export async function recordReading(client: Queryable, receivedOfferEmailId: string, reading: ReadingRecord): Promise<void> {
  await client.query(
    `UPDATE received_email_activity a SET kind = $2, new_offers = $3, already_stored = $4, outcome = $5, guardrail = $6
       FROM received_offer_email e WHERE e.id = $1 AND e.activity_id = a.id`,
    !("kind" in reading)
      ? [receivedOfferEmailId, null, null, null, reading.outcome, reading.outcome === "failed" ? null : "blocked"]
      : [receivedOfferEmailId, reading.kind, Math.max(0, reading.newOffers), Math.max(0, reading.alreadyStored), reading.outcome, reading.guardrail ?? null],
  );
}

/** Records that a Linked mailbox was switched on, replaced, switched off, or reached its daily cap, at `at`. */
export async function recordLinkedMailboxEvent(client: Queryable, event: LinkedMailboxEventKind, at: Date): Promise<void> {
  await client.query(`INSERT INTO linked_mailbox_event (at, event) VALUES ($1, $2)`, [at, event]);
}

/** Deletes the rows of Emails reçus and the Linked mailbox events ACTIVITY_RETENTION_MONTHS old or more. Safe to run again. */
export async function purgeEmailIntakeActivity(database: Queryable, now: Date): Promise<{ receivedEmails: number; linkedMailboxEvents: number }> {
  const receivedEmails = await database.query(`DELETE FROM received_email_activity WHERE received_at <= $1::timestamptz - make_interval(months => $2)`, [now, ACTIVITY_RETENTION_MONTHS]);
  const linkedMailboxEvents = await database.query(`DELETE FROM linked_mailbox_event WHERE at <= $1::timestamptz - make_interval(months => $2)`, [now, ACTIVITY_RETENTION_MONTHS]);
  return { receivedEmails: receivedEmails.rowCount ?? 0, linkedMailboxEvents: linkedMailboxEvents.rowCount ?? 0 };
}

/** Creates the Back Office's Email intake tables. Run before `received_offer_email` points to them. Safe to run repeatedly. */
export async function migrateEmailIntakeActivity(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    -- Activité › Emails reçus (#449, ADR-0051): one row per Received offer email, no Candidate, kept 24 months.
    CREATE TABLE IF NOT EXISTS received_email_activity (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      received_at timestamptz NOT NULL,
      sender_domain text NOT NULL,
      manual_forward boolean NOT NULL DEFAULT false,
      kind text,
      new_offers integer,
      already_stored integer,
      outcome text NOT NULL,
      guardrail text
    );
    CREATE INDEX IF NOT EXISTS received_email_activity_received_at ON received_email_activity (received_at DESC);
    -- The Journal's Linked mailbox events (#449): what happened and when, no Candidate, kept 24 months.
    CREATE TABLE IF NOT EXISTS linked_mailbox_event (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      at timestamptz NOT NULL,
      event text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS linked_mailbox_event_at ON linked_mailbox_event (at DESC);
  `);
}

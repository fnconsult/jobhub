/**
 * Sends (ADR-0119 « Sending and applying », #1162; amends ADR-0005): an email Jobbbox sends in the Candidate's name, on
 * their click on a `propose_send` card, to one recipient of one of their Applications: an Outreach Message, a Follow-up
 * or a reply to an Exchange.
 *
 * One deep module in front of Postgres and the Mailer:
 *
 *   const sends = createSends(database, { mailer, cap: () => 20 });
 *   await sends.sendingAs(candidateId);            // { name: "Prénom Nom via Jobbbox", copyTo: their sign-in email }
 *   await sends.room(candidateId);                 // { sentToday, cap }: today in Paris
 *   await sends.send(candidateId, { key, applicationId, kind, to, subject, text });
 *   await sends.onApplication(candidateId, applicationId);   // the Sends kept on it, oldest first
 *
 * Rules kept here:
 *  - From Jobbbox's own address (MAIL_FROM, its domain authenticated by SPF, DKIM and DMARC), named « Prénom Nom via
 *    Jobbbox »; the Candidate's sign-in email is in copy and is the Reply-To. Never their mailbox (ADR-0050). Who they are
 *    is read here, from their account, never from what a request says.
 *  - Once per `key` (the card's id): the Send is reserved, committed, before the Mailer is called, so a second click, even
 *    while the first is still sending, sends nothing more. Never retried by itself.
 *  - Brevo's refusal (an HTTP answer) means nothing went: the reservation is forgotten, the Candidate may click again.
 *    Any other failure (a timeout, the connection lost) may have sent it: it is kept `uncertain`, counted, never sent
 *    again; the Candidate, in copy, sees in their mailbox whether it went.
 *  - At most `cap()` Sends a day per Candidate (COACH_SENDS_PER_DAY), the day in Paris, against abuse: past it, refused.
 *  - Only on the Candidate's own Application: another's, or an unknown id, is `not_found`.
 *  - Kept: kind, recipient, subject, dates and Brevo's message id; never the text, which stays on the card. Deleted with
 *    the Application or the account; in the Data export.
 */
import type { Pool } from "pg";
import type { Mailer } from "../auth";
import { BrevoApiError, displayName } from "../auth/mailers";

/** What a Send can be: an Application's Follow-up, its Outreach Message, or a reply to one of its Exchanges. */
export const SEND_KINDS = ["follow_up", "outreach_message", "exchange_reply"] as const;
export type SendKind = (typeof SEND_KINDS)[number];

/** The default of COACH_SENDS_PER_DAY: how many emails Jobbbox sends in one Candidate's name a day at most. */
export const DEFAULT_SENDS_PER_DAY = 20;

/** The day a cap counts in. */
const CAP_TIME_ZONE = "Europe/Paris";

export interface SendRequest {
  /** What makes it one Send: the card's id. A second request with the same key sends nothing. */
  key: string;
  applicationId: string;
  kind: SendKind;
  to: { email: string; name?: string };
  subject: string;
  text: string;
}

/** A Send kept on its Application. */
export interface SentEmail {
  id: string;
  applicationId: string;
  kind: SendKind;
  to: { email: string; name?: string };
  subject: string;
  sentAt: Date;
  key: string;
}

export interface SendRoom {
  sentToday: number;
  cap: number;
}

/** Who a Send goes out as: « Prénom Nom via Jobbbox », and the Candidate's sign-in email, in copy and as Reply-To. */
export interface SendingAs {
  name: string;
  copyTo: string;
}

export type SendResult =
  | { ok: true; sent: SentEmail; already?: true }
  /** Today's cap reached: nothing sent. */
  | { ok: false; error: "cap"; room: SendRoom }
  /** Not the Candidate's Application, or no such account. */
  | { ok: false; error: "not_found" }
  /** Brevo refused it: nothing went, a new click may send it. */
  | { ok: false; error: "failed" }
  /** It may have gone (a timeout): never sent again; the Candidate, in copy, can check. */
  | { ok: false; error: "uncertain" };

export interface Sends {
  sendingAs(candidateId: string): Promise<SendingAs | null>;
  room(candidateId: string): Promise<SendRoom>;
  send(candidateId: string, request: SendRequest): Promise<SendResult>;
  onApplication(candidateId: string, applicationId: string): Promise<SentEmail[]>;
}

export interface SendsDeps {
  mailer: Mailer;
  /** COACH_SENDS_PER_DAY, read at each send. */
  cap: () => number;
  now?: () => Date;
}

interface SentRow {
  id: string;
  application_id: string;
  kind: SendKind;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  status: "sending" | "sent" | "uncertain";
  send_key: string;
  sent_at: Date | null;
  created_at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, application_id, kind, recipient_email, recipient_name, subject, status, send_key, sent_at, created_at";

function sentOf(row: SentRow): SentEmail {
  return {
    id: row.id,
    applicationId: row.application_id,
    kind: row.kind,
    to: row.recipient_name ? { email: row.recipient_email, name: row.recipient_name } : { email: row.recipient_email },
    subject: row.subject,
    sentAt: row.sent_at ?? row.created_at,
    key: row.send_key,
  };
}

/** Since when today counts: midnight in Paris, of the day `now` is in there. */
const TODAY = `(date_trunc('day', $2::timestamptz AT TIME ZONE '${CAP_TIME_ZONE}') AT TIME ZONE '${CAP_TIME_ZONE}')`;

export function createSends(database: Pool, deps: SendsDeps): Sends {
  const now = deps.now ?? (() => new Date());
  const capOf = () => Math.max(0, Math.floor(deps.cap()));

  async function sentToday(queryable: Pick<Pool, "query">, candidateId: string): Promise<number> {
    const { rows } = await queryable.query<{ count: string }>(`SELECT count(*) AS count FROM sent_email WHERE candidate_id = $1 AND created_at >= ${TODAY}`, [candidateId, now()]);
    return Number(rows[0]?.count ?? 0);
  }

  async function sendingAs(candidateId: string): Promise<SendingAs | null> {
    if (!candidateId) return null;
    const { rows } = await database.query<{ email: string; name: string | null; given: string | null; family: string | null }>(
      `SELECT email, name, given_name AS given, family_name AS family FROM candidate WHERE id = $1`,
      [candidateId],
    );
    const row = rows[0];
    if (!row) return null;
    const full = [row.given, row.family].map((part) => part?.trim() ?? "").filter(Boolean).join(" ") || row.name?.trim() || "";
    const shown = displayName(full);
    return { name: shown ? `${shown} via Jobbbox` : "Jobbbox", copyTo: row.email };
  }

  /** Reserves the Send in one transaction, the Candidate's Sends locked: its row, or why there is none. */
  async function reserve(candidateId: string, request: SendRequest): Promise<{ row: SentRow; fresh: boolean } | { error: "cap"; room: SendRoom } | { error: "not_found" }> {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('sent_email:' || $1))`, [candidateId]);
      const kept = await client.query<SentRow>(`SELECT ${COLUMNS} FROM sent_email WHERE candidate_id = $1 AND send_key = $2`, [candidateId, request.key]);
      if (kept.rows[0]) {
        await client.query("COMMIT");
        return { row: kept.rows[0], fresh: false };
      }
      const owned = await client.query(`SELECT 1 FROM application WHERE id = $1 AND candidate_id = $2`, [request.applicationId, candidateId]);
      if (owned.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { error: "not_found" };
      }
      const room = { sentToday: await sentToday(client, candidateId), cap: capOf() };
      if (room.sentToday >= room.cap) {
        await client.query("ROLLBACK");
        return { error: "cap", room };
      }
      const { rows } = await client.query<SentRow>(
        `INSERT INTO sent_email (candidate_id, application_id, send_key, kind, recipient_email, recipient_name, subject, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'sending', $8) RETURNING ${COLUMNS}`,
        [candidateId, request.applicationId, request.key, request.kind, request.to.email, request.to.name ?? null, request.subject, now()],
      );
      await client.query("COMMIT");
      return { row: rows[0]!, fresh: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    sendingAs,

    async room(candidateId) {
      return { sentToday: candidateId ? await sentToday(database, candidateId) : 0, cap: capOf() };
    },

    async send(candidateId, request) {
      if (!candidateId || !UUID.test(request.applicationId) || !request.key) return { ok: false, error: "not_found" };
      const as = await sendingAs(candidateId);
      if (!as) return { ok: false, error: "not_found" };
      const reserved = await reserve(candidateId, request);
      if ("error" in reserved) return reserved.error === "cap" ? { ok: false, error: "cap", room: reserved.room } : { ok: false, error: "not_found" };
      const { row, fresh } = reserved;
      if (!fresh) return row.status === "uncertain" ? { ok: false, error: "uncertain" } : { ok: true, sent: sentOf(row), already: true };
      try {
        const mailed = await deps.mailer.send({
          to: request.to.email,
          subject: request.subject,
          text: request.text,
          fromName: as.name,
          cc: as.copyTo,
          replyTo: as.copyTo,
        });
        const { rows } = await database.query<SentRow>(`UPDATE sent_email SET status = 'sent', sent_at = $2, message_id = $3 WHERE id = $1 RETURNING ${COLUMNS}`, [
          row.id,
          now(),
          mailed?.messageId ?? null,
        ]);
        return { ok: true, sent: sentOf(rows[0] ?? row) };
      } catch (error) {
        // Brevo answered no: nothing went, the reservation is forgotten. Anything else may have sent it: never again.
        if (error instanceof BrevoApiError) {
          await database.query(`DELETE FROM sent_email WHERE id = $1`, [row.id]);
          console.warn(`[sends] Brevo refused a Send: HTTP ${error.status}`);
          return { ok: false, error: "failed" };
        }
        await database.query(`UPDATE sent_email SET status = 'uncertain' WHERE id = $1`, [row.id]);
        console.warn(`[sends] a Send may not have gone:`, error instanceof Error ? error.message : error);
        return { ok: false, error: "uncertain" };
      }
    },

    async onApplication(candidateId, applicationId) {
      if (!candidateId || !UUID.test(applicationId)) return [];
      const { rows } = await database.query<SentRow>(
        `SELECT ${COLUMNS} FROM sent_email WHERE candidate_id = $1 AND application_id = $2 AND status = 'sent' ORDER BY sent_at, id`,
        [candidateId, applicationId],
      );
      return rows.map(sentOf);
    },
  };
}

/** Creates or upgrades the `sent_email` table. Run after the Applications. Safe to run repeatedly. */
export async function migrateSends(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS sent_email (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      application_id uuid NOT NULL REFERENCES application (id) ON DELETE CASCADE,
      send_key text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('follow_up', 'outreach_message', 'exchange_reply')),
      recipient_email text NOT NULL,
      recipient_name text,
      subject text NOT NULL,
      status text NOT NULL CHECK (status IN ('sending', 'sent', 'uncertain')),
      message_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz,
      UNIQUE (candidate_id, send_key)
    );
    CREATE INDEX IF NOT EXISTS sent_email_candidate_day_idx ON sent_email (candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS sent_email_application_idx ON sent_email (application_id);
  `);
}

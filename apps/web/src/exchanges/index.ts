/**
 * An Application's Exchanges (#1099, ADR-0115, proposed; CONTEXT.md, Exchange): the emails about one of the Candidate's
 * Applications (a recruiter's answer, an invitation) that reach their Linked mailbox, kept on that Application.
 *
 * One deep module in front of Postgres:
 *
 *   const exchanges = createExchanges(database);
 *   await exchanges.arrive(client, candidateId, email); // { arrived: "new", id } | { arrived: "duplicate" } | { arrived: "none" }
 *   await exchanges.checked(id, "passed");              // "kept" | "offered" | "dropped": after the email Guardrail
 *   await exchanges.onApplication(candidateId, applicationId); // { kept, offered } for its « Échanges » Section
 *   await exchanges.tie(candidateId, id, applicationId) / dismiss(candidateId, id) / remove(candidateId, id);
 *
 *  - `arrive`: Email intake's inbound route hands it each email of a Linked mailbox (in its transaction). The rules of
 *    ./matching tie it to one Application, offer it to several (or on a weak match), or match nothing: `none`, the email
 *    keeps today's path (« autre », its text not kept). Matched, it waits for the « Contenu piégé dans un email »
 *    Guardrail (ADR-0052), shown nowhere; the same email delivered twice (its Message-ID) arrives once.
 *  - `checked`: the Guardrail's verdict. Blocked, nothing of it is kept; let through, its text is kept without what it
 *    hides from its reader, and it is kept on its Application, or offered (« Rattacher à Benchling ? »).
 *  - What is kept: its sender, the date it says it was sent, its subject and its text; never its attachments, images
 *    or headers (its Message-ID only, to find the replies in its thread and receive it once).
 *  - Kept while the Application exists: deleted with it, or with the account (ON DELETE CASCADE); the Candidate can delete
 *    one (`remove`). An email offered and left waiting is forgotten after OFFERED_RETENTION_DAYS (`purge`), one the
 *    Guardrail never answered after CHECK_RETENTION_HOURS.
 *  - It never changes the Application Status.
 * Every read and change is scoped to the Candidate: another's id is not found.
 */
import type { Pool, PoolClient } from "pg";
import type { Queryable } from "../database/pool";
import { HIDDEN_TEXT_CLOSE, HIDDEN_TEXT_OPEN } from "../guardrails/email";
import { matchExchange, type ApplicationLead } from "./matching";

export { matchExchange, type ApplicationLead, type ExchangeMatch } from "./matching";

/** How long an email offered to the Candidate waits for their gesture before it is forgotten. */
export const OFFERED_RETENTION_DAYS = 30;
/** How long an email waits for its Guardrail before it is forgotten: Email intake's own bound on a text it has not read (ADR-0051). */
export const CHECK_RETENTION_HOURS = 72;
/** The longest subject kept. */
export const MAX_SUBJECT_CHARACTERS = 300;

/** One email of the Candidate's Linked mailbox, as Email intake read it, for the rules. */
export interface IncomingEmail {
  messageId: string;
  /** Its From address. */
  from: string;
  subject: string;
  /** Its text, as Email intake keeps it: the parts it hides marked. */
  text: string;
  /** The date it says it was sent; null when it says none. */
  sentAt: Date | null;
  /** Its In-Reply-To and References: read to match, never kept. */
  threadIds: readonly string[];
  /** Its sender is a Recognised sender for the Candidate (a job board's alerts): its domain never ties it. */
  recognisedSender: boolean;
}

/** An Exchange kept on an Application. */
export interface Exchange {
  id: string;
  applicationId: string;
  from: string;
  subject: string;
  text: string;
  sentAt: Date | null;
  receivedAt: Date;
}

/** An email offered to the Candidate on an Application (« Rattacher à Benchling ? »): never its text before their gesture. */
export interface OfferedExchange {
  id: string;
  from: string;
  subject: string;
  sentAt: Date | null;
  receivedAt: Date;
  /** The employer of the Application it is offered on, as its Job Offer names it (its title when it names none). */
  employer: string;
}

/** An Exchange as the Data export holds it: kept on an Application, or offered to one or several. */
export interface ExportedExchange {
  id: string;
  state: "kept" | "offered";
  /** The Application it is kept on; null while offered. */
  applicationId: string | null;
  /** The Applications it is offered to. */
  offeredTo: string[];
  from: string;
  subject: string;
  text: string;
  sentAt: Date | null;
  receivedAt: Date;
}

export type Arrival = { arrived: "new"; id: string } | { arrived: "duplicate" } | { arrived: "none" };

export interface Exchanges {
  /** An email of the Candidate's Linked mailbox, tied or offered by the rules: then waiting for its Guardrail. `none`: no Application matches it. */
  arrive(client: Queryable, candidateId: string, email: IncomingEmail): Promise<Arrival>;
  /** The email Guardrail's verdict on an email waiting for it; null when none waits under `id`. */
  checked(id: string, verdict: "passed" | "blocked"): Promise<"kept" | "offered" | "dropped" | null>;
  /** An email waiting for its Guardrail: whose it is and its text; null otherwise. */
  toCheck(id: string): Promise<{ candidateId: string; text: string } | null>;
  /** What the « Échanges » Section of the Candidate's Application shows, oldest first; null for an Application not theirs. */
  onApplication(candidateId: string, applicationId: string): Promise<{ kept: Exchange[]; offered: OfferedExchange[] } | null>;
  /** One Exchange kept, with the Application it is on; null when it is not the Candidate's. */
  get(candidateId: string, id: string): Promise<Exchange | null>;
  /** Ties an offered email to one of the Applications it was offered to, on the Candidate's gesture. */
  tie(candidateId: string, id: string, applicationId: string): Promise<boolean>;
  /** Turns an offered email down: nothing of it is kept. */
  dismiss(candidateId: string, id: string): Promise<boolean>;
  /** Deletes an Exchange kept. */
  remove(candidateId: string, id: string): Promise<boolean>;
  /** Every Exchange of the Candidate, kept or offered, oldest first: their Data export. */
  exportOf(candidateId: string): Promise<ExportedExchange[]>;
  /** Forgets the emails offered past OFFERED_RETENTION_DAYS and those waiting for their Guardrail past CHECK_RETENTION_HOURS. */
  purge(now: Date): Promise<number>;
}

/** The text its reader sees: what the email hides (marked by the inbound route) left out. */
export function shownText(text: string): string {
  let shown = "";
  let from = 0;
  for (let open = text.indexOf(HIDDEN_TEXT_OPEN); open >= 0; open = text.indexOf(HIDDEN_TEXT_OPEN, from)) {
    const close = text.indexOf(HIDDEN_TEXT_CLOSE, open);
    if (close < 0) break;
    shown += text.slice(from, open);
    from = close + HIDDEN_TEXT_CLOSE.length;
  }
  return (shown + text.slice(from)).replace(/[ \t]{2,}/g, " ").trim();
}

const EXCHANGE_COLUMNS = `x.id, x.application_id AS "applicationId", x.sender AS "from", x.subject, x.text, x.sent_at AS "sentAt", x.received_at AS "receivedAt"`;

export function createExchanges(database: Queryable, options: { now?: () => Date } = {}): Exchanges {
  const now = options.now ?? (() => new Date());

  /** What the rules know of each of the Candidate's Applications. */
  async function leadsOf(client: Queryable, candidateId: string): Promise<ApplicationLead[]> {
    const { rows } = await client.query<ApplicationLead>(
      `SELECT a.id, COALESCE(d.confirmed_employer, o.employer) AS employer, d.dossier->>'website' AS website,
              COALESCE((SELECT array_agg(DISTINCT lower(address)) FROM enriched_contact c, unnest(c.emails) address WHERE c.application_id = a.id), '{}') AS "contactEmails",
              COALESCE((SELECT array_agg(x.message_id) FROM exchange x WHERE x.application_id = a.id AND x.state = 'kept'), '{}') AS "messageIds"
         FROM application a JOIN job_offer o ON o.id = a.job_offer_id LEFT JOIN company_dossier d ON d.application_id = a.id
        WHERE a.candidate_id = $1 ORDER BY a.created_at, a.id`,
      [candidateId],
    );
    return rows;
  }

  return {
    async arrive(client, candidateId, email) {
      const match = matchExchange(email, await leadsOf(client, candidateId));
      if (match.kind === "none") return { arrived: "none" };
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO exchange (candidate_id, application_id, offered_to, state, message_id, sender, subject, text, sent_at, received_at)
         VALUES ($1, $2, $3, 'awaiting_check', $4, $5, $6, $7, $8, $9)
         ON CONFLICT (candidate_id, message_id) DO NOTHING RETURNING id`,
        [
          candidateId,
          match.kind === "tie" ? match.applicationId : null,
          match.kind === "offer" ? match.applicationIds : [],
          email.messageId,
          email.from.trim().toLowerCase(),
          email.subject.trim().slice(0, MAX_SUBJECT_CHARACTERS),
          email.text,
          email.sentAt,
          now(),
        ],
      );
      return rows[0] ? { arrived: "new", id: rows[0].id } : { arrived: "duplicate" };
    },

    async checked(id, verdict) {
      if (verdict === "blocked") {
        const { rowCount } = await database.query(`DELETE FROM exchange WHERE id = $1 AND state = 'awaiting_check'`, [id]);
        return rowCount ? "dropped" : null;
      }
      const { rows } = await database.query<{ text: string }>(`SELECT text FROM exchange WHERE id = $1 AND state = 'awaiting_check'`, [id]);
      if (!rows[0]) return null;
      const { rows: updated } = await database.query<{ state: "kept" | "offered" }>(
        `UPDATE exchange SET state = CASE WHEN application_id IS NULL THEN 'offered' ELSE 'kept' END, text = $2
          WHERE id = $1 AND state = 'awaiting_check' RETURNING state`,
        [id, shownText(rows[0].text)],
      );
      return updated[0]?.state ?? null;
    },

    async toCheck(id) {
      const { rows } = await database.query<{ candidateId: string; text: string }>(
        `SELECT candidate_id AS "candidateId", text FROM exchange WHERE id = $1 AND state = 'awaiting_check'`,
        [id],
      );
      return rows[0] ?? null;
    },

    async onApplication(candidateId, applicationId) {
      const { rows: owned } = await database.query<{ employer: string }>(
        `SELECT COALESCE(d.confirmed_employer, o.employer, o.title) AS employer
           FROM application a JOIN job_offer o ON o.id = a.job_offer_id LEFT JOIN company_dossier d ON d.application_id = a.id
          WHERE a.id::text = $2 AND a.candidate_id = $1`,
        [candidateId, applicationId],
      );
      if (!owned[0]) return null;
      const [kept, offered] = await Promise.all([
        database.query<Exchange>(`SELECT ${EXCHANGE_COLUMNS} FROM exchange x WHERE x.candidate_id = $1 AND x.application_id::text = $2 AND x.state = 'kept' ORDER BY x.received_at, x.id`, [
          candidateId,
          applicationId,
        ]),
        database.query<Omit<OfferedExchange, "employer">>(
          `SELECT x.id, x.sender AS "from", x.subject, x.sent_at AS "sentAt", x.received_at AS "receivedAt"
             FROM exchange x WHERE x.candidate_id = $1 AND x.state = 'offered' AND $2 = ANY (x.offered_to::text[]) ORDER BY x.received_at, x.id`,
          [candidateId, applicationId],
        ),
      ]);
      return { kept: kept.rows, offered: offered.rows.map((row) => ({ ...row, employer: owned[0]!.employer })) };
    },

    async get(candidateId, id) {
      const { rows } = await database.query<Exchange>(`SELECT ${EXCHANGE_COLUMNS} FROM exchange x WHERE x.id::text = $2 AND x.candidate_id = $1 AND x.state = 'kept'`, [candidateId, id]);
      return rows[0] ?? null;
    },

    async tie(candidateId, id, applicationId) {
      const { rowCount } = await database.query(
        `UPDATE exchange x SET state = 'kept', application_id = a.id, offered_to = '{}'
           FROM application a
          WHERE x.id::text = $2 AND x.candidate_id = $1 AND x.state = 'offered'
            AND a.id::text = $3 AND a.candidate_id = $1 AND a.id = ANY (x.offered_to)`,
        [candidateId, id, applicationId],
      );
      return (rowCount ?? 0) > 0;
    },

    async dismiss(candidateId, id) {
      const { rowCount } = await database.query(`DELETE FROM exchange WHERE id::text = $2 AND candidate_id = $1 AND state = 'offered'`, [candidateId, id]);
      return (rowCount ?? 0) > 0;
    },

    async remove(candidateId, id) {
      const { rowCount } = await database.query(`DELETE FROM exchange WHERE id::text = $2 AND candidate_id = $1 AND state = 'kept'`, [candidateId, id]);
      return (rowCount ?? 0) > 0;
    },

    async exportOf(candidateId) {
      const { rows } = await database.query<ExportedExchange>(
        `SELECT x.id, x.state, x.application_id AS "applicationId", x.offered_to::text[] AS "offeredTo", x.sender AS "from", x.subject, x.text,
                x.sent_at AS "sentAt", x.received_at AS "receivedAt"
           FROM exchange x WHERE x.candidate_id = $1 AND x.state IN ('kept', 'offered') ORDER BY x.received_at, x.id`,
        [candidateId],
      );
      return rows;
    },

    async purge(at) {
      const { rowCount } = await database.query(
        `DELETE FROM exchange
          WHERE (state = 'offered' AND received_at <= $1::timestamptz - make_interval(days => $2))
             OR (state = 'awaiting_check' AND received_at <= $1::timestamptz - make_interval(hours => $3))
             -- Offered to Applications all deleted since: there is nothing left to tie it to.
             OR (state = 'offered' AND NOT EXISTS (SELECT 1 FROM application a WHERE a.id = ANY (exchange.offered_to)))`,
        [at, OFFERED_RETENTION_DAYS, CHECK_RETENTION_HOURS],
      );
      return rowCount ?? 0;
    },
  };
}

/** Creates or upgrades the Exchanges' table. Run after the Applications', the Company Dossiers' and the Enriched Contacts' migrations. */
export async function migrateExchanges(database: Pool | PoolClient): Promise<void> {
  await database.query(`
    -- An Application's Exchanges (#1099, ADR-0115): an email about one of the Candidate's Applications, waiting for the
    -- email Guardrail, kept on its Application, or offered to the Candidate on one or several (« Rattacher à … ? »).
    -- Its sender, date, subject and text; its Message-ID only to receive it once and find the replies in its thread.
    CREATE TABLE IF NOT EXISTS exchange (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      application_id uuid REFERENCES application (id) ON DELETE CASCADE,
      offered_to uuid[] NOT NULL DEFAULT '{}',
      state text NOT NULL CHECK (state IN ('awaiting_check', 'kept', 'offered')),
      message_id text NOT NULL,
      sender text NOT NULL,
      subject text NOT NULL,
      text text NOT NULL,
      sent_at timestamptz,
      received_at timestamptz NOT NULL,
      UNIQUE (candidate_id, message_id),
      CHECK (state <> 'kept' OR application_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS exchange_application ON exchange (application_id) WHERE application_id IS NOT NULL;
  `);
}

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
 *    or headers (its Message-ID only, to find the replies in its thread and receive it once). Its sender, subject and
 *    text are sealed at rest, per row, under SECRETS_MASTER_KEYS (AES-256-GCM, ../provider-secrets/cipher), as a Received
 *    offer email's text is: the `exchange` table never holds them in clear, and a row's content opens on that row only.
 *  - Kept while the Application exists: deleted with it, or with the account (ON DELETE CASCADE); the Candidate can delete
 *    one (`remove`). An email offered and left waiting is forgotten after OFFERED_RETENTION_DAYS (`purge`), one the
 *    Guardrail never answered after CHECK_RETENTION_HOURS.
 *  - It never changes the Application Status.
 * Every read and change is scoped to the Candidate: another's id is not found.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Queryable } from "../database/pool";
import { utcBefore } from "../database/before";
import { HIDDEN_TEXT_CLOSE, HIDDEN_TEXT_OPEN } from "../guardrails/email";
import type { SealedSecret, SecretCipher, SecretPlace } from "../provider-secrets/cipher";
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
  /**
   * Seals again under the newest master key every Exchange sealed under an older one: how many moved. A row that does not
   * open is left as it is. Without a keyring, none moves. Run by the worker with the Provider Secrets' (docs/ops/provider-secrets.md).
   */
  reencrypt(): Promise<number>;
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

/** What of an Exchange is sealed at rest: the email's own words and who wrote them. */
export interface ExchangeContent {
  from: string;
  subject: string;
  text: string;
}

/** Where an Exchange's sealed content belongs: it opens on its own row only. */
const placeOf = (id: string): SecretPlace => ({ provider: "exchanges", name: "exchange", row: id });

/** The content of the Exchange `id`, sealed for its row. */
export function sealExchangeContent(cipher: SecretCipher, id: string, content: ExchangeContent): SealedSecret {
  return cipher.seal(JSON.stringify({ from: content.from, subject: content.subject, text: content.text }), placeOf(id));
}

/** The content of the Exchange `id`, as sealed in its row. Throws SecretDecryptionError on a row moved, tampered or sealed under a key no longer held. */
export function openExchangeContent(cipher: SecretCipher, id: string, sealed: SealedSecret): ExchangeContent {
  const { from, subject, text } = JSON.parse(cipher.open(sealed, placeOf(id))) as ExchangeContent;
  return { from, subject, text };
}

/** The sealed content's columns of `exchange x`, as a SealedSecret's fields. */
const SEALED_COLUMNS = `x.content_ciphertext AS ciphertext, x.content_iv AS iv, x.content_tag AS tag, x.content_key_version AS "keyVersion"`;
type SealedRow = { id: string } & SealedSecret;

const EXCHANGE_COLUMNS = `x.id, x.application_id AS "applicationId", x.sent_at AS "sentAt", x.received_at AS "receivedAt", ${SEALED_COLUMNS}`;

export interface ExchangesOptions {
  /** The cipher over SECRETS_MASTER_KEYS that seals each Exchange's sender, subject and text; null while there is none (then none is kept nor read). */
  cipher: () => SecretCipher | null;
  now?: () => Date;
}

export function createExchanges(database: Queryable, options: ExchangesOptions): Exchanges {
  const now = options.now ?? (() => new Date());

  function cipher(): SecretCipher {
    const held = options.cipher();
    // The inbound route receives nothing without it (503): an Exchange is never kept in clear.
    if (!held) throw new Error("Exchanges are sealed under SECRETS_MASTER_KEYS, which holds no key");
    return held;
  }

  /** A row's sealed content opened, its sealed columns left out. */
  function opened<T extends SealedRow>(row: T, using: SecretCipher): Omit<T, keyof SealedSecret> & ExchangeContent {
    const { ciphertext, iv, tag, keyVersion, ...rest } = row;
    return { ...rest, ...openExchangeContent(using, row.id, { ciphertext, iv, tag, keyVersion }) };
  }

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
    async reencrypt() {
      const held = options.cipher();
      if (!held) return 0;
      const { rows } = await database.query<SealedRow>(`SELECT x.id, ${SEALED_COLUMNS} FROM exchange x WHERE x.content_key_version <> $1`, [held.activeVersion]);
      let moved = 0;
      for (const row of rows) {
        let content: ExchangeContent;
        try {
          content = opened(row, held);
        } catch {
          continue;
        }
        const sealed = sealExchangeContent(held, row.id, content);
        const { rowCount } = await database.query(
          `UPDATE exchange SET content_ciphertext = $2, content_iv = $3, content_tag = $4, content_key_version = $5 WHERE id = $1 AND content_key_version = $6`,
          [row.id, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion, row.keyVersion],
        );
        moved += rowCount ?? 0;
      }
      return moved;
    },

    async arrive(client, candidateId, email) {
      const match = matchExchange(email, await leadsOf(client, candidateId));
      if (match.kind === "none") return { arrived: "none" };
      const id = randomUUID();
      const sealed = sealExchangeContent(cipher(), id, {
        from: email.from.trim().toLowerCase(),
        subject: email.subject.trim().slice(0, MAX_SUBJECT_CHARACTERS),
        text: email.text,
      });
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO exchange (id, candidate_id, application_id, offered_to, state, message_id, content_ciphertext, content_iv, content_tag, content_key_version, sent_at, received_at)
         VALUES ($1, $2, $3, $4, 'awaiting_check', $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (candidate_id, message_id) DO NOTHING RETURNING id`,
        [
          id,
          candidateId,
          match.kind === "tie" ? match.applicationId : null,
          match.kind === "offer" ? match.applicationIds : [],
          email.messageId,
          sealed.ciphertext,
          sealed.iv,
          sealed.tag,
          sealed.keyVersion,
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
      const { rows } = await database.query<SealedRow>(`SELECT x.id, ${SEALED_COLUMNS} FROM exchange x WHERE x.id::text = $1 AND x.state = 'awaiting_check'`, [id]);
      if (!rows[0]) return null;
      const using = cipher();
      const { from, subject, text } = opened(rows[0], using);
      // Sealed again: what it hides from its reader is not kept, in clear or sealed.
      const sealed = sealExchangeContent(using, rows[0].id, { from, subject, text: shownText(text) });
      const { rows: updated } = await database.query<{ state: "kept" | "offered" }>(
        `UPDATE exchange SET state = CASE WHEN application_id IS NULL THEN 'offered' ELSE 'kept' END,
                content_ciphertext = $2, content_iv = $3, content_tag = $4, content_key_version = $5
          WHERE id::text = $1 AND state = 'awaiting_check' RETURNING state`,
        [id, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion],
      );
      return updated[0]?.state ?? null;
    },

    async toCheck(id) {
      const { rows } = await database.query<SealedRow & { candidateId: string }>(
        `SELECT x.id, x.candidate_id AS "candidateId", ${SEALED_COLUMNS} FROM exchange x WHERE x.id::text = $1 AND x.state = 'awaiting_check'`,
        [id],
      );
      if (!rows[0]) return null;
      return { candidateId: rows[0].candidateId, text: opened(rows[0], cipher()).text };
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
        database.query<Omit<Exchange, keyof ExchangeContent> & SealedRow>(
          `SELECT ${EXCHANGE_COLUMNS} FROM exchange x WHERE x.candidate_id = $1 AND x.application_id::text = $2 AND x.state = 'kept' ORDER BY x.received_at, x.id`,
          [candidateId, applicationId],
        ),
        database.query<Pick<OfferedExchange, "id" | "sentAt" | "receivedAt"> & SealedRow>(
          `SELECT x.id, x.sent_at AS "sentAt", x.received_at AS "receivedAt", ${SEALED_COLUMNS}
             FROM exchange x WHERE x.candidate_id = $1 AND x.state = 'offered' AND $2 = ANY (x.offered_to::text[]) ORDER BY x.received_at, x.id`,
          [candidateId, applicationId],
        ),
      ]);
      if (kept.rows.length === 0 && offered.rows.length === 0) return { kept: [], offered: [] };
      const using = cipher();
      return {
        kept: kept.rows.map((row) => opened(row, using)),
        // Never its text before the Candidate's gesture.
        offered: offered.rows.map((row) => {
          const { from, subject } = opened(row, using);
          return { id: row.id, from, subject, sentAt: row.sentAt, receivedAt: row.receivedAt, employer: owned[0]!.employer };
        }),
      };
    },

    async get(candidateId, id) {
      const { rows } = await database.query<Omit<Exchange, keyof ExchangeContent> & SealedRow>(
        `SELECT ${EXCHANGE_COLUMNS} FROM exchange x WHERE x.id::text = $2 AND x.candidate_id = $1 AND x.state = 'kept'`,
        [candidateId, id],
      );
      return rows[0] ? opened(rows[0], cipher()) : null;
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
      const { rows } = await database.query<Omit<ExportedExchange, keyof ExchangeContent> & SealedRow>(
        `SELECT x.id, x.state, x.application_id AS "applicationId", x.offered_to::text[] AS "offeredTo",
                x.sent_at AS "sentAt", x.received_at AS "receivedAt", ${SEALED_COLUMNS}
           FROM exchange x WHERE x.candidate_id = $1 AND x.state IN ('kept', 'offered') ORDER BY x.received_at, x.id`,
        [candidateId],
      );
      if (rows.length === 0) return [];
      const using = cipher();
      return rows.map((row) => opened(row, using));
    },

    async purge(at) {
      const { rowCount } = await database.query(
        `DELETE FROM exchange
          WHERE (state = 'offered' AND received_at <= ${utcBefore("$1", "make_interval(days => $2)")})
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
    -- Its date; its sender, subject and text sealed together under SECRETS_MASTER_KEYS (AES-256-GCM, bound to its row: the
    -- additional data names exchanges|exchange|<id>|<key version>), never in clear; its Message-ID only to receive it once
    -- and find the replies in its thread.
    CREATE TABLE IF NOT EXISTS exchange (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      application_id uuid REFERENCES application (id) ON DELETE CASCADE,
      offered_to uuid[] NOT NULL DEFAULT '{}',
      state text NOT NULL CHECK (state IN ('awaiting_check', 'kept', 'offered')),
      message_id text NOT NULL,
      content_ciphertext bytea NOT NULL,
      content_iv bytea NOT NULL,
      content_tag bytea NOT NULL,
      content_key_version integer NOT NULL,
      sent_at timestamptz,
      received_at timestamptz NOT NULL,
      UNIQUE (candidate_id, message_id),
      CHECK (state <> 'kept' OR application_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS exchange_application ON exchange (application_id) WHERE application_id IS NOT NULL;
  `);
}

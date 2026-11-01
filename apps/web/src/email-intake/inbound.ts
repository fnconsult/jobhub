/**
 * Email intake's door (#442, #580, ADR-0051): the emails Email intake's own MTA (apps/mta) accepts and posts to
 * `POST /api/email-intake/inbound`, one request each (inbound-headers.ts: the raw message, the envelope's recipients
 * and the MTA's Authentication-Results), each one a Received offer email of the Candidate whose Forwarding address it
 * reached.
 *
 *   const inbound = createEmailIntakeInbound(database, { emailIntake, switchedOn, cipher, queue, settings });
 *   return inbound.handle(request); // the route's whole work
 *
 * A delivery is taken only with the shared secret (EMAIL_INTAKE_INBOUND_SECRET: header `x-inbound-secret`, or a
 * bearer token; else 401), from the MTA's own network when ranges are set (EMAIL_INTAKE_MTA_IP_RANGES, else 403: a
 * request through the public proxy carries the caller's address), and up to MAX_MESSAGE_BYTES (else 413). While Email intake is switched off on the
 * Sources tab of Paramètres (#448), every email is discarded unread: no row, nothing queued. Else each email:
 *  - to no Forwarding address in use (unknown, replaced or switched off): discarded unread, no row;
 *  - from a sender Email intake does not read for that Candidate (recognised-senders.ts; the platform's list, less those
 *    they switched off, plus those they added, candidate-senders.ts): a row « expéditeur non reconnu », no text;
 *  - past the Candidate's daily cap (Paris day): a row « plafond atteint », no text, nothing queued;
 *  - else: a row awaiting reading, its text encrypted (AES-GCM under SECRETS_MASTER_KEYS, bound to its row), and a job
 *    on EMAIL_INTAKE_READ_QUEUE for the worker; Gmail's forwarding confirmation is kept the same way for the setup
 *    wizard, but neither queued nor counted.
 * One email delivered twice (its Message-ID) is received once. A failure answers 5xx and keeps nothing of the email:
 * the MTA then answers its sender with a temporary failure (4xx), and the sender delivers it again. Rows keep the outcome, the sender's domain and the dates; the text goes at most
 * 72 hours after it arrived, the row 12 months after (`purgeReceivedOfferEmails`, nightly in the worker). Each row also
 * gets its row of Activité › Emails reçus, naming no Candidate (activity.ts, #449), and the first email past the cap of
 * the day a Linked mailbox event for the Journal.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../database/pool";
import type { SealedSecret, SecretCipher } from "../provider-secrets/cipher";
import { recordLinkedMailboxEvent, recordReceivedEmail } from "./activity";
import type { EmailIntake } from "./index";
import { readInboundEmail, type InboundEmail } from "./inbound-email";
import { INBOUND_SECRET_HEADER, RAW_MESSAGE_TYPE } from "./inbound-headers";
import { recognisedSendersFor } from "./candidate-senders";
import { senderStanding } from "./recognised-senders";

// What the worker purges with them: Activité's Emails reçus rows and the Journal's Linked mailbox events (#449).
export { ACTIVITY_RETENTION_MONTHS, purgeEmailIntakeActivity } from "./activity";

/** The worker's queue of Received offer emails to read: `{ receivedOfferEmailId }`. */
export const EMAIL_INTAKE_READ_QUEUE = "email-intake.read";


/** How long a Received offer email's text may be kept, at most (to read it again after a failure). */
export const TEXT_RETENTION_HOURS = 72;
/** How long a Received offer email is kept. */
export const RETENTION_MONTHS = 12;

/**
 * The largest raw message taken: the MTA's own cap (apps/mta, 10 MB) and the headers it adds. An offer alert is a few
 * hundred kilobytes.
 */
export const MAX_MESSAGE_BYTES = 11 * 1024 * 1024;
const DAY_TIME_ZONE = "Europe/Paris";

/**
 * What became of a Received offer email (CONTEXT.md): set aside on arrival, or awaiting reading until the worker's
 * reading (#445, reading.ts) finds offers (new or already there), « autre » (no precise offer), fails after its
 * last try (« échec »), or is set aside by a Guardrail (« écarté par un garde-fou », #446): the email Guardrail
 * blocked it, or its reading broke a fixed output rule; the Recherches d'offres page names it among the ignored emails (#447).
 */
export type ReceivedOfferEmailOutcome =
  | "awaiting_reading"
  | "unrecognised_sender"
  | "over_daily_cap"
  | "forwarding_confirmation"
  | "offers_found"
  | "other"
  | "failed"
  | "guardrail";

/** What the inbound route reads at each delivery: Provider Secrets and Platform Settings in use. */
export interface InboundSettings {
  /** EMAIL_INTAKE_INBOUND_SECRET; while none, every delivery is refused. */
  secret: string | undefined;
  /** The MTA's own network (CIDR, IPv4); none: no check. */
  mtaIpRanges: readonly string[];
  /** How many emails one Candidate's Linked mailbox may have read a day. */
  dailyCap: number;
}

export interface EmailIntakeInboundOptions {
  emailIntake: Pick<EmailIntake, "candidateAt" | "sendingAddresses">;
  /** Whether Email intake, the Job discovery source, is switched on (Sources tab of Paramètres), read at each delivery. */
  switchedOn: () => Promise<boolean>;
  /** The cipher over SECRETS_MASTER_KEYS; null while there is none: nothing is received (503). */
  cipher: () => SecretCipher | null;
  queue: { send(name: string, data: object): Promise<void> };
  settings: () => InboundSettings;
  now?: () => Date;
}

export interface EmailIntakeInbound {
  /** Answers one email the MTA posts. */
  handle(request: Request): Promise<Response>;
}

/** Where a Received offer email's text is sealed: it opens on its own row only. */
const placeOf = (id: string) => ({ provider: "email-intake", name: "received_offer_email", row: id });

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Compares in constant time, whatever the lengths. */
function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected?.trim()) return false;
  return timingSafeEqual(digest(given.trim()), digest(expected.trim()));
}

function givenSecret(request: Request): string | null {
  const header = request.headers.get(INBOUND_SECRET_HEADER);
  if (header?.trim()) return header;
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  return bearer?.[1] ?? null;
}

/** The address the host's proxy saw: the last of X-Forwarded-For (the one it added; anything before was sent by the caller). */
function sourceIpOf(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim();
  return address ? address.replace(/^::ffff:/i, "") : null;
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((total, part) => total * 256 + Number(part), 0);
}

/**
 * Whether `address` is in one of `ranges` (`a.b.c.d/n`; a bare IPv4 address is /32; an IPv6 address matches only as
 * written, for a local test's `::1`). A range that does not read matches nothing.
 */
export function inIpRanges(address: string | null, ranges: readonly string[]): boolean {
  if (address === null) return false;
  const ip = ipv4ToNumber(address);
  if (ip === null) return ranges.some((range) => range.includes(":") && range.trim().toLowerCase() === address.toLowerCase());
  return ranges.some((range) => {
    const [base, bits = "32"] = range.trim().split("/");
    const start = ipv4ToNumber(base ?? "");
    const prefix = Number(bits);
    if (start === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const size = 2 ** (32 - prefix);
    return Math.floor(ip / size) === Math.floor(start / size);
  });
}

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);

export function createEmailIntakeInbound(database: Pool, options: EmailIntakeInboundOptions): EmailIntakeInbound {
  const now = options.now ?? (() => new Date());

  /** How many of the Candidate's emails were read, and set aside past the cap, on the Paris day of `at`. */
  async function today(client: PoolClient, candidateId: string, at: Date): Promise<{ read: number; overCap: number }> {
    const { rows } = await client.query<{ read: number; overCap: number }>(
      `SELECT count(*) FILTER (WHERE counts_against_cap)::int AS read, count(*) FILTER (WHERE outcome = 'over_daily_cap')::int AS "overCap"
       FROM received_offer_email
       WHERE candidate_id = $1
         AND (received_at AT TIME ZONE '${DAY_TIME_ZONE}')::date = ($2::timestamptz AT TIME ZONE '${DAY_TIME_ZONE}')::date`,
      [candidateId, at],
    );
    return rows[0]!;
  }

  async function receive(email: InboundEmail, cipher: SecretCipher, dailyCap: number): Promise<void> {
    let candidateId: string | null = null;
    for (const recipient of email.recipients) if ((candidateId = await options.emailIntake.candidateAt(recipient))) break;
    if (!candidateId) return; // Discarded unread: no Forwarding address in use.
    const sendingAddresses = await options.emailIntake.sendingAddresses(candidateId);
    const owner = candidateId;

    await inTransaction(database, async (client) => {
      // One delivery at a time per Candidate: the daily cap and the duplicate check hold.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('received_offer_email:' || $1::text))`, [owner]);
      const { rowCount } = await client.query(`SELECT 1 FROM received_offer_email WHERE candidate_id = $1 AND message_id = $2`, [owner, email.messageId]);
      if (rowCount) return;

      const receivedAt = now();
      const standing = senderStanding(email, { recognisedSenders: await recognisedSendersFor(client, owner), sendingAddresses });
      let outcome: ReceivedOfferEmailOutcome;
      if (standing === "unrecognised") outcome = "unrecognised_sender";
      else if (standing === "forwarding_confirmation") outcome = "forwarding_confirmation";
      else {
        const day = await today(client, owner, receivedAt);
        outcome = day.read >= dailyCap ? "over_daily_cap" : "awaiting_reading";
        // The Journal's « Boîtes reliées »: the first email set aside past the cap each day, not each one.
        if (outcome === "over_daily_cap" && day.overCap === 0) await recordLinkedMailboxEvent(client, "daily_cap_reached", receivedAt);
      }
      const id = randomUUID();
      const sender = domainOf(email.from);
      const manualForward = standing === "own_address";
      const activityId = await recordReceivedEmail(client, { receivedAt, senderDomain: sender, manualForward, outcome });
      const sealed: SealedSecret | null = outcome === "awaiting_reading" || outcome === "forwarding_confirmation" ? cipher.seal(email.text, placeOf(id)) : null;
      await client.query(
        `INSERT INTO received_offer_email
           (id, candidate_id, message_id, outcome, sender_domain, manual_forward, counts_against_cap, received_at, sent_at,
            text_ciphertext, text_iv, text_tag, text_key_version, activity_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          owner,
          email.messageId,
          outcome,
          sender,
          manualForward,
          outcome === "awaiting_reading",
          receivedAt,
          email.sentAt,
          sealed?.ciphertext ?? null,
          sealed?.iv ?? null,
          sealed?.tag ?? null,
          sealed?.keyVersion ?? null,
          activityId,
        ],
      );
      // Last, inside the transaction: an email that cannot be queued is not kept, and its sender delivers it again.
      if (outcome === "awaiting_reading") await options.queue.send(EMAIL_INTAKE_READ_QUEUE, { receivedOfferEmailId: id });
    });
  }

  return {
    async handle(request) {
      const settings = options.settings();
      if (!sameSecret(givenSecret(request), settings.secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (settings.mtaIpRanges.length > 0 && !inIpRanges(sourceIpOf(request), settings.mtaIpRanges)) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
      if (Number(request.headers.get("content-length") ?? 0) > MAX_MESSAGE_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
      const cipher = options.cipher();
      if (!cipher) return Response.json({ error: "no_master_key" }, { status: 503 });
      if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== RAW_MESSAGE_TYPE) return Response.json({ error: "invalid_body" }, { status: 400 });

      const email = await readInboundEmail(request);
      if (!email) return Response.json({ error: "invalid_body" }, { status: 400 });
      // Switched off: taken (its sender does not deliver it again) and discarded unread.
      if (!(await options.switchedOn())) return Response.json({ received: 1 });
      await receive(email, cipher, settings.dailyCap);
      return Response.json({ received: 1 });
    },
  };
}

/** A Received offer email's text, decrypted; null once purged, or for one whose text was never kept. */
export async function receivedTextOf(database: Pool, cipher: SecretCipher, id: string): Promise<string | null> {
  const { rows } = await database.query<{ ciphertext: Buffer | null; iv: Buffer; tag: Buffer; keyVersion: number }>(
    `SELECT text_ciphertext AS ciphertext, text_iv AS iv, text_tag AS tag, text_key_version AS "keyVersion" FROM received_offer_email WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row?.ciphertext ? cipher.open({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.keyVersion }, placeOf(id)) : null;
}

/**
 * Purges the Received offer emails' texts TEXT_RETENTION_HOURS after they arrived (read or not), and the Received
 * offer emails RETENTION_MONTHS after. The worker runs it hourly.
 */
export async function purgeReceivedOfferEmails(database: Pick<Pool, "query">, now: Date): Promise<{ texts: number; emails: number }> {
  const texts = await database.query(
    `UPDATE received_offer_email SET text_ciphertext = NULL, text_iv = NULL, text_tag = NULL, text_key_version = NULL
     WHERE text_ciphertext IS NOT NULL AND received_at <= $1::timestamptz - make_interval(hours => $2)`,
    [now, TEXT_RETENTION_HOURS],
  );
  const emails = await database.query(`DELETE FROM received_offer_email WHERE received_at <= $1::timestamptz - make_interval(months => $2)`, [now, RETENTION_MONTHS]);
  return { texts: texts.rowCount ?? 0, emails: emails.rowCount ?? 0 };
}

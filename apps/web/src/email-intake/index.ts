/**
 * Email intake (CONTEXT.md, ADR-0050, ADR-0051): the Candidate's Forwarding address, the address
 * Jobbbox gives them to forward their offer emails to. Switching Email intake on gives one and
 * records the date; replacing it or switching Email intake off stops the old one at once, and the
 * inbound route's lookup (`candidateAt`) no longer knows it. A stopped address is kept, marked
 * replaced or off, so it is not given again while the account lasts; once the account is deleted
 * (its rows cascade away), only the 80 random bits of the local part keep it from coming back.
 *
 * Switching on, replacing and switching off are each a Linked mailbox event of the Journal, naming no
 * Candidate (activity.ts, #449).
 *
 * Also the Candidate's own sending addresses (#437): their account's and those they add, from
 * which an email they forward by hand is theirs to read.
 */
import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../database/pool";
import { migrateEmailIntakeActivity, recordLinkedMailboxEvent } from "./activity";
import { SEEDED_RECOGNISED_SENDERS } from "./recognised-senders";

/** The Candidate's Forwarding address in use, and when it was given to them. */
export interface ForwardingAddress {
  address: string;
  activatedAt: Date;
}

export interface EmailIntake {
  /** The Candidate's Forwarding address in use, or null while Email intake is off for them. */
  forwardingAddress(candidateId: string): Promise<ForwardingAddress | null>;
  /** Switches Email intake on, dated now, with a new Forwarding address. Already on: kept as it is. */
  switchOn(candidateId: string): Promise<ForwardingAddress>;
  /** Gives the Candidate a new Forwarding address, dated now; the old one stops at once. Null while Email intake is off. */
  replace(candidateId: string): Promise<ForwardingAddress | null>;
  /** Switches Email intake off: the address stops at once. Already off: nothing changes. */
  switchOff(candidateId: string): Promise<void>;
  /** The Candidate whose Forwarding address in use is `address` (any case): what the inbound route asks. Null for any other address. */
  candidateAt(address: string): Promise<string | null>;
  /** The Candidate's own sending addresses, in lower case: their account's first, then those they added, oldest first. */
  sendingAddresses(candidateId: string): Promise<string[]>;
  /** Adds a sending address of theirs, dated now. Already one: nothing changes, "added". At most MAX_SENDING_ADDRESSES added. */
  addSendingAddress(candidateId: string, address: string): Promise<"added" | "invalid" | "too_many">;
  /** Removes a sending address they added (any case). Their account's stays. */
  removeSendingAddress(candidateId: string, address: string): Promise<void>;
}

/** How many sending addresses a Candidate may add besides their account's. */
export const MAX_SENDING_ADDRESSES = 10;

/** An email address, as a Candidate types one: something@domain.tld, no spaces. */
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface EmailIntakeOptions {
  /** The Email intake domain new Forwarding addresses are on (EMAIL_INTAKE_DOMAIN), read when one is given. */
  domain: () => string;
  /** A new address's local part; random and unguessable by default. */
  localPart?: () => string;
  now?: () => Date;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 16 characters drawn from 80 random bits: long, unguessable, and readable in lower case. */
function randomLocalPart(): string {
  return Array.from(randomBytes(16), (byte) => BASE32[byte % 32]).join("");
}

/** How many addresses are drawn before giving up: with 80 random bits, a second draw is already never needed. */
const DRAWS = 5;

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const violation = error as { code?: string; constraint?: string };
  return violation.code === "23505" && violation.constraint === constraint;
}

export function createEmailIntake(database: Pool, options: EmailIntakeOptions): EmailIntake {
  const now = options.now ?? (() => new Date());
  const localPart = options.localPart ?? randomLocalPart;

  async function forwardingAddress(candidateId: string): Promise<ForwardingAddress | null> {
    const { rows } = await database.query<ForwardingAddress>(
      `SELECT address, activated_at AS "activatedAt" FROM forwarding_address WHERE candidate_id = $1 AND state = 'active'`,
      [candidateId],
    );
    return rows[0] ?? null;
  }

  /** Gives the Candidate a new address in use, drawing again while the one drawn was ever given. */
  async function give(client: Pool | PoolClient, candidateId: string): Promise<ForwardingAddress> {
    const domain = options.domain().trim().toLowerCase();
    for (let draw = 0; draw < DRAWS; draw++) {
      const { rows } = await client.query<ForwardingAddress>(
        `INSERT INTO forwarding_address (candidate_id, address, state, activated_at) VALUES ($1, $2, 'active', $3)
         ON CONFLICT (address) DO NOTHING RETURNING address, activated_at AS "activatedAt"`,
        [candidateId, `${localPart().toLowerCase()}@${domain}`, now()],
      );
      if (rows[0]) return rows[0];
    }
    throw new Error(`No Forwarding address left unused after ${DRAWS} draws`);
  }

  async function stop(client: Pool | PoolClient, candidateId: string, state: "replaced" | "off"): Promise<boolean> {
    const { rowCount } = await client.query(`UPDATE forwarding_address SET state = $2, ended_at = $3 WHERE candidate_id = $1 AND state = 'active'`, [candidateId, state, now()]);
    return (rowCount ?? 0) > 0;
  }

  return {
    forwardingAddress,
    async switchOn(candidateId) {
      const inUse = await forwardingAddress(candidateId);
      if (inUse) return inUse;
      try {
        return await inTransaction(database, async (client) => {
          const given = await give(client, candidateId);
          await recordLinkedMailboxEvent(client, "switched_on", given.activatedAt);
          return given;
        });
      } catch (error) {
        // Switched on twice at once: the other one won.
        if (isUniqueViolation(error, "forwarding_address_one_active")) return (await forwardingAddress(candidateId))!;
        throw error;
      }
    },
    async replace(candidateId) {
      return inTransaction(database, async (client) => {
        if (!(await stop(client, candidateId, "replaced"))) return null;
        const given = await give(client, candidateId);
        await recordLinkedMailboxEvent(client, "replaced", given.activatedAt);
        return given;
      });
    },
    async switchOff(candidateId) {
      await inTransaction(database, async (client) => {
        if (await stop(client, candidateId, "off")) await recordLinkedMailboxEvent(client, "switched_off", now());
      });
    },
    async candidateAt(address) {
      const { rows } = await database.query<{ candidate_id: string }>(`SELECT candidate_id FROM forwarding_address WHERE address = $1 AND state = 'active'`, [
        address.trim().toLowerCase(),
      ]);
      return rows[0]?.candidate_id ?? null;
    },
    async sendingAddresses(candidateId) {
      const { rows } = await database.query<{ address: string }>(
        `SELECT address FROM (
           SELECT lower(email) AS address, 0 AS rank, NULL::timestamptz AS added_at FROM candidate WHERE id = $1
           UNION ALL SELECT address, 1, added_at FROM sending_address WHERE candidate_id = $1
         ) own ORDER BY rank, added_at, address`,
        [candidateId],
      );
      return [...new Set(rows.map((row) => row.address))];
    },
    async addSendingAddress(candidateId, raw) {
      const address = raw.trim().toLowerCase();
      if (!EMAIL_ADDRESS.test(address)) return "invalid";
      const { rows } = await database.query<{ added: boolean }>(
        `WITH kept AS (
           SELECT 1 FROM sending_address WHERE candidate_id = $1 AND address = $2
           UNION ALL SELECT 1 FROM candidate WHERE id = $1 AND lower(email) = $2
         ), added AS (
           INSERT INTO sending_address (candidate_id, address, added_at)
           SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM kept)
             AND (SELECT count(*) FROM sending_address WHERE candidate_id = $1) < $4
           ON CONFLICT DO NOTHING RETURNING 1
         )
         SELECT EXISTS (SELECT 1 FROM kept) OR EXISTS (SELECT 1 FROM added) AS added`,
        [candidateId, address, now(), MAX_SENDING_ADDRESSES],
      );
      return rows[0]!.added ? "added" : "too_many";
    },
    async removeSendingAddress(candidateId, address) {
      await database.query(`DELETE FROM sending_address WHERE candidate_id = $1 AND address = $2`, [candidateId, address.trim().toLowerCase()]);
    },
  };
}

/** The Candidate's Email intake, as their Data export holds it. */
export interface ExportedEmailIntake {
  /** Every Forwarding address given to them, newest first: the one in use, and those replaced or switched off, with when they stopped. */
  forwardingAddresses: { address: string; state: "active" | "replaced" | "off"; activatedAt: Date; endedAt: Date | null }[];
  /** The sending addresses they added, oldest first (their account's is the account's own email). */
  sendingAddresses: { address: string; addedAt: Date }[];
  /**
   * Their Received offer emails of the last 12 months, newest first: what became of each, the kind the AI read (null
   * until read), its sender's domain and dates, and the offers it gave (#445); never its text.
   */
  receivedOfferEmails: {
    id: string;
    outcome: string;
    kind: string | null;
    senderDomain: string;
    receivedAt: Date;
    sentAt: Date | null;
    offers: ExportedEmailOffer[];
  }[];
  /** The Recognised senders they added for themselves (#450), oldest first. */
  recognisedSenders: { match: "domain" | "address"; value: string; label: string; addedAt: Date }[];
  /** The platform's Recognised senders they switched off for themselves (#450), oldest first. */
  switchedOffSenders: { value: string; switchedOffAt: Date }[];
}

/**
 * One offer a Received offer email gave, in its order: new (its Job Offer, the Profile it went to, null for « Non
 * classées », and its Match Score), seen (« déjà vue »: its Job Offer), to_capture (a Forbidden site's: its title and
 * link) or too_old.
 */
export interface ExportedEmailOffer {
  disposition: string;
  jobOfferId: string | null;
  profileId: string | null;
  matchScore: number | null;
  title: string | null;
  link: string | null;
}

/** The Candidate's Email intake for their Data export (ADR-0051). */
export async function emailIntakeOf(database: Pool, candidateId: string): Promise<ExportedEmailIntake> {
  const [forwardingAddresses, sendingAddresses, receivedOfferEmails, recognisedSenders, switchedOffSenders] = await Promise.all([
    database.query<ExportedEmailIntake["forwardingAddresses"][number]>(
      `SELECT address, state, activated_at AS "activatedAt", ended_at AS "endedAt" FROM forwarding_address WHERE candidate_id = $1 ORDER BY activated_at DESC, address`,
      [candidateId],
    ),
    database.query<ExportedEmailIntake["sendingAddresses"][number]>(
      `SELECT address, added_at AS "addedAt" FROM sending_address WHERE candidate_id = $1 ORDER BY added_at, address`,
      [candidateId],
    ),
    database.query<Omit<ExportedEmailIntake["receivedOfferEmails"][number], "offers">>(
      `SELECT id, outcome, kind, sender_domain AS "senderDomain", received_at AS "receivedAt", sent_at AS "sentAt"
       FROM received_offer_email WHERE candidate_id = $1 ORDER BY received_at DESC, id`,
      [candidateId],
    ),
    database.query<ExportedEmailIntake["recognisedSenders"][number]>(
      `SELECT match, value, label, added_at AS "addedAt" FROM candidate_recognised_sender WHERE candidate_id = $1 ORDER BY added_at, value`,
      [candidateId],
    ),
    database.query<ExportedEmailIntake["switchedOffSenders"][number]>(
      `SELECT value, switched_off_at AS "switchedOffAt" FROM candidate_switched_off_sender WHERE candidate_id = $1 ORDER BY switched_off_at, value`,
      [candidateId],
    ),
  ]);
  const offers = await offersOf(database, candidateId);
  return {
    forwardingAddresses: forwardingAddresses.rows,
    sendingAddresses: sendingAddresses.rows,
    receivedOfferEmails: receivedOfferEmails.rows.map((email) => ({ ...email, offers: offers.get(email.id) ?? [] })),
    recognisedSenders: recognisedSenders.rows,
    switchedOffSenders: switchedOffSenders.rows,
  };
}

/** The offers the Candidate's Received offer emails gave, by email, in each one's order; none before their table exists. */
async function offersOf(database: Pool, candidateId: string): Promise<Map<string, ExportedEmailOffer[]>> {
  const byEmail = new Map<string, ExportedEmailOffer[]>();
  try {
    const { rows } = await database.query<ExportedEmailOffer & { emailId: string }>(
      `SELECT received_offer_email_id AS "emailId", disposition, job_offer_id AS "jobOfferId", profile_id AS "profileId",
              match_score AS "matchScore", title, link
         FROM received_offer_email_offer WHERE candidate_id = $1 ORDER BY received_offer_email_id, position`,
      [candidateId],
    );
    for (const { emailId, ...offer } of rows) byEmail.set(emailId, [...(byEmail.get(emailId) ?? []), offer]);
  } catch (error) {
    if ((error as { code?: string }).code !== "42P01") throw error;
  }
  return byEmail;
}

/** Creates or upgrades the Email intake tables. Run after the Candidate table. Safe to run repeatedly. */
export async function migrateEmailIntake(database: Pool): Promise<void> {
  await migrateEmailIntakeActivity(database);
  await database.query(`
    CREATE TABLE IF NOT EXISTS forwarding_address (
      address text PRIMARY KEY,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      state text NOT NULL CHECK (state IN ('active', 'replaced', 'off')),
      activated_at timestamptz NOT NULL,
      ended_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS forwarding_address_one_active ON forwarding_address (candidate_id) WHERE state = 'active';
    CREATE TABLE IF NOT EXISTS sending_address (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      address text NOT NULL,
      added_at timestamptz NOT NULL,
      PRIMARY KEY (candidate_id, address)
    );
    -- Received offer emails (#442): the outcome, the sender's domain and the dates; the text encrypted, 72 hours at most.
    CREATE TABLE IF NOT EXISTS received_offer_email (
      id text PRIMARY KEY,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      message_id text NOT NULL,
      outcome text NOT NULL,
      sender_domain text NOT NULL,
      manual_forward boolean NOT NULL DEFAULT false,
      counts_against_cap boolean NOT NULL DEFAULT false,
      received_at timestamptz NOT NULL,
      sent_at timestamptz,
      text_ciphertext bytea,
      text_iv bytea,
      text_tag bytea,
      text_key_version integer,
      UNIQUE (candidate_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS received_offer_email_received_at ON received_offer_email (received_at);
    -- Its reading (#445): the kind the AI read, how many tries, when it was read, and its live steps while it is read.
    ALTER TABLE received_offer_email ADD COLUMN IF NOT EXISTS kind text CHECK (kind IN ('alert', 'recruiter', 'other'));
    ALTER TABLE received_offer_email ADD COLUMN IF NOT EXISTS read_tries integer NOT NULL DEFAULT 0;
    ALTER TABLE received_offer_email ADD COLUMN IF NOT EXISTS read_at timestamptz;
    ALTER TABLE received_offer_email ADD COLUMN IF NOT EXISTS progress jsonb;
    -- Its row of Activité › Emails reçus (#449): the Candidate's row points to it, so it outlives the account.
    ALTER TABLE received_offer_email ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES received_email_activity (id) ON DELETE SET NULL;
    -- The platform's Recognised senders (#437): seeded once, then kept by Administrators.
    CREATE TABLE IF NOT EXISTS recognised_sender (
      match text NOT NULL CHECK (match IN ('domain', 'address')),
      value text PRIMARY KEY,
      label text NOT NULL,
      aligned boolean NOT NULL DEFAULT false
    );
    -- A disabled Recognised sender stays listed, unread (#448).
    ALTER TABLE recognised_sender ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
    -- The senders a Candidate added for themselves (#450): counted, naming no one, in « Expéditeurs proposés » (#448).
    CREATE TABLE IF NOT EXISTS candidate_recognised_sender (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      match text NOT NULL CHECK (match IN ('domain', 'address')),
      value text NOT NULL,
      label text NOT NULL,
      added_at timestamptz NOT NULL,
      PRIMARY KEY (candidate_id, value)
    );
    -- The platform's Recognised senders a Candidate switched off for themselves alone (#450); gone with the sender.
    CREATE TABLE IF NOT EXISTS candidate_switched_off_sender (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      value text NOT NULL REFERENCES recognised_sender (value) ON DELETE CASCADE,
      switched_off_at timestamptz NOT NULL,
      PRIMARY KEY (candidate_id, value)
    );
  `);
  await seedRecognisedSenders(database);
}

/** Fills the platform's Recognised senders with SEEDED_RECOGNISED_SENDERS while the list is empty: once Administrators keep it, one they removed stays removed. */
async function seedRecognisedSenders(database: Pool): Promise<void> {
  await database.query(
    `INSERT INTO recognised_sender (match, value, label, aligned)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[])
     WHERE NOT EXISTS (SELECT 1 FROM recognised_sender)
     ON CONFLICT (value) DO NOTHING`,
    [
      SEEDED_RECOGNISED_SENDERS.map((sender) => sender.match),
      SEEDED_RECOGNISED_SENDERS.map((sender) => sender.value),
      SEEDED_RECOGNISED_SENDERS.map((sender) => sender.label),
      SEEDED_RECOGNISED_SENDERS.map((sender) => sender.aligned === true),
    ],
  );
}

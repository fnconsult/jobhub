/**
 * Email intake (CONTEXT.md, ADR-0050, ADR-0051): the Candidate's Forwarding address, the address
 * Jobbbox gives them to forward their offer emails to. Switching Email intake on gives one and
 * records the date; replacing it or switching Email intake off stops the old one at once, and the
 * inbound route's lookup (`candidateAt`) no longer knows it. A stopped address is kept, marked
 * replaced or off, so it is not given again while the account lasts; once the account is deleted
 * (its rows cascade away), only the 80 random bits of the local part keep it from coming back.
 *
 * Also the Candidate's own sending addresses (#437): their account's and those they add, from
 * which an email they forward by hand is theirs to read.
 */
import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../database/pool";

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
        return await give(database, candidateId);
      } catch (error) {
        // Switched on twice at once: the other one won.
        if (isUniqueViolation(error, "forwarding_address_one_active")) return (await forwardingAddress(candidateId))!;
        throw error;
      }
    },
    async replace(candidateId) {
      return inTransaction(database, async (client) => ((await stop(client, candidateId, "replaced")) ? give(client, candidateId) : null));
    },
    async switchOff(candidateId) {
      await stop(database, candidateId, "off");
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
}

/** The Candidate's Email intake for their Data export (ADR-0051). */
export async function emailIntakeOf(database: Pool, candidateId: string): Promise<ExportedEmailIntake> {
  const [forwardingAddresses, sendingAddresses] = await Promise.all([
    database.query<ExportedEmailIntake["forwardingAddresses"][number]>(
      `SELECT address, state, activated_at AS "activatedAt", ended_at AS "endedAt" FROM forwarding_address WHERE candidate_id = $1 ORDER BY activated_at DESC, address`,
      [candidateId],
    ),
    database.query<ExportedEmailIntake["sendingAddresses"][number]>(
      `SELECT address, added_at AS "addedAt" FROM sending_address WHERE candidate_id = $1 ORDER BY added_at, address`,
      [candidateId],
    ),
  ]);
  return { forwardingAddresses: forwardingAddresses.rows, sendingAddresses: sendingAddresses.rows };
}

/** Creates or upgrades the Email intake tables. Run after the Candidate table. Safe to run repeatedly. */
export async function migrateEmailIntake(database: Pool): Promise<void> {
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
  `);
}

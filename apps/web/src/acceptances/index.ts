/**
 * Acceptances (ADR-0062, #510): a Candidate agreeing to one Legal Text Version of the CGU or the CGV, kept as proof.
 *
 * One deep module. Callers get `createAcceptances(database, options)`:
 *  - `pending` names the CGU version the Candidate must accept before going on, or null. Nothing while the registry
 *    (#546) holds no CGU version in effect. The first version counts as substantial for everyone; after that, only a
 *    substantial version asks again (a minor one never does). What is asked is the version in effect that day.
 *  - `accept` records the Acceptance of that version, once: « premiere_connexion » for the Candidate's first, else
 *    « nouvelle_acceptation ». Any other version is refused as stale.
 *  - `acceptAtCheckout` records the CGV in effect at a payment, with its Checkout session and whether the Candidate
 *    asked for immediate performance (filled by the page before Checkout, #512).
 *  - `of` lists them for the Data export.
 * Each row also keeps a pseudonym of the Candidate (HMAC-SHA256 of their email under the app's secret, never derivable
 * without it), so the proof outlives the Account deletion with no email and no name: the Candidate's id is set to null
 * and the day of the deletion recorded (a trigger), then `purgeExpiredAcceptances` deletes the CGU rows
 * CGU_RETENTION_YEARS after it and the CGV rows CGV_RETENTION_YEARS after it (a paid Plan ends with the account).
 */
import { createHmac } from "node:crypto";
import { legalTextRegistry, legalTextVersionInEffect, parisDay, type LegalTextVersionRecord } from "@jobhub/help";
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";

/** Kept 5 years after the Account deletion: proof of the CGU accepted (an assumption without a lawyer, #510). */
export const CGU_RETENTION_YEARS = 5;
/** Kept 10 years after the Account deletion, which ends the last paid contract: C. conso. L213-1, D213-1. */
export const CGV_RETENTION_YEARS = 10;

/** How the Candidate came to accept: the screen after sign-in (ADR-0062), or a payment. */
export const ACCEPTANCE_CHANNELS = ["premiere_connexion", "nouvelle_acceptation", "paiement_plan", "paiement_coaching"] as const;
export type AcceptanceChannel = (typeof ACCEPTANCE_CHANNELS)[number];
export type CheckoutChannel = Extract<AcceptanceChannel, `paiement_${string}`>;

/** An Acceptance as the Data export shows it: never the pseudonym, never Stripe's Checkout session id. */
export interface ExportedAcceptance {
  text: "cgu" | "cgv";
  version: string;
  url: string;
  /** The SHA-256 of the version's French text, the binding one. */
  sha256: string;
  channel: AcceptanceChannel;
  acceptedAt: Date;
  /** At a payment: whether the Candidate asked for the service to start at once (#512). */
  immediateExecutionRequested?: boolean;
}

export interface Acceptances {
  /** The CGU version the Candidate must accept now, or null when nothing is asked of them. */
  pending(candidateId: string): Promise<LegalTextVersionRecord | null>;
  /** Accepts the CGU `version`: « accepted » (once, again does nothing), or « stale » when it is not the one to accept now. */
  accept(candidateId: string, version: string): Promise<"accepted" | "stale">;
  /** Records the CGV in effect, accepted at a payment. Throws while no CGV version is in effect. */
  acceptAtCheckout(candidateId: string, payment: { channel: CheckoutChannel; checkoutSessionId: string; immediateExecutionRequested: boolean }): Promise<void>;
  /** The Candidate's Acceptances, oldest first. */
  of(candidateId: string): Promise<ExportedAcceptance[]>;
  /** The pseudonym the rows of the person with `email` keep: to find them again, with the secret, after the deletion. */
  holderOf(email: string): string;
}

export interface AcceptancesOptions {
  /** The Legal Text Versions (#546); defaults to the ones this build carries. */
  registry: () => readonly LegalTextVersionRecord[];
  /** The app's secret (AUTH_SECRET) the pseudonym is keyed with. */
  secret: string;
  now: () => Date;
}

export function createAcceptances(database: Pool, options: Partial<AcceptancesOptions> & Pick<AcceptancesOptions, "secret">): Acceptances {
  const registry = options.registry ?? legalTextRegistry;
  const now = options.now ?? (() => new Date());

  function holderOf(email: string): string {
    return createHmac("sha256", options.secret).update(`legal-acceptance:${email.trim().toLowerCase()}`).digest("hex");
  }

  /** The CGU versions in effect today, oldest first. */
  function cguInEffect(): LegalTextVersionRecord[] {
    const today = parisDay(now());
    return registry()
      .filter((entry) => entry.text === "cgu" && entry.version <= today)
      .sort((a, b) => a.version.localeCompare(b.version));
  }

  async function newestAcceptedCgu(candidateId: string): Promise<string | null> {
    const { rows } = await database.query<{ version: string | null }>(`SELECT max(version) AS version FROM legal_acceptance WHERE candidate_id = $1 AND text = 'cgu'`, [candidateId]);
    return rows[0]?.version ?? null;
  }

  async function pending(candidateId: string): Promise<LegalTextVersionRecord | null> {
    const versions = cguInEffect();
    if (versions.length === 0) return null;
    const asking = versions.filter((entry, index) => index === 0 || entry.change === "substantielle").at(-1)!;
    const accepted = await newestAcceptedCgu(candidateId);
    return accepted !== null && accepted >= asking.version ? null : versions.at(-1)!;
  }

  async function record(candidateId: string, entry: LegalTextVersionRecord, channel: AcceptanceChannel, payment?: { checkoutSessionId: string; immediateExecutionRequested: boolean }) {
    const { rows } = await database.query<{ email: string }>(`SELECT email FROM candidate WHERE id = $1`, [candidateId]);
    if (!rows[0]) throw new Error("No such Candidate");
    await database.query(
      `INSERT INTO legal_acceptance (candidate_id, holder, text, version, url, sha256, channel, checkout_session_id, immediate_execution_requested, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (candidate_id, text, version) WHERE checkout_session_id IS NULL DO NOTHING`,
      [candidateId, holderOf(rows[0].email), entry.text, entry.version, entry.url, entry.sha256, channel, payment?.checkoutSessionId ?? null, payment?.immediateExecutionRequested ?? null, now()],
    );
  }

  return {
    pending,
    holderOf,

    async accept(candidateId, version) {
      const asked = await pending(candidateId);
      if (!asked) return (await newestAcceptedCgu(candidateId)) !== null && cguInEffect().some((entry) => entry.version === version) ? "accepted" : "stale";
      if (asked.version !== version) return "stale";
      await record(candidateId, asked, (await newestAcceptedCgu(candidateId)) === null ? "premiere_connexion" : "nouvelle_acceptation");
      return "accepted";
    },

    async acceptAtCheckout(candidateId, { channel, ...payment }) {
      const cgv = legalTextVersionInEffect("cgv", parisDay(now()), registry());
      if (!cgv) throw new Error("No CGV version is in effect");
      await record(candidateId, cgv, channel, payment);
    },

    async of(candidateId) {
      const { rows } = await database.query<Omit<ExportedAcceptance, "immediateExecutionRequested"> & { immediateExecutionRequested: boolean | null }>(
        `SELECT text, version, url, sha256, channel, accepted_at AS "acceptedAt", immediate_execution_requested AS "immediateExecutionRequested"
           FROM legal_acceptance WHERE candidate_id = $1 ORDER BY accepted_at, id`,
        [candidateId],
      );
      return rows.map(({ immediateExecutionRequested, ...acceptance }) => ({ ...acceptance, ...(immediateExecutionRequested !== null && { immediateExecutionRequested }) }));
    },
  };
}

/**
 * Deletes the Acceptances of deleted accounts whose time is up at `now`: the CGU ones CGU_RETENTION_YEARS after the
 * deletion, the CGV ones CGV_RETENTION_YEARS after. A living Candidate's are never purged. Returns how many. Safe to run again.
 */
export async function purgeExpiredAcceptances(database: Queryable, now: Date): Promise<number> {
  const { rowCount } = await database.query(
    `DELETE FROM legal_acceptance
      WHERE candidate_id IS NULL
        AND account_deleted_at <= $1::timestamptz - make_interval(years => CASE text WHEN 'cgu' THEN $2::int ELSE $3::int END)`,
    [now, CGU_RETENTION_YEARS, CGV_RETENTION_YEARS],
  );
  return rowCount ?? 0;
}

/** Creates or upgrades the Acceptances table. Run after the Candidate accounts' migration. Safe to run repeatedly. */
export async function migrateAcceptances(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS legal_acceptance (
      id bigserial PRIMARY KEY,
      -- Set to null by the Account deletion: the row is Jobbbox's proof, kept by its pseudonym.
      candidate_id text REFERENCES candidate (id) ON DELETE SET NULL,
      holder text NOT NULL,
      text text NOT NULL CHECK (text IN ('cgu', 'cgv')),
      version text NOT NULL,
      url text NOT NULL,
      sha256 text NOT NULL,
      channel text NOT NULL CHECK (channel IN (${ACCEPTANCE_CHANNELS.map((channel) => `'${channel}'`).join(", ")})),
      checkout_session_id text,
      immediate_execution_requested boolean,
      accepted_at timestamptz NOT NULL,
      account_deleted_at timestamptz
    );
    -- The screen after sign-in records a version once; each payment records its own.
    CREATE UNIQUE INDEX IF NOT EXISTS legal_acceptance_once_idx ON legal_acceptance (candidate_id, text, version) WHERE checkout_session_id IS NULL;
    CREATE INDEX IF NOT EXISTS legal_acceptance_candidate_id_idx ON legal_acceptance (candidate_id);
    CREATE INDEX IF NOT EXISTS legal_acceptance_deleted_idx ON legal_acceptance (account_deleted_at) WHERE candidate_id IS NULL;

    -- The day of the Account deletion, which the retention counts from.
    CREATE OR REPLACE FUNCTION legal_acceptance_account_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.account_deleted_at := clock_timestamp();
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER legal_acceptance_account_deleted BEFORE UPDATE OF candidate_id ON legal_acceptance
      FOR EACH ROW WHEN (OLD.candidate_id IS NOT NULL AND NEW.candidate_id IS NULL) EXECUTE FUNCTION legal_acceptance_account_deleted();
  `);
}

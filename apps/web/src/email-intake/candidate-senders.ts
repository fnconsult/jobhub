/**
 * A Candidate's own Recognised senders (CONTEXT.md: Recognised sender; #437, #450): those they add for themselves
 * alone, and the platform's they switch off for themselves alone.
 *
 *   const senders = createCandidateSenders(database);
 *   await senders.add(candidateId, { sender: "alertes@mail.monster.fr", label: "Monster" }); // kept: mail.monster.fr
 *   await senders.switchPlatformSender(candidateId, "linkedin.com", false);                 // for them only
 *   await recognisedSendersFor(client, candidateId);                                        // what the inbound route reads
 *
 * A sender is kept by its domain, the sending address's (« De : »), not a careers site's or a job board's site; on a
 * shared sending platform (jobs2web.com...) by its full address, so a domain alone there is refused. It counts from the
 * Candidate's next email: one already set aside is not recovered. Each one the platform's list lacks is proposed to
 * Administrators in « Expéditeurs proposés » (recognised-sender-list.ts: domain and number of Candidates, no names);
 * only an Administrator adds it for all, and one they refuse stays recognised for those who added it. Every input is
 * untrusted and validated here.
 */
import { jobDiscoveryDomain } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";
import { MAX_SENDER_LABEL_LENGTH } from "./recognised-sender-list";
import { isSharedSendingPlatform, type RecognisedSender } from "./recognised-senders";

/** A sender the Candidate added for themselves; its label is theirs, for display only. */
export interface CandidateSender {
  match: RecognisedSender["match"];
  value: string;
  label: string;
  addedAt: Date;
}

/** One of the platform's enabled Recognised senders, and whether the Candidate switched it off for themselves. */
export interface PlatformSender {
  match: RecognisedSender["match"];
  value: string;
  label: string;
  switchedOff: boolean;
}

export type AddCandidateSenderResult =
  | { ok: true; sender: CandidateSender }
  /** invalid: neither an address nor a domain, or a label too long; address_needed: a shared sending platform's domain alone;
   *  already_recognised: the platform's list already reads it; too_many: MAX_CANDIDATE_SENDERS reached. */
  | { ok: false; error: "invalid" | "address_needed" | "already_recognised" | "too_many" };

export interface CandidateSenders {
  /** Those the Candidate added (oldest first), and the platform's enabled ones (by label) with whether they switched each off. */
  list(candidateId: string): Promise<{ own: CandidateSender[]; platform: PlatformSender[] }>;
  /** Adds a sender for the Candidate alone, dated now. `input` is untrusted: { sender: an address or a domain, label? }. Already theirs: kept as it is. */
  add(candidateId: string, input: unknown): Promise<AddCandidateSenderResult>;
  /** Removes a sender they added; nothing else changes. */
  remove(candidateId: string, value: string): Promise<void>;
  /** Switches one of the platform's enabled senders off (`on` false) or back on for the Candidate alone; false when there is no such sender. */
  switchPlatformSender(candidateId: string, value: string, on: boolean): Promise<boolean>;
}

/** How many senders a Candidate may add for themselves. */
export const MAX_CANDIDATE_SENDERS = 50;

/** An email address, as a Candidate pastes one from « De : »: something@domain.tld, no spaces. */
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const domainOf = (address: string): string => address.slice(address.lastIndexOf("@") + 1);

/** The sender `input` names, as kept: the domain, or the full address on a shared sending platform; else why not. */
function senderOf(input: unknown): Pick<RecognisedSender, "match" | "value"> | "invalid" | "address_needed" {
  if (typeof input !== "string") return "invalid";
  const trimmed = input.trim().toLowerCase();
  if (trimmed.includes("@")) {
    const domain = jobDiscoveryDomain(domainOf(trimmed));
    if (!EMAIL_ADDRESS.test(trimmed) || !domain) return "invalid";
    return isSharedSendingPlatform(domain) ? { match: "address", value: trimmed } : { match: "domain", value: domain };
  }
  const domain = jobDiscoveryDomain(trimmed);
  if (!domain) return "invalid";
  return isSharedSendingPlatform(domain) ? "address_needed" : { match: "domain", value: domain };
}

/** Whether a platform sender already reads what `sender` names: the same address, or a domain it is under. */
function covers(platform: Pick<RecognisedSender, "match" | "value">, sender: Pick<RecognisedSender, "match" | "value">): boolean {
  if (platform.match === "address") return sender.match === "address" && sender.value === platform.value;
  const domain = sender.match === "address" ? domainOf(sender.value) : sender.value;
  return domain === platform.value || domain.endsWith(`.${platform.value}`);
}

const fieldsOf = (input: unknown): Record<string, unknown> => (typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {});

/**
 * The Recognised senders whose emails Email intake reads for the Candidate: the platform's enabled ones, less those
 * they switched off, and those they added. `within` is the caller's transaction or the pool.
 */
export async function recognisedSendersFor(within: Queryable, candidateId: string): Promise<RecognisedSender[]> {
  const { rows } = await within.query<RecognisedSender>(
    `SELECT match, value, label, aligned FROM recognised_sender platform
     WHERE enabled AND NOT EXISTS (SELECT 1 FROM candidate_switched_off_sender off WHERE off.candidate_id = $1 AND off.value = platform.value)
     UNION ALL
     SELECT match, value, label, false FROM candidate_recognised_sender WHERE candidate_id = $1`,
    [candidateId],
  );
  return rows;
}

export function createCandidateSenders(database: Pool, options: { now?: () => Date } = {}): CandidateSenders {
  const now = options.now ?? (() => new Date());

  async function own(candidateId: string): Promise<CandidateSender[]> {
    const { rows } = await database.query<CandidateSender>(
      `SELECT match, value, label, added_at AS "addedAt" FROM candidate_recognised_sender WHERE candidate_id = $1 ORDER BY added_at, value`,
      [candidateId],
    );
    return rows;
  }

  return {
    async list(candidateId) {
      const [mine, platform] = await Promise.all([
        own(candidateId),
        database.query<PlatformSender>(
          `SELECT match, value, label, EXISTS (SELECT 1 FROM candidate_switched_off_sender off WHERE off.candidate_id = $1 AND off.value = platform.value) AS "switchedOff"
           FROM recognised_sender platform WHERE enabled`,
          [candidateId],
        ),
      ]);
      return { own: mine, platform: platform.rows.sort((a, b) => a.label.localeCompare(b.label, "fr") || a.value.localeCompare(b.value)) };
    },

    async add(candidateId, input) {
      const fields = fieldsOf(input);
      const sender = senderOf(fields.sender);
      if (typeof sender === "string") return { ok: false, error: sender };
      const given = typeof fields.label === "string" ? fields.label.trim().replace(/\s+/g, " ") : "";
      if (fields.label !== undefined && typeof fields.label !== "string") return { ok: false, error: "invalid" };
      if (given.length > MAX_SENDER_LABEL_LENGTH) return { ok: false, error: "invalid" };
      const label = given || sender.value;

      const { rows: platform } = await database.query<Pick<RecognisedSender, "match" | "value">>(`SELECT match, value FROM recognised_sender WHERE enabled`);
      if (platform.some((listed) => covers(listed, sender))) return { ok: false, error: "already_recognised" };

      const { rows } = await database.query<CandidateSender>(
        `WITH kept AS (
           SELECT match, value, label, added_at FROM candidate_recognised_sender WHERE candidate_id = $1 AND value = $3
         ), added AS (
           INSERT INTO candidate_recognised_sender (candidate_id, match, value, label, added_at)
           SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM kept)
             AND (SELECT count(*) FROM candidate_recognised_sender WHERE candidate_id = $1) < $6
           ON CONFLICT DO NOTHING RETURNING match, value, label, added_at
         )
         SELECT match, value, label, added_at AS "addedAt" FROM kept UNION ALL SELECT match, value, label, added_at FROM added`,
        [candidateId, sender.match, sender.value, label, now(), MAX_CANDIDATE_SENDERS],
      );
      return rows[0] ? { ok: true, sender: rows[0] } : { ok: false, error: "too_many" };
    },

    async remove(candidateId, value) {
      await database.query(`DELETE FROM candidate_recognised_sender WHERE candidate_id = $1 AND value = $2`, [candidateId, value.trim().toLowerCase()]);
    },

    async switchPlatformSender(candidateId, value, on) {
      const { rows } = await database.query<{ found: boolean }>(
        on
          ? `WITH gone AS (DELETE FROM candidate_switched_off_sender WHERE candidate_id = $1 AND value = $2 RETURNING 1)
             SELECT EXISTS (SELECT 1 FROM recognised_sender WHERE value = $2 AND enabled) AS found`
          : `WITH platform AS (SELECT value FROM recognised_sender WHERE value = $2 AND enabled),
                  off AS (INSERT INTO candidate_switched_off_sender (candidate_id, value, switched_off_at) SELECT $1, value, $3 FROM platform ON CONFLICT DO NOTHING RETURNING 1)
             SELECT EXISTS (SELECT 1 FROM platform) AS found`,
        on ? [candidateId, value.trim().toLowerCase()] : [candidateId, value.trim().toLowerCase(), now()],
      );
      return rows[0]!.found;
    },
  };
}

/**
 * How far the Candidate's forwarding setup got (#451), as the setup wizard polls it: their Forwarding address in use,
 * Gmail's forwarding confirmation if one reached it (its code and link, read from its text kept encrypted), and the
 * first email that reached it (whatever became of it: it shows the forwarding works).
 *
 *   const setup = await forwardingSetupOf(database, cipher, candidateId); // null while Email intake is off
 *   setup?.confirmation?.code; // « 123456789 », for the Candidate to type in Gmail
 *
 * Only what reached the address in use counts: what reached an address replaced or switched off, before it was given,
 * belongs to an earlier setup.
 */
import type { Pool } from "pg";
import type { SecretCipher } from "../provider-secrets/cipher";
import { gmailConfirmationOf } from "./gmail-confirmation";
import { receivedTextOf } from "./inbound";

export interface ForwardingSetup {
  /** The Forwarding address in use, and when it was given. */
  address: string;
  activatedAt: Date;
  /** Gmail's latest forwarding confirmation; its code and link null when its text cannot be read (purged, no master key). */
  confirmation: { code: string | null; link: string | null; receivedAt: Date } | null;
  /** The first email other than Gmail's confirmation, and what became of it (a ReceivedOfferEmailOutcome, or one the reading gave). */
  firstEmail: { outcome: string; receivedAt: Date } | null;
}

export async function forwardingSetupOf(database: Pool, cipher: SecretCipher | null, candidateId: string): Promise<ForwardingSetup | null> {
  const { rows } = await database.query<{ address: string; activatedAt: Date }>(
    `SELECT address, activated_at AS "activatedAt" FROM forwarding_address WHERE candidate_id = $1 AND state = 'active'`,
    [candidateId],
  );
  const inUse = rows[0];
  if (!inUse) return null;

  const [confirmations, firsts] = await Promise.all([
    database.query<{ id: string; receivedAt: Date }>(
      `SELECT id, received_at AS "receivedAt" FROM received_offer_email
       WHERE candidate_id = $1 AND outcome = 'forwarding_confirmation' AND received_at >= $2 ORDER BY received_at DESC LIMIT 1`,
      [candidateId, inUse.activatedAt],
    ),
    database.query<{ outcome: string; receivedAt: Date }>(
      `SELECT outcome, received_at AS "receivedAt" FROM received_offer_email
       WHERE candidate_id = $1 AND outcome <> 'forwarding_confirmation' AND received_at >= $2 ORDER BY received_at, id LIMIT 1`,
      [candidateId, inUse.activatedAt],
    ),
  ]);
  const confirmation = confirmations.rows[0];
  const text = confirmation && cipher ? await receivedTextOf(database, cipher, confirmation.id) : null;
  return {
    address: inUse.address,
    activatedAt: inUse.activatedAt,
    confirmation: confirmation ? { ...(text ? gmailConfirmationOf(text) : { code: null, link: null }), receivedAt: confirmation.receivedAt } : null,
    firstEmail: firsts.rows[0] ?? null,
  };
}

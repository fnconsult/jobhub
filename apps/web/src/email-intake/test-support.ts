/**
 * Seeds Received offer emails for tests, as Email intake's door (inbound.ts) and the worker's reading (reading.ts)
 * would have left them: the row (outcome, sender's domain, dates, never a text) and the offers it gave, in order.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ReceivedOfferEmailOutcome } from "./inbound";
import type { ReadEmailOffer, ReceivedOfferEmailKind } from "./reading";

export interface SeededReceivedOfferEmail {
  candidateId: string;
  /** Default « offers found » when it gives offers, else « autre ». */
  outcome?: ReceivedOfferEmailOutcome;
  kind?: ReceivedOfferEmailKind | null;
  /** Default `alerts.example.test`. */
  senderDomain?: string;
  receivedAt: Date;
  /** When it was read; default `receivedAt`. */
  readAt?: Date;
  offers?: readonly ReadEmailOffer[];
}

/** One Received offer email as stored once read (or set aside); its id. Run after Email intake's and its readings' migrations. */
export async function seedReceivedOfferEmail(database: Pool, email: SeededReceivedOfferEmail): Promise<string> {
  const id = randomUUID();
  const offers = email.offers ?? [];
  const outcome = email.outcome ?? (offers.length > 0 ? "offers_found" : "other");
  await database.query(
    `INSERT INTO received_offer_email (id, candidate_id, message_id, outcome, kind, sender_domain, received_at, read_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, email.candidateId, `<${id}@mail.example.test>`, outcome, email.kind ?? (offers.length > 0 ? "alert" : null), email.senderDomain ?? "alerts.example.test", email.receivedAt, email.readAt ?? email.receivedAt],
  );
  for (const [position, offer] of offers.entries()) {
    await database.query(
      `INSERT INTO received_offer_email_offer
         (received_offer_email_id, position, candidate_id, disposition, job_offer_id, profile_id, match_score, title, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        position,
        email.candidateId,
        offer.disposition,
        "jobOfferId" in offer ? offer.jobOfferId : null,
        offer.disposition === "new" ? offer.profileId : null,
        offer.disposition === "new" ? offer.matchScore : null,
        offer.disposition === "to_capture" ? offer.title : null,
        offer.disposition === "to_capture" ? offer.link : null,
      ],
    );
  }
  return id;
}

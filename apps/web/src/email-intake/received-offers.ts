/**
 * What Email intake gave a Candidate, as the rest of the app reads it (#447): the Job Offers its Received offer emails
 * brought to each Profile (or « Non classées »), for the Recherches d'offres page and the Job Digest.
 *
 *   const received = createReceivedOffers(database);
 *   await received.givenTo(candidateId, profileId, since, until); // the Job Digest's: Job Offer ids, newest first
 *
 * Only the offers new for the Candidate count (an offer « déjà vue », too old or « À capturer » made none for them).
 * Whether the Candidate may see a Job Offer (ADR-0049) is the reader's to check, as for any id.
 */
import type { Pool } from "pg";

export interface ReceivedOffers {
  /**
   * The Job Offers Email intake gave the Profile from the emails read after `since`, up to `until`, newest first:
   * what the Profile's Job Digest adds to the Job Offers stored since its previous one.
   */
  givenTo(candidateId: string, profileId: string, since: Date, until: Date): Promise<string[]>;
}

export function createReceivedOffers(database: Pool): ReceivedOffers {
  return {
    async givenTo(candidateId, profileId, since, until) {
      const { rows } = await database.query<{ id: string }>(
        `SELECT offer.job_offer_id AS id
           FROM received_offer_email_offer offer JOIN received_offer_email email ON email.id = offer.received_offer_email_id
          WHERE offer.candidate_id = $1 AND offer.profile_id = $2 AND offer.disposition = 'new'
            AND email.read_at > $3 AND email.read_at <= $4
          ORDER BY email.read_at DESC, offer.position`,
        [candidateId, profileId, since, until],
      );
      return [...new Set(rows.map((row) => row.id))];
    },
  };
}

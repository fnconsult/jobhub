/**
 * The worker's side of a Received offer email (#445, ADR-0052): what it reads, and what it records once read.
 *
 *   const readings = createEmailReadings(database, { cipher });
 *   const email = await readings.startTry(id);              // null: not awaiting reading (read, set aside, gone)
 *   await readings.alreadyThere(email.candidateId, jobOfferId); // « déjà vue »: in a Job Search, Job Digest, earlier email or Application of theirs
 *   await readings.progress(id, events);                     // its live steps, while it is read
 *   await readings.read(id, { kind, offers });               // offers found, or « autre »: its text deleted
 *   await readings.tryFailed(id) / readings.failed(id);      // a try that failed: text kept to try again / « échec »
 *
 * Each try is counted when it starts, so a worker that dies mid-try still uses one. Once read or failed, its text is
 * deleted and its live steps cleared; what is kept is the kind, the outcome, the sender's domain and the offers it
 * gave (`received_offer_email_offer`): the Job Offers new for the Candidate with the Profile each went to (none:
 * « Non classées ») and its Match Score, those already there for them, and those « À capturer » (a Forbidden site's,
 * kept with their title and link, no Job Offer).
 */
import type { ProvenanceEvent } from "@jobhub/shared";
import type { Pool } from "pg";
import { inTransaction } from "../database/pool";
import { recordReading } from "./activity";
import type { SecretCipher } from "../provider-secrets/cipher";
import { receivedTextOf } from "./inbound";

/** The kind of a Received offer email, as the AI read it. */
export type ReceivedOfferEmailKind = "alert" | "recruiter" | "other";

/** What became of an offer an email gave. */
export type EmailOfferDisposition = "new" | "seen" | "to_capture" | "too_old";

/** One offer an email gave, as its reading records it. */
export type ReadEmailOffer =
  /** A Job Offer new for the Candidate: the Profile it went to (null: « Non classées ») and its Match Score there. */
  | { disposition: "new"; jobOfferId: string; profileId: string | null; matchScore: number }
  /** A Job Offer already there for the Candidate (« déjà vue »): shown nowhere again. */
  | { disposition: "seen"; jobOfferId: string }
  /** An offer linking to a Forbidden site: no Job Offer, kept for « À capturer ». */
  | { disposition: "to_capture"; title: string; link: string }
  /** An offer published more than 30 days ago: no Job Offer shown. */
  | { disposition: "too_old" };

/** One Received offer email to read: its text, and what the reading needs to know of it. */
export interface EmailToRead {
  id: string;
  candidateId: string;
  /** The From address's domain. */
  senderDomain: string;
  /** Forwarded by the Candidate by hand from one of their own addresses: its sender's domain is theirs. */
  manualForward: boolean;
  receivedAt: Date;
  /** When the email says it was sent; null when it says none. */
  sentAt: Date | null;
  /** Its text; null once purged (72 hours after it arrived). */
  text: string | null;
  /** This try's number, from 1. */
  try: number;
}

export interface EmailReadings {
  /** Starts one more try at reading the email, counted now; null when it is not awaiting reading. */
  startTry(id: string): Promise<EmailToRead | null>;
  /** Whether the Job Offer is already there for the Candidate: in a Job Search, a Job Digest, an earlier email or an Application of theirs. */
  alreadyThere(candidateId: string, jobOfferId: string): Promise<boolean>;
  /** Writes its live steps (each step's latest event), for AI Activity while it is read. */
  progress(id: string, events: ProvenanceEvent[]): Promise<void>;
  /** Records its reading: offers found when it gave any, else « autre »; its text deleted, its live steps cleared. */
  read(id: string, reading: { kind: ReceivedOfferEmailKind; offers: readonly ReadEmailOffer[] }): Promise<void>;
  /** A try that failed with tries left: its text kept to try again, its live steps cleared. */
  tryFailed(id: string): Promise<void>;
  /** Its last try failed: « échec », its text deleted, its live steps cleared. */
  failed(id: string): Promise<void>;
}

export function createEmailReadings(database: Pool, options: { cipher: () => SecretCipher | null; now?: () => Date }): EmailReadings {
  const now = options.now ?? (() => new Date());
  return {
    async startTry(id) {
      const { rows } = await database.query<Omit<EmailToRead, "text">>(
        `UPDATE received_offer_email SET read_tries = read_tries + 1
          WHERE id = $1 AND outcome = 'awaiting_reading'
          RETURNING id, candidate_id AS "candidateId", sender_domain AS "senderDomain", manual_forward AS "manualForward",
                    received_at AS "receivedAt", sent_at AS "sentAt", read_tries AS "try"`,
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      const cipher = options.cipher();
      return { ...row, text: cipher ? await receivedTextOf(database, cipher, id) : null };
    },

    async alreadyThere(candidateId, jobOfferId) {
      const { rows } = await database.query<{ there: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM application WHERE candidate_id = $1 AND job_offer_id = $2::uuid)
             OR EXISTS (SELECT 1 FROM job_search WHERE candidate_id = $1 AND $2::uuid = ANY (job_offer_ids))
             OR EXISTS (SELECT 1 FROM job_digest WHERE candidate_id = $1 AND $2::uuid = ANY (job_offer_ids))
             OR EXISTS (SELECT 1 FROM received_offer_email_offer WHERE candidate_id = $1 AND job_offer_id = $2::uuid) AS there`,
        [candidateId, jobOfferId],
      );
      return rows[0]!.there;
    },

    async progress(id, events) {
      await database.query(`UPDATE received_offer_email SET progress = $2::jsonb WHERE id = $1 AND outcome = 'awaiting_reading'`, [id, JSON.stringify(events)]);
    },

    async read(id, { kind, offers }) {
      await inTransaction(database, async (client) => {
        const { rows } = await client.query<{ candidateId: string }>(
          `UPDATE received_offer_email
              SET outcome = $2, kind = $3, read_at = $4, progress = NULL,
                  text_ciphertext = NULL, text_iv = NULL, text_tag = NULL, text_key_version = NULL
            WHERE id = $1 AND outcome = 'awaiting_reading'
            RETURNING candidate_id AS "candidateId"`,
          [id, offers.length > 0 ? "offers_found" : "other", kind, now()],
        );
        const candidateId = rows[0]?.candidateId;
        if (!candidateId) return;
        // Its row of Activité › Emails reçus (#449): the counts only, naming no Candidate.
        await recordReading(client, id, {
          kind,
          newOffers: offers.filter((offer) => offer.disposition === "new").length,
          alreadyStored: offers.filter((offer) => offer.disposition === "seen").length,
          outcome: offers.length > 0 ? "offers_found" : "other",
        });
        for (const [position, offer] of offers.entries()) {
          await client.query(
            `INSERT INTO received_offer_email_offer
               (received_offer_email_id, position, candidate_id, disposition, job_offer_id, profile_id, match_score, title, link)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              id,
              position,
              candidateId,
              offer.disposition,
              "jobOfferId" in offer ? offer.jobOfferId : null,
              offer.disposition === "new" ? offer.profileId : null,
              offer.disposition === "new" ? offer.matchScore : null,
              offer.disposition === "to_capture" ? offer.title : null,
              offer.disposition === "to_capture" ? offer.link : null,
            ],
          );
        }
      });
    },

    async tryFailed(id) {
      await database.query(`UPDATE received_offer_email SET progress = NULL WHERE id = $1`, [id]);
    },

    async failed(id) {
      await inTransaction(database, async (client) => {
        const { rowCount } = await client.query(
          `UPDATE received_offer_email
              SET outcome = 'failed', read_at = $2, progress = NULL,
                  text_ciphertext = NULL, text_iv = NULL, text_tag = NULL, text_key_version = NULL
            WHERE id = $1 AND outcome = 'awaiting_reading'`,
          [id, now()],
        );
        if (rowCount) await recordReading(client, id, { outcome: "failed" });
      });
    },
  };
}

/** Creates or upgrades the table of the offers each Received offer email gave. Run after Email intake's, the Profiles' and the Job Offers' migrations. */
export async function migrateEmailReadings(database: Pool): Promise<void> {
  await database.query(`
    -- The offers a Received offer email gave (#445), in its order: a Job Offer new for the Candidate (with the Profile
    -- it went to, null for « Non classées », and its Match Score), one already there for them (« déjà vue »), one
    -- linking to a Forbidden site (« À capturer »: its title and link, no Job Offer), or one too old.
    CREATE TABLE IF NOT EXISTS received_offer_email_offer (
      received_offer_email_id text NOT NULL REFERENCES received_offer_email (id) ON DELETE CASCADE,
      position integer NOT NULL,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      disposition text NOT NULL CHECK (disposition IN ('new', 'seen', 'to_capture', 'too_old')),
      job_offer_id uuid REFERENCES job_offer (id) ON DELETE CASCADE,
      profile_id uuid REFERENCES profile (id) ON DELETE CASCADE,
      match_score integer,
      title text,
      link text,
      PRIMARY KEY (received_offer_email_id, position)
    );
    CREATE INDEX IF NOT EXISTS received_offer_email_offer_candidate ON received_offer_email_offer (candidate_id, job_offer_id);
  `);
}

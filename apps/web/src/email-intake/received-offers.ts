/**
 * What Email intake gave a Candidate, as the rest of the app reads it (#447): the Job Offers its Received offer emails
 * brought to each Profile (or « Non classées »), the emails it ignored this week and whether their filter is too broad,
 * for the Recherches d'offres page; and, for the Job Digest, the Job Offers it gave one Profile.
 *
 *   const received = createReceivedOffers(database, { jobOffers, profiles, applications });
 *   await received.overview(candidateId, { broadFilterThreshold }); // the « Reçues par email » section
 *   await received.givenTo(candidateId, profileId, since, until);   // the Job Digest's: Job Offer ids, newest first
 *
 * Only the offers new for the Candidate count (an offer « déjà vue », too old or « À capturer » made none for them),
 * and only the Job Offers they may see (never another Candidate's private one, ADR-0049). « Cette semaine » is the
 * week in France, from Monday 00:00 Paris time, as for Plan Quotas. Nothing here reads or returns an email's content:
 * an ignored email is its reason, its sender's domain and its date.
 */
import { scoreMatch, type JobOffer, type MatchScore } from "@jobhub/shared";
import type { Pool } from "pg";
import type { Applications } from "../applications";
import { visibleTo, type JobOffers } from "../job-offers";
import type { Profiles } from "../profiles";

/** At most this many Job Offers are listed per Profile, and in « Non classées », newest first. */
export const MAX_LISTED = 50;

const TIME_ZONE = "Europe/Paris";
/** Monday 00:00 Paris time of the week of `$n`, as a timestamptz. */
const weekStart = (param: string) => `(date_trunc('week', ${param}::timestamptz AT TIME ZONE '${TIME_ZONE}') AT TIME ZONE '${TIME_ZONE}')`;

/** One Job Offer Email intake gave a Profile: scored now against it, as Job Search results are. */
export interface ReceivedOffer {
  jobOffer: JobOffer;
  matchScore: MatchScore;
  /** The Candidate's Application for this Job Offer, if they saved it. */
  applicationId: string | null;
  /** When the email that brought it arrived. */
  receivedAt: Date;
  /** The domain of the email's sender. */
  senderDomain: string;
}

/** One Job Offer no Profile scored 60 or more for (« Non classées »): its best Match Score when it was read. */
export interface UnclassifiedOffer {
  jobOffer: JobOffer;
  matchScore: number;
  applicationId: string | null;
  receivedAt: Date;
  senderDomain: string;
}

/** Why an email gave the Candidate nothing (« mails ignorés »): « autre », unrecognised sender, a Guardrail, « échec ». */
export type IgnoredReason = "other" | "unrecognised_sender" | "guardrail" | "failed";
const IGNORED_REASONS: readonly IgnoredReason[] = ["other", "unrecognised_sender", "guardrail", "failed"];

/** An email ignored this week: never its content. */
export interface IgnoredEmail {
  reason: IgnoredReason;
  senderDomain: string;
  receivedAt: Date;
}

export interface ReceivedOffersOverview {
  /** By Profile id: the Job Offers its emails brought (newest first, at most MAX_LISTED) and how many arrived this week (« nouvelles »). */
  byProfile: Record<string, { offers: ReceivedOffer[]; fresh: number }>;
  /** « Non classées »: the Job Offers no Profile scored 60 or more for. */
  unclassified: { offers: UnclassifiedOffer[]; fresh: number };
  /** The emails ignored this week, newest first. */
  ignored: IgnoredEmail[];
  /** « Filtre trop large »: the latest day this week (Paris, `YYYY-MM-DD`) that many emails reached the Forwarding address, from the threshold up; null when none did. */
  tooBroad: { day: string; count: number } | null;
}

export interface ReceivedOffers {
  /** What the Recherches d'offres page shows of Email intake for the Candidate. `broadFilterThreshold`: EMAIL_INTAKE_BROAD_FILTER_THRESHOLD in use. */
  overview(candidateId: string, settings: { broadFilterThreshold: number }): Promise<ReceivedOffersOverview>;
  /**
   * The Job Offers Email intake gave the Profile from the emails read after `since`, up to `until`, newest first:
   * what the Profile's Job Digest adds to the Job Offers stored since its previous one. Whether the Candidate may
   * still see each is the Job Digest's to check, as for any id.
   */
  givenTo(candidateId: string, profileId: string, since: Date, until: Date): Promise<string[]>;
}

export interface ReceivedOffersDeps {
  jobOffers: Pick<JobOffers, "get">;
  profiles: Pick<Profiles, "get">;
  applications: Pick<Applications, "list">;
  now?: () => Date;
}

interface OfferRow {
  jobOfferId: string;
  profileId: string | null;
  matchScore: number;
  receivedAt: Date;
  senderDomain: string;
  fresh: boolean;
}

export function createReceivedOffers(database: Pool, deps: ReceivedOffersDeps): ReceivedOffers {
  const now = deps.now ?? (() => new Date());

  /** The new Job Offers the Candidate's emails gave and they may see, newest first, each once. */
  async function offersOf(candidateId: string, at: Date): Promise<OfferRow[]> {
    const { rows } = await database.query<OfferRow>(
      `SELECT offer.job_offer_id AS "jobOfferId", offer.profile_id AS "profileId", offer.match_score AS "matchScore",
              email.received_at AS "receivedAt", email.sender_domain AS "senderDomain", email.received_at >= ${weekStart("$2")} AS fresh
         FROM received_offer_email_offer offer
         JOIN received_offer_email email ON email.id = offer.received_offer_email_id
         JOIN job_offer ON job_offer.id = offer.job_offer_id
        WHERE offer.candidate_id = $1 AND offer.disposition = 'new' AND ${visibleTo("$1", "job_offer")}
        ORDER BY email.received_at DESC, offer.position`,
      [candidateId, at],
    );
    const seen = new Set<string>();
    return rows.filter((row) => !seen.has(row.jobOfferId) && seen.add(row.jobOfferId));
  }

  async function ignoredOf(candidateId: string, at: Date): Promise<IgnoredEmail[]> {
    const { rows } = await database.query<IgnoredEmail>(
      `SELECT outcome AS reason, sender_domain AS "senderDomain", received_at AS "receivedAt" FROM received_offer_email
        WHERE candidate_id = $1 AND outcome = ANY($2::text[]) AND received_at >= ${weekStart("$3")} AND received_at <= $3
        ORDER BY received_at DESC, id`,
      [candidateId, IGNORED_REASONS, at],
    );
    return rows;
  }

  /** The latest Paris day this week whose emails reached `threshold`; Gmail's forwarding confirmation is not one. */
  async function tooBroadOf(candidateId: string, at: Date, threshold: number): Promise<ReceivedOffersOverview["tooBroad"]> {
    const { rows } = await database.query<{ day: string; count: number }>(
      `SELECT to_char((received_at AT TIME ZONE '${TIME_ZONE}')::date, 'YYYY-MM-DD') AS day, count(*)::int AS count FROM received_offer_email
        WHERE candidate_id = $1 AND outcome <> 'forwarding_confirmation' AND received_at >= ${weekStart("$2")} AND received_at <= $2
        GROUP BY 1 HAVING count(*) >= $3 ORDER BY 1 DESC LIMIT 1`,
      [candidateId, at, threshold],
    );
    return rows[0] ?? null;
  }

  return {
    async overview(candidateId, { broadFilterThreshold }) {
      const at = now();
      const [offers, ignored, tooBroad, saved] = await Promise.all([
        offersOf(candidateId, at),
        ignoredOf(candidateId, at),
        tooBroadOf(candidateId, at, broadFilterThreshold),
        deps.applications.list(candidateId),
      ]);
      const applicationOf = new Map(saved.map((application) => [application.jobOffer.id, application.id]));
      const groups = new Map<string | null, OfferRow[]>();
      for (const row of offers) groups.set(row.profileId, [...(groups.get(row.profileId) ?? []), row]);

      const listed = async (rows: OfferRow[]) =>
        (await Promise.all(rows.slice(0, MAX_LISTED).map(async (row) => ({ row, jobOffer: await deps.jobOffers.get(row.jobOfferId, candidateId) })))).filter(
          (found): found is { row: OfferRow; jobOffer: JobOffer } => found.jobOffer !== null,
        );
      const fresh = (rows: OfferRow[]) => rows.filter((row) => row.fresh).length;
      const facts = (row: OfferRow, jobOffer: JobOffer) => ({
        jobOffer,
        applicationId: applicationOf.get(jobOffer.id) ?? null,
        receivedAt: row.receivedAt,
        senderDomain: row.senderDomain,
      });

      const byProfile: ReceivedOffersOverview["byProfile"] = {};
      for (const [profileId, rows] of groups) {
        if (profileId === null) continue;
        const profile = await deps.profiles.get(candidateId, profileId);
        if (!profile) continue;
        byProfile[profileId] = {
          offers: (await listed(rows)).map(({ row, jobOffer }) => ({
            ...facts(row, jobOffer),
            matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }),
          })),
          fresh: fresh(rows),
        };
      }
      const unclassified = groups.get(null) ?? [];
      return {
        byProfile,
        unclassified: { offers: (await listed(unclassified)).map(({ row, jobOffer }) => ({ ...facts(row, jobOffer), matchScore: row.matchScore })), fresh: fresh(unclassified) },
        ignored,
        tooBroad,
      };
    },

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

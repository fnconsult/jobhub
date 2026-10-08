/**
 * Job Digests: the recurring email and in-app summary of new Job Offers
 * matching a Profile's Search Criteria (CONTEXT.md).
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createJobDigests(database, deps)`:
 *    - the Candidate's side, per Profile: `settings` (opted in or not, how
 *      often their Plan sends it, the latest Job Digests), `subscribe` (opt in;
 *      refused when the Plan does not include it) and `unsubscribe`;
 *    - the email's side: `unsubscribeByToken`, for the unsubscribe link and
 *      the one-click List-Unsubscribe header (RFC 8058). No session needed:
 *      the token names one Profile's opt-in;
 *    - the worker's side: `claimDue` (the opted-in Profiles due now, at their
 *      Plan's frequency) and `deliver` (keep, and email in the Candidate's
 *      Interface Language, the Job Offers found that this Profile was never
 *      shown before).
 *  - `migrateJobDigests(database)` creates / upgrades the tables.
 * A Job Offer counts as shown once it was in a Job Digest of the Profile, or
 * once the Candidate saved it as an Application. Opt-ins and Job Digests
 * belong to their Profile and are deleted with it (ADR-0010); the Job Offers
 * they list are kept.
 */
import { PLANS, scoreMatch, type JobDigestFrequency, type JobOffer, type MatchScore, type Plan } from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Applications } from "../applications";
import type { Mailer } from "../auth";
import type { Billing } from "../billing";
import type { JobOffers } from "../job-offers";
import type { Profile, Profiles } from "../profiles";
import { routes } from "../routes";

/** One Job Offer in a Job Digest. */
export interface JobDigestResult {
  jobOffer: JobOffer;
  /** The Profile's current Master CV against the Job Offer and the Profile's Search Criteria. */
  matchScore: MatchScore;
}

export interface JobDigest {
  id: string;
  sentAt: Date;
  /** Best Match Score first. Never empty. */
  results: JobDigestResult[];
}

export interface JobDigestSettings {
  /** Whether the Candidate opted in to the Job Digest of this Profile. */
  subscribed: boolean;
  /** How often the Candidate's Plan sends it; "none" when the Plan does not include it. */
  frequency: JobDigestFrequency;
  /** The cheapest Plan that includes the Job Digest, when the Candidate's does not. */
  upgradeTo: Plan | null;
  /** The latest Job Digests of the Profile (at most LATEST_DIGESTS), newest first. */
  digests: JobDigest[];
}

export type SubscribeResult =
  | { ok: true; settings: JobDigestSettings }
  /** No such Profile for this Candidate. */
  | { ok: false; error: "not_found" }
  /** Archived Profiles are set aside: restore it first. */
  | { ok: false; error: "archived" }
  /** The Candidate's Plan has no Job Digest. */
  | { ok: false; error: "not_included"; plan: Plan; upgradeTo: Plan | null };

/** An opted-in Profile whose Job Digest is due. */
export interface DueJobDigest {
  candidateId: string;
  profileId: string;
}

export interface JobDigests {
  /** The Job Digest of one of the Candidate's Profiles, or null if the Profile is not theirs. */
  settings(candidateId: string, profileId: string): Promise<JobDigestSettings | null>;
  /** Opts in to the Job Digest of a Profile. Opting in again changes nothing. */
  subscribe(candidateId: string, profileId: string): Promise<SubscribeResult>;
  /** Opts out of the Job Digest of a Profile. */
  unsubscribe(candidateId: string, profileId: string): Promise<void>;
  /** Opts out with the token of an email's unsubscribe link. False when the token names no opt-in (any more). */
  unsubscribeByToken(token: string): Promise<boolean>;
  /**
   * The opted-in, active Profiles whose Job Digest is due now: never run yet,
   * or last run one period of the Candidate's Plan ago. Each is claimed: it is
   * not due again before its next period, so concurrent calls never share one.
   */
  claimDue(): Promise<DueJobDigest[]>;
  /**
   * Makes the Job Digest of a Profile from the Job Offers Job discovery found:
   * those never shown before, best Match Score first (at most MAX_RESULTS),
   * kept for the Profile page and emailed. Null, and nothing sent, when none
   * is new, or the Profile is not opted in (or not the Candidate's, or
   * archived), or the Candidate's Plan no longer includes the Job Digest.
   */
  deliver(candidateId: string, profileId: string, jobOfferIds: string[]): Promise<JobDigest | null>;
}

export interface JobDigestsDeps {
  profiles: Pick<Profiles, "get">;
  jobOffers: Pick<JobOffers, "get">;
  applications: Pick<Applications, "list">;
  billing: Pick<Billing, "entitlements" | "planQuotas">;
  mailer: Mailer;
  /** Public origin of the web app; the email's links point here. */
  baseURL: string;
  now?: () => Date;
}

/** Job Offers in one Job Digest, at most. */
export const MAX_RESULTS = 10;
/** Job Digests shown on the Profile page. */
export const LATEST_DIGESTS = 3;

const HOUR_MS = 3_600_000;
const PERIOD_MS: Record<Exclude<JobDigestFrequency, "none">, number> = { daily: 24 * HOUR_MS, weekly: 7 * 24 * HOUR_MS };
/**
 * The worker looks for due Job Digests every hour, and a run starts a little
 * after the hour: a Job Digest is due up to an hour before its period is over,
 * so it keeps going out at the same hour instead of drifting later.
 */
const SCHEDULE_SLACK_MS = HOUR_MS;

/** Creates or upgrades the Job Digest tables. Run after the Profiles' and Job Offers' migrations. */
export async function migrateJobDigests(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS job_digest_subscription (
      profile_id uuid PRIMARY KEY REFERENCES profile (id) ON DELETE CASCADE,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      unsubscribe_token text NOT NULL UNIQUE,
      subscribed_at timestamptz NOT NULL,
      last_run_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS job_digest (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      job_offer_ids uuid[] NOT NULL,
      sent_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS job_digest_profile_idx ON job_digest (profile_id, sent_at DESC);
  `);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** An unguessable token for the unsubscribe link (RFC 8058). */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The page an email's unsubscribe link opens, in the email's language (it asks before unsubscribing). */
export function unsubscribePageURL(baseURL: string, token: string, locale: Locale): string {
  return new URL(`${routes.jobDigestUnsubscribe}?token=${token}&lang=${locale}`, baseURL).toString();
}

/** The one-click endpoint of the List-Unsubscribe header (RFC 8058): a POST unsubscribes at once. */
export function oneClickUnsubscribeURL(baseURL: string, token: string): string {
  return new URL(`/api/job-digests/unsubscribe?token=${token}`, baseURL).toString();
}

interface DigestRow {
  id: string;
  job_offer_ids: string[];
  sent_at: Date;
}

export function createJobDigests(database: Pool, deps: JobDigestsDeps): JobDigests {
  const now = deps.now ?? (() => new Date());

  async function planOf(candidateId: string): Promise<{ plan: Plan; frequency: JobDigestFrequency }> {
    const { plan, quotas } = await deps.billing.entitlements(candidateId);
    return { plan, frequency: quotas.jobDigest };
  }

  /** The first Plan above `plan` that includes the Job Digest. */
  async function upgradeFor(plan: Plan): Promise<Plan | null> {
    const quotas = await deps.billing.planQuotas();
    return PLANS.slice(PLANS.indexOf(plan) + 1).find((higher) => quotas[higher].jobDigest !== "none") ?? null;
  }

  async function ownProfile(candidateId: string, profileId: string): Promise<Profile | null> {
    return UUID.test(profileId) ? deps.profiles.get(candidateId, profileId) : null;
  }

  /** The Job Offers still stored, scored for the Profile, best Match Score first (stable). */
  async function resultsFor(profile: Profile, jobOfferIds: string[]): Promise<JobDigestResult[]> {
    const found = await Promise.all(jobOfferIds.map((id) => deps.jobOffers.get(id)));
    return found
      .filter((jobOffer): jobOffer is JobOffer => jobOffer !== null)
      .map((jobOffer) => ({ jobOffer, matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }) }))
      .sort((a, b) => b.matchScore.score - a.matchScore.score);
  }

  async function settingsOf(candidateId: string, profile: Profile): Promise<JobDigestSettings> {
    const [{ plan, frequency }, subscription, latest] = await Promise.all([
      planOf(candidateId),
      database.query("SELECT 1 FROM job_digest_subscription WHERE profile_id = $1 AND candidate_id = $2", [profile.id, candidateId]),
      database.query<DigestRow>(
        "SELECT id, job_offer_ids, sent_at FROM job_digest WHERE profile_id = $1 AND candidate_id = $2 ORDER BY sent_at DESC LIMIT $3",
        [profile.id, candidateId, LATEST_DIGESTS],
      ),
    ]);
    const digests = await Promise.all(
      latest.rows.map(async (row) => ({ id: row.id, sentAt: row.sent_at, results: await resultsFor(profile, row.job_offer_ids) })),
    );
    return {
      subscribed: subscription.rows.length > 0,
      frequency,
      upgradeTo: frequency === "none" ? await upgradeFor(plan) : null,
      digests: digests.filter((digest) => digest.results.length > 0),
    };
  }

  /** The Job Offers this Profile was already shown: in its Job Digests, or saved by the Candidate. */
  async function shownTo(candidateId: string, profileId: string): Promise<Set<string>> {
    const [{ rows }, saved] = await Promise.all([
      database.query<{ id: string }>("SELECT DISTINCT unnest(job_offer_ids) AS id FROM job_digest WHERE profile_id = $1", [profileId]),
      deps.applications.list(candidateId),
    ]);
    return new Set([...rows.map((row) => row.id), ...saved.map((application) => application.jobOffer.id)]);
  }

  async function email(candidateId: string, profile: Profile, digest: JobDigest, token: string): Promise<void> {
    const { rows } = await database.query<{ email: string; interfaceLanguage: string | null }>(
      `SELECT email, "interfaceLanguage" FROM candidate WHERE id = $1`,
      [candidateId],
    );
    const candidate = rows[0];
    if (!candidate) return;
    const i18n = createI18n(candidate.interfaceLanguage);
    const { t } = i18n;
    const count = digest.results.length;
    const items = digest.results.map(({ jobOffer, matchScore }) => {
      const where = [jobOffer.employer, jobOffer.location].filter(Boolean).join(", ");
      return [
        `- ${jobOffer.title}${where ? ` (${where})` : ""}`,
        `  ${t("jobDigest.email.matchScore", { score: matchScore.score })}`,
        `  ${new URL(routes.jobOffer(jobOffer.id), deps.baseURL).toString()}`,
      ].join("\n");
    });
    const text = [
      t("jobDigest.email.intro", { count, profile: profile.name }),
      items.join("\n\n"),
      t("jobDigest.email.seeOnProfile", { url: new URL(routes.profile(profile.id), deps.baseURL).toString() }),
      t("jobDigest.email.signature"),
      "--",
      t("jobDigest.email.unsubscribe", { url: unsubscribePageURL(deps.baseURL, token, i18n.language as Locale) }),
    ].join("\n\n");
    await deps.mailer.send({
      to: candidate.email,
      subject: t("jobDigest.email.subject", { count, profile: profile.name }),
      text,
      headers: {
        "List-Unsubscribe": `<${oneClickUnsubscribeURL(deps.baseURL, token)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  }

  return {
    async settings(candidateId, profileId) {
      const profile = await ownProfile(candidateId, profileId);
      return profile ? settingsOf(candidateId, profile) : null;
    },

    async subscribe(candidateId, profileId) {
      const profile = await ownProfile(candidateId, profileId);
      if (!profile) return { ok: false, error: "not_found" };
      if (profile.archived) return { ok: false, error: "archived" };
      const { plan, frequency } = await planOf(candidateId);
      if (frequency === "none") return { ok: false, error: "not_included", plan, upgradeTo: await upgradeFor(plan) };
      await database.query(
        `INSERT INTO job_digest_subscription (profile_id, candidate_id, unsubscribe_token, subscribed_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (profile_id) DO NOTHING`,
        [profile.id, candidateId, newToken(), now()],
      );
      return { ok: true, settings: await settingsOf(candidateId, profile) };
    },

    async unsubscribe(candidateId, profileId) {
      if (!UUID.test(profileId)) return;
      await database.query("DELETE FROM job_digest_subscription WHERE profile_id = $1 AND candidate_id = $2", [profileId, candidateId]);
    },

    async unsubscribeByToken(token) {
      if (!TOKEN.test(token)) return false;
      const { rowCount } = await database.query("DELETE FROM job_digest_subscription WHERE unsubscribe_token = $1", [token]);
      return (rowCount ?? 0) > 0;
    },

    async claimDue() {
      const at = now();
      const shortestPeriod = Math.min(...Object.values(PERIOD_MS));
      const { rows } = await database.query<{ profile_id: string; candidate_id: string }>(
        `SELECT profile_id, candidate_id FROM job_digest_subscription
         WHERE last_run_at IS NULL OR last_run_at <= $1 ORDER BY last_run_at NULLS FIRST`,
        [new Date(at.getTime() - shortestPeriod + SCHEDULE_SLACK_MS)],
      );
      const frequencies = new Map<string, JobDigestFrequency>();
      const due: DueJobDigest[] = [];
      for (const row of rows) {
        if (!frequencies.has(row.candidate_id)) frequencies.set(row.candidate_id, (await planOf(row.candidate_id)).frequency);
        const frequency = frequencies.get(row.candidate_id)!;
        if (frequency === "none") continue;
        const profile = await deps.profiles.get(row.candidate_id, row.profile_id);
        if (!profile || profile.archived) continue;
        const claimed = await database.query(
          `UPDATE job_digest_subscription SET last_run_at = $2
           WHERE profile_id = $1 AND (last_run_at IS NULL OR last_run_at <= $3)`,
          [row.profile_id, at, new Date(at.getTime() - PERIOD_MS[frequency] + SCHEDULE_SLACK_MS)],
        );
        if (claimed.rowCount) due.push({ candidateId: row.candidate_id, profileId: row.profile_id });
      }
      return due;
    },

    async deliver(candidateId, profileId, jobOfferIds) {
      const profile = await ownProfile(candidateId, profileId);
      if (!profile || profile.archived) return null;
      const { rows } = await database.query<{ unsubscribe_token: string }>(
        "SELECT unsubscribe_token FROM job_digest_subscription WHERE profile_id = $1 AND candidate_id = $2",
        [profile.id, candidateId],
      );
      const token = rows[0]?.unsubscribe_token;
      if (!token || (await planOf(candidateId)).frequency === "none") return null;

      const shown = await shownTo(candidateId, profile.id);
      const fresh = [...new Set(jobOfferIds)].filter((id) => UUID.test(id) && !shown.has(id));
      const results = (await resultsFor(profile, fresh)).slice(0, MAX_RESULTS);
      if (results.length === 0) return null;

      const sentAt = now();
      const inserted = await database.query<{ id: string }>(
        "INSERT INTO job_digest (profile_id, candidate_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [profile.id, candidateId, results.map((result) => result.jobOffer.id), sentAt],
      );
      const digest: JobDigest = { id: inserted.rows[0]!.id, sentAt, results };
      try {
        await email(candidateId, profile, digest, token);
      } catch (error) {
        // The Job Digest stays on the Profile page; the email is not sent twice by a retry.
        console.warn("[job-digests] could not email a Job Digest:", error instanceof Error ? error.message : error);
      }
      return digest;
    },
  };
}

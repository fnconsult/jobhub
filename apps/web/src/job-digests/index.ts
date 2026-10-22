/**
 * Job Digests: the recurring email and in-app summary of new Job Offers
 * matching a Profile's Search Criteria (CONTEXT.md).
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createJobDigests(database, deps)`:
 *    - the Candidate's side, per Profile: `settings` (opted in or not, the
 *      frequency they picked and the one their Plan allows, the latest Job
 *      Digests), `subscribe` (opt in, or change the frequency: daily or weekly,
 *      refused above the Plan's) and `unsubscribe`; `get` one Job Digest for its
 *      page, its Job Offers ranked by Match Score;
 *    - the email's side: `unsubscribeByToken`, for the unsubscribe link and
 *      the one-click List-Unsubscribe header (RFC 8058). No session needed:
 *      the token names one Profile's opt-in;
 *    - the worker's side: `claimDue` (the opted-in Profiles due now: daily at
 *      07:00 Europe/Paris, weekly on Monday at 07:00, see ./schedule) and
 *      `deliver` (select the Job Offers, keep the Job Digest and email it in
 *      the Candidate's Interface Language).
 *  - `migrateJobDigests(database)` creates / upgrades the tables.
 *  - `jobDigestsConfigFromEnv(env)`: the Match Score threshold, target count
 *    and how far back the first Job Digest of a Profile looks; the worker reads
 *    it at each delivery (`deps.config`) from the Platform Settings in use, so a
 *    change in the Back Office applies to the next Job Digest (#299).
 *
 * Selecting a Job Digest's Job Offers: the Job Offers stored since the
 * Profile's previous Job Digest (a week back for the first, by default), whoever stored
 * them, except Guest-only and Expired ones and those whose Posting date is
 * more than 30 days ago; scored against the Profile's current Master CV, kept
 * from the threshold up, best first (an undated Job Offer after a dated one
 * with an equal Match Score). The email gives each its Posting date, or says
 * "date unknown". Only when they are fewer than
 * the target count does Job discovery run, its Job Offers scored the same way;
 * if it fails, what the stored Job Offers gave is sent. A Job Offer counts as
 * shown, and is never sent, once it was in a Job Digest or a Job Search of the
 * Profile, or once the Candidate saved it as an Application. Scoring here is
 * the shared, local Match Score: no Plan Quota is used.
 * The frequency sent is the Candidate's choice capped by their Plan; a Plan
 * without the Job Digest sends none, and the choice is kept. Opting out keeps
 * when the Job Digest last ran, so opting in again does not make it due sooner.
 * Opt-ins and Job Digests belong to their Profile and are deleted with it
 * (ADR-0010); the Job Offers they list are kept.
 */
import {
  JOB_DIGEST_FREQUENCIES,
  MAX_POSTING_AGE_DAYS,
  matchScoreReliability,
  rankByMatchScore,
  scoreMatch,
  type JobDigestFrequency,
  type JobOffer,
  type MatchScore,
  type Plan,
} from "@jobhub/shared";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Applications } from "../applications";
import type { Mailer } from "../auth";
import type { Billing, PlanName } from "../billing";
import type { JobOffers } from "../job-offers";
import { readNumberSetting } from "../platform-settings/catalog";
import type { Profile, Profiles } from "../profiles";
import { routes } from "../routes";
import { DIGEST_TIME_ZONE, latestSlot } from "./schedule";

export { DIGEST_HOUR, DIGEST_TIME_ZONE, latestSlot } from "./schedule";

/** How often a Candidate may pick to receive a Job Digest. */
export type ChosenFrequency = Exclude<JobDigestFrequency, "none">;

/** One Job Offer in a Job Digest. */
export interface JobDigestResult {
  jobOffer: JobOffer;
  /** The Profile's current Master CV against the Job Offer and the Profile's Search Criteria. */
  matchScore: MatchScore;
  /** The Candidate's Application for this Job Offer, if they saved it (with any Profile). */
  applicationId: string | null;
}

export interface JobDigest {
  id: string;
  profile: { id: string; name: string };
  sentAt: Date;
  /** Best Match Score first. */
  results: JobDigestResult[];
}

/** A Job Digest as the Profile page lists it. */
export interface JobDigestSummary {
  id: string;
  sentAt: Date;
  /** How many Job Offers it lists. */
  count: number;
}

export interface JobDigestSettings {
  /** Whether the Candidate receives the Job Digest of this Profile: opted in, and their Plan includes it. */
  subscribed: boolean;
  /** What the Candidate picked; null while not opted in. Kept when the Plan stops including it. */
  chosenFrequency: ChosenFrequency | null;
  /** How often it is sent: the Candidate's choice, capped by their Plan; "none" when it is not sent. */
  frequency: JobDigestFrequency;
  /** The most the Candidate's Plan allows; "none" when it does not include the Job Digest. */
  planFrequency: JobDigestFrequency;
  /** The lowest-ranked offered Plan that includes the Job Digest, when the Candidate's does not. */
  upgradeTo: Plan | null;
  /** The latest Job Digests of the Profile (at most LATEST_DIGESTS), newest first. */
  digests: JobDigestSummary[];
}

export type SubscribeResult =
  | { ok: true; settings: JobDigestSettings }
  /** No such Profile for this Candidate. */
  | { ok: false; error: "not_found" }
  /** Archived Profiles are set aside: restore it first. */
  | { ok: false; error: "archived" }
  /** Neither "daily" nor "weekly". */
  | { ok: false; error: "invalid_frequency" }
  /** The Candidate's Plan has no Job Digest. */
  | ({ ok: false; error: "not_included" } & PlanUpgrade)
  /** The Candidate's Plan sends it less often than asked; `upgradeTo` is the lowest-ranked offered Plan that allows it. */
  | ({ ok: false; error: "above_plan"; planFrequency: JobDigestFrequency } & PlanUpgrade);

/** The Candidate's Plan and the one to upgrade to (null when none does), with their names, for the Upgrade Prompt. */
export interface PlanUpgrade {
  plan: Plan;
  planName: PlanName;
  upgradeTo: Plan | null;
  upgradeToName: PlanName | null;
}

/** An opted-in Profile whose Job Digest is due. */
export interface DueJobDigest {
  candidateId: string;
  profileId: string;
}

/** Runs Job discovery for the Profile's Search Criteria: the ids of the Job Offers it found (and stored). */
export type JobDigestDiscovery = () => Promise<string[]>;

export interface JobDigestDelivery {
  /** The Job Digest kept and emailed; null when nothing qualified (or none is due: not opted in, no Plan, archived). */
  digest: JobDigest | null;
  /** Whether Job discovery ran: only when the stored Job Offers gave fewer than the target count. */
  discovery: "not_run" | "ran" | "failed";
}

export interface JobDigests {
  /** The Job Digest of one of the Candidate's Profiles, or null if the Profile is not theirs. */
  settings(candidateId: string, profileId: string): Promise<JobDigestSettings | null>;
  /**
   * Opts in to the Job Digest of a Profile at `frequency` ("daily" or
   * "weekly"; untrusted), or changes it. Refused above the Plan's frequency.
   */
  subscribe(candidateId: string, profileId: string, frequency: unknown): Promise<SubscribeResult>;
  /** Opts out of the Job Digest of a Profile. */
  unsubscribe(candidateId: string, profileId: string): Promise<void>;
  /** Opts out with the token of an email's unsubscribe link. False when the token names no opt-in (any more). */
  unsubscribeByToken(token: string): Promise<boolean>;
  /** One of the Candidate's Job Digests, its Job Offers scored now and ranked; null if it is not theirs. */
  get(candidateId: string, jobDigestId: string): Promise<JobDigest | null>;
  /**
   * The opted-in, active Profiles whose Job Digest is due now: not run since
   * the latest 07:00 Europe/Paris (Monday's, for weekly ones) that came after
   * they opted in. Each is claimed: concurrent calls never share one.
   */
  claimDue(): Promise<DueJobDigest[]>;
  /**
   * Makes the Job Digest of a Profile (see the module comment for how its Job
   * Offers are selected), keeps it and emails it. `discover` runs only when
   * the stored Job Offers give fewer than the target count; if it throws,
   * what they gave is sent. Nothing at all happens, Job discovery included,
   * when the Profile is not opted in (or not the Candidate's, or archived) or
   * the Candidate's Plan has no Job Digest.
   */
  deliver(candidateId: string, profileId: string, discover: JobDigestDiscovery): Promise<JobDigestDelivery>;
}

export interface JobDigestsDeps {
  profiles: Pick<Profiles, "get">;
  jobOffers: Pick<JobOffers, "get">;
  applications: Pick<Applications, "list">;
  /** Plans only: a Job Digest uses no Plan Quota. */
  billing: Pick<Billing, "entitlements" | "plans" | "upgradeFor">;
  mailer: Mailer;
  /** Public origin of the web app; the email's links point here. */
  baseURL: string;
  /**
   * The Match Score threshold, target count and first look-back, read at each delivery, so a
   * Platform Setting changed in the Back Office applies to the next Job Digest without a restart
   * (#299). One left out keeps the code's default.
   */
  config?: () => Partial<JobDigestsConfig>;
  now?: () => Date;
}

/** What a Job Digest selects its Job Offers with: the Platform Settings JOB_DIGEST_* (ADR-0033). */
export interface JobDigestsConfig {
  /** Lowest Match Score a Job Offer needs to be in a Job Digest. Default DEFAULT_MIN_MATCH_SCORE. */
  minMatchScore: number;
  /** How many Job Offers a Job Digest aims for, and holds at most. Default DEFAULT_TARGET_COUNT. */
  targetCount: number;
  /**
   * How many days back the first Job Digest of a Profile looks for stored Job
   * Offers. Default DEFAULT_FIRST_LOOK_BACK_DAYS; 0: it is what Job discovery finds.
   */
  firstLookBackDays: number;
}

// The code's defaults are the Platform Settings catalog's (ADR-0033): one source of truth for each.
export const DEFAULT_MIN_MATCH_SCORE = readNumberSetting({}, "JOB_DIGEST_MIN_MATCH_SCORE");
export const DEFAULT_TARGET_COUNT = readNumberSetting({}, "JOB_DIGEST_TARGET_COUNT");
/** Job Offers listed in a Job Digest's email, at most; the page lists them all. */
export const EMAIL_MAX_RESULTS = 10;
/** Job Digests listed on the Profile page. */
export const LATEST_DIGESTS = 5;
/** How many days back the first Job Digest of a Profile looks for stored Job Offers. */
export const DEFAULT_FIRST_LOOK_BACK_DAYS = readNumberSetting({}, "JOB_DIGEST_FIRST_LOOK_BACK_DAYS");
const DAY_MS = 86_400_000;
/** Stored Job Offers scored for one Job Digest, at most (the most recent). */
const POOL_MAX = 1_000;

/**
 * The Match Score threshold, target count and first look-back, from
 * JOB_DIGEST_MIN_MATCH_SCORE, JOB_DIGEST_TARGET_COUNT and JOB_DIGEST_FIRST_LOOK_BACK_DAYS.
 */
export function jobDigestsConfigFromEnv(env: Record<string, string | undefined>): JobDigestsConfig {
  return {
    minMatchScore: readNumberSetting(env, "JOB_DIGEST_MIN_MATCH_SCORE"),
    targetCount: readNumberSetting(env, "JOB_DIGEST_TARGET_COUNT"),
    firstLookBackDays: readNumberSetting(env, "JOB_DIGEST_FIRST_LOOK_BACK_DAYS"),
  };
}

/** Creates or upgrades the Job Digest tables. Run after the Profiles', Job Offers' and Job Searches' migrations. */
export async function migrateJobDigests(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS job_digest_subscription (
      profile_id uuid PRIMARY KEY REFERENCES profile (id) ON DELETE CASCADE,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      unsubscribe_token text NOT NULL UNIQUE,
      subscribed_at timestamptz NOT NULL,
      last_run_at timestamptz
    );
    -- Set while opted out: the row stays so last_run_at survives opting in again.
    ALTER TABLE job_digest_subscription ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;
    -- What the Candidate picked; the Plan caps it.
    ALTER TABLE job_digest_subscription ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'daily'));
    CREATE TABLE IF NOT EXISTS job_digest (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id uuid NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      job_offer_ids uuid[] NOT NULL,
      sent_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS job_digest_profile_idx ON job_digest (profile_id, sent_at DESC);
    -- The pool of a Job Digest: Job Offers by when they were stored.
    CREATE INDEX IF NOT EXISTS job_offer_created_at_idx ON job_offer (created_at);
    -- When a Job Offer was found no longer published at its source (Expired Job Offers, #16, which owns
    -- the column; created here too so the pool can leave Expired Job Offers out whichever ships first).
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS expired_at timestamptz;
  `);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const rank = (frequency: JobDigestFrequency) => JOB_DIGEST_FREQUENCIES.indexOf(frequency);
const isChosenFrequency = (value: unknown): value is ChosenFrequency => value === "daily" || value === "weekly";
/** The Candidate's choice, capped by their Plan. */
const capped = (chosen: ChosenFrequency, plan: JobDigestFrequency): JobDigestFrequency => (rank(chosen) <= rank(plan) ? chosen : plan);

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
  profile_id: string;
  job_offer_ids: string[];
  sent_at: Date;
}

interface SubscriptionRow {
  frequency: ChosenFrequency;
  unsubscribe_token: string;
}

type Scored = { jobOffer: JobOffer; matchScore: MatchScore };

export function createJobDigests(database: Pool, deps: JobDigestsDeps): JobDigests {
  const now = deps.now ?? (() => new Date());
  /** The configuration in use now: read again for each delivery. */
  const config = (): JobDigestsConfig => ({
    minMatchScore: DEFAULT_MIN_MATCH_SCORE,
    targetCount: DEFAULT_TARGET_COUNT,
    firstLookBackDays: DEFAULT_FIRST_LOOK_BACK_DAYS,
    ...deps.config?.(),
  });

  async function planOf(candidateId: string): Promise<{ plan: Plan; frequency: JobDigestFrequency }> {
    const { plan, quotas } = await deps.billing.entitlements(candidateId);
    return { plan, frequency: quotas.jobDigest };
  }

  /** `plan` and the lowest-ranked offered Plan above it whose Job Digest comes at least `frequency`, with their names. */
  async function planUpgrade(plan: Plan, frequency: ChosenFrequency = "weekly"): Promise<PlanUpgrade> {
    const [plans, upgrade] = await Promise.all([deps.billing.plans(), deps.billing.upgradeFor(plan, (quotas) => rank(quotas.jobDigest) >= rank(frequency))]);
    const planName = plans.find((candidate) => candidate.key === plan)?.name ?? { fr: plan, en: plan };
    return { plan, planName, upgradeTo: upgrade?.key ?? null, upgradeToName: upgrade?.name ?? null };
  }

  async function ownProfile(candidateId: string, profileId: string): Promise<Profile | null> {
    return UUID.test(profileId) ? deps.profiles.get(candidateId, profileId) : null;
  }

  async function subscriptionOf(candidateId: string, profileId: string): Promise<SubscriptionRow | null> {
    const { rows } = await database.query<SubscriptionRow>(
      "SELECT frequency, unsubscribe_token FROM job_digest_subscription WHERE profile_id = $1 AND candidate_id = $2 AND unsubscribed_at IS NULL",
      [profileId, candidateId],
    );
    return rows[0] ?? null;
  }

  /** The Job Offers still stored, scored for the Profile, best Match Score first (undated after dated at an equal one). */
  async function scored(profile: Profile, jobOfferIds: string[]): Promise<Scored[]> {
    const found = await Promise.all(jobOfferIds.map((id) => deps.jobOffers.get(id)));
    return rankByMatchScore(
      found
        .filter((jobOffer): jobOffer is JobOffer => jobOffer !== null)
        .map((jobOffer) => ({ jobOffer, matchScore: scoreMatch({ cv: profile.masterCv.content, searchCriteria: profile.searchCriteria, jobOffer }) })),
    );
  }

  async function settingsOf(candidateId: string, profile: Profile): Promise<JobDigestSettings> {
    const [{ plan, frequency: planFrequency }, subscription, latest] = await Promise.all([
      planOf(candidateId),
      subscriptionOf(candidateId, profile.id),
      database.query<{ id: string; sent_at: Date; count: number }>(
        `SELECT id, sent_at, cardinality(job_offer_ids) AS count FROM job_digest
          WHERE profile_id = $1 AND candidate_id = $2 ORDER BY sent_at DESC LIMIT $3`,
        [profile.id, candidateId, LATEST_DIGESTS],
      ),
    ]);
    const chosenFrequency = subscription?.frequency ?? null;
    const frequency = chosenFrequency ? capped(chosenFrequency, planFrequency) : "none";
    return {
      subscribed: frequency !== "none",
      chosenFrequency,
      frequency,
      planFrequency,
      upgradeTo: planFrequency === "none" ? (await planUpgrade(plan)).upgradeTo : null,
      digests: latest.rows.map((row) => ({ id: row.id, sentAt: row.sent_at, count: row.count })),
    };
  }

  /** The Job Offers this Profile was already shown: in its Job Digests or Job Searches, or saved by the Candidate. */
  async function shownTo(candidateId: string, profileId: string): Promise<Set<string>> {
    const [{ rows }, saved] = await Promise.all([
      database.query<{ id: string }>(
        `SELECT unnest(job_offer_ids) AS id FROM job_digest WHERE profile_id = $1 AND candidate_id = $2
         UNION SELECT unnest(job_offer_ids) FROM job_search WHERE profile_id = $1 AND candidate_id = $2 AND status = 'done'`,
        [profileId, candidateId],
      ),
      deps.applications.list(candidateId),
    ]);
    return new Set([...rows.map((row) => row.id), ...saved.map((application) => application.jobOffer.id)]);
  }

  /** The ids of the Job Offers stored since the Profile's previous Job Digest (or the look-back), most recent first. */
  async function poolOf(candidateId: string, profileId: string, at: Date, firstLookBackDays: number): Promise<string[]> {
    const { rows } = await database.query<{ id: string }>(
      `SELECT id FROM job_offer
        WHERE created_at > COALESCE((SELECT max(sent_at) FROM job_digest WHERE profile_id = $1 AND candidate_id = $2), $3)
          AND created_at <= $4 AND guest_expires_at IS NULL AND expired_at IS NULL
        ORDER BY created_at DESC LIMIT $5`,
      [profileId, candidateId, new Date(at.getTime() - firstLookBackDays * DAY_MS), at, POOL_MAX],
    );
    return rows.map((row) => row.id);
  }

  /** Of these Job Offer ids, those neither Guest-only, expired, nor posted more than MAX_POSTING_AGE_DAYS before `at`. */
  async function eligible(ids: string[], at: Date): Promise<string[]> {
    if (ids.length === 0) return [];
    const { rows } = await database.query<{ id: string }>(
      `SELECT id FROM job_offer WHERE id = ANY($1::uuid[]) AND guest_expires_at IS NULL AND expired_at IS NULL
          AND (posted_at IS NULL OR posted_at >= $2)`,
      [ids, new Date(at.getTime() - MAX_POSTING_AGE_DAYS * DAY_MS)],
    );
    const kept = new Set(rows.map((row) => row.id));
    return ids.filter((id) => kept.has(id));
  }

  /** Never-shown Job Offers among `ids`, scored for the Profile, from the threshold up. */
  async function qualifying(profile: Profile, ids: string[], excluded: Set<string>, at: Date, minMatchScore: number): Promise<Scored[]> {
    const fresh = [...new Set(ids)].filter((id) => UUID.test(id) && !excluded.has(id));
    return (await scored(profile, await eligible(fresh, at))).filter(({ matchScore }) => matchScore.score >= minMatchScore);
  }

  async function withApplications(candidateId: string, results: Scored[]): Promise<JobDigestResult[]> {
    const saved = new Map((await deps.applications.list(candidateId)).map((application) => [application.jobOffer.id, application.id]));
    return results.map((result) => ({ ...result, applicationId: saved.get(result.jobOffer.id) ?? null }));
  }

  async function email(candidateId: string, digest: JobDigest, token: string): Promise<void> {
    const { rows } = await database.query<{ email: string; interfaceLanguage: string | null }>(
      `SELECT email, "interfaceLanguage" FROM candidate WHERE id = $1`,
      [candidateId],
    );
    const candidate = rows[0];
    if (!candidate) return;
    const i18n = createI18n(candidate.interfaceLanguage);
    const { t } = i18n;
    const count = digest.results.length;
    const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: DIGEST_TIME_ZONE });
    const items = digest.results.slice(0, EMAIL_MAX_RESULTS).map(({ jobOffer, matchScore }) => {
      const where = [jobOffer.employer, jobOffer.location].filter(Boolean).join(", ");
      return [
        `- ${jobOffer.title}${where ? ` (${where})` : ""}`,
        `  ${t(matchScoreReliability(matchScore) === "partial" ? "jobDigest.email.matchScorePartial" : "jobDigest.email.matchScore", { score: matchScore.score })}`,
        `  ${jobOffer.postedAt ? t("jobDigest.email.postedAt", { date: day.format(jobOffer.postedAt) }) : t("jobDigest.email.dateUnknown")}`,
        `  ${new URL(routes.jobOffer(jobOffer.id, digest.profile.id), deps.baseURL).toString()}`,
      ].join("\n");
    });
    const text = [
      t("jobDigest.email.intro", { count, profile: digest.profile.name }),
      items.join("\n\n"),
      t("jobDigest.email.seeDigest", { count, url: new URL(routes.jobDigest(digest.id), deps.baseURL).toString() }),
      t("jobDigest.email.signature"),
      "--",
      t("jobDigest.email.unsubscribe", { url: unsubscribePageURL(deps.baseURL, token, i18n.language as Locale) }),
    ].join("\n\n");
    await deps.mailer.send({
      to: candidate.email,
      subject: t("jobDigest.email.subject", { count, profile: digest.profile.name }),
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

    async subscribe(candidateId, profileId, frequency) {
      const profile = await ownProfile(candidateId, profileId);
      if (!profile) return { ok: false, error: "not_found" };
      if (profile.archived) return { ok: false, error: "archived" };
      if (!isChosenFrequency(frequency)) return { ok: false, error: "invalid_frequency" };
      const { plan, frequency: planFrequency } = await planOf(candidateId);
      if (planFrequency === "none") return { ok: false, error: "not_included", ...(await planUpgrade(plan)) };
      if (rank(frequency) > rank(planFrequency)) {
        const { planName, upgradeTo, upgradeToName } = await planUpgrade(plan, frequency);
        return { ok: false, error: "above_plan", plan, planName, planFrequency, upgradeTo, upgradeToName };
      }
      // Opting in again counts from now, so it is not due before the next 07:00 that comes after it.
      await database.query(
        `INSERT INTO job_digest_subscription (profile_id, candidate_id, unsubscribe_token, subscribed_at, frequency) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (profile_id) DO UPDATE SET
           frequency = EXCLUDED.frequency,
           subscribed_at = CASE WHEN job_digest_subscription.unsubscribed_at IS NULL THEN job_digest_subscription.subscribed_at ELSE EXCLUDED.subscribed_at END,
           unsubscribed_at = NULL`,
        [profile.id, candidateId, newToken(), now(), frequency],
      );
      return { ok: true, settings: await settingsOf(candidateId, profile) };
    },

    async unsubscribe(candidateId, profileId) {
      if (!UUID.test(profileId)) return;
      await database.query(
        "UPDATE job_digest_subscription SET unsubscribed_at = $3 WHERE profile_id = $1 AND candidate_id = $2 AND unsubscribed_at IS NULL",
        [profileId, candidateId, now()],
      );
    },

    async unsubscribeByToken(token) {
      if (!TOKEN.test(token)) return false;
      const { rowCount } = await database.query(
        "UPDATE job_digest_subscription SET unsubscribed_at = $2 WHERE unsubscribe_token = $1 AND unsubscribed_at IS NULL",
        [token, now()],
      );
      return (rowCount ?? 0) > 0;
    },

    async get(candidateId, jobDigestId) {
      if (!UUID.test(jobDigestId)) return null;
      const { rows } = await database.query<DigestRow>(
        "SELECT id, profile_id, job_offer_ids, sent_at FROM job_digest WHERE id = $1 AND candidate_id = $2",
        [jobDigestId, candidateId],
      );
      const row = rows[0];
      if (!row) return null;
      const profile = await deps.profiles.get(candidateId, row.profile_id);
      if (!profile) return null;
      return {
        id: row.id,
        profile: { id: profile.id, name: profile.name },
        sentAt: row.sent_at,
        results: await withApplications(candidateId, await scored(profile, row.job_offer_ids)),
      };
    },

    async claimDue() {
      const at = now();
      // A daily Job Digest's latest slot is never before a weekly one's: only rows not run since it may be due.
      const { rows } = await database.query<{ profile_id: string; candidate_id: string; frequency: ChosenFrequency }>(
        `SELECT profile_id, candidate_id, frequency FROM job_digest_subscription
          WHERE unsubscribed_at IS NULL AND GREATEST(last_run_at, subscribed_at) < $1
          ORDER BY last_run_at NULLS FIRST`,
        [latestSlot("daily", at)],
      );
      const planFrequencies = new Map<string, JobDigestFrequency>();
      const due: DueJobDigest[] = [];
      for (const row of rows) {
        if (!planFrequencies.has(row.candidate_id)) planFrequencies.set(row.candidate_id, (await planOf(row.candidate_id)).frequency);
        const frequency = capped(row.frequency, planFrequencies.get(row.candidate_id)!);
        if (frequency === "none") continue;
        const profile = await deps.profiles.get(row.candidate_id, row.profile_id);
        if (!profile || profile.archived) continue;
        const claimed = await database.query(
          `UPDATE job_digest_subscription SET last_run_at = $2
            WHERE profile_id = $1 AND unsubscribed_at IS NULL AND GREATEST(last_run_at, subscribed_at) < $3`,
          [row.profile_id, at, latestSlot(frequency, at)],
        );
        if (claimed.rowCount) due.push({ candidateId: row.candidate_id, profileId: row.profile_id });
      }
      return due;
    },

    async deliver(candidateId, profileId, discover) {
      const nothing: JobDigestDelivery = { digest: null, discovery: "not_run" };
      const profile = await ownProfile(candidateId, profileId);
      if (!profile || profile.archived) return nothing;
      const subscription = await subscriptionOf(candidateId, profile.id);
      if (!subscription || (await planOf(candidateId)).frequency === "none") return nothing;

      const at = now();
      const { minMatchScore, targetCount, firstLookBackDays } = config();
      const shown = await shownTo(candidateId, profile.id);
      let picked = await qualifying(profile, await poolOf(candidateId, profile.id, at, firstLookBackDays), shown, at, minMatchScore);
      let discovery: JobDigestDelivery["discovery"] = "not_run";
      if (picked.length < targetCount) {
        try {
          const found = await discover();
          discovery = "ran";
          const taken = new Set([...shown, ...picked.map(({ jobOffer }) => jobOffer.id)]);
          picked = rankByMatchScore([...picked, ...(await qualifying(profile, found, taken, at, minMatchScore))]);
        } catch (error) {
          // Not retried: the next scheduled Job Digest runs Job discovery again.
          discovery = "failed";
          console.warn("[job-digests] Job discovery failed, sending what the stored Job Offers gave:", error instanceof Error ? error.message : error);
        }
      }
      picked = picked.slice(0, targetCount);
      if (picked.length === 0) return { digest: null, discovery };

      const inserted = await database.query<{ id: string }>(
        "INSERT INTO job_digest (profile_id, candidate_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, $4) RETURNING id",
        [profile.id, candidateId, picked.map((result) => result.jobOffer.id), at],
      );
      const digest: JobDigest = {
        id: inserted.rows[0]!.id,
        profile: { id: profile.id, name: profile.name },
        sentAt: at,
        results: await withApplications(candidateId, picked),
      };
      try {
        await email(candidateId, digest, subscription.unsubscribe_token);
      } catch (error) {
        // The Job Digest stays on its page; the email is not sent twice by a retry.
        console.warn("[job-digests] could not email a Job Digest:", error instanceof Error ? error.message : error);
      }
      return { digest, discovery };
    },
  };
}

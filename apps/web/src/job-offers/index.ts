/**
 * Job Offers: job postings captured by the extension or found by the AI Coach.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createJobOffers(database)` — `capture` a posting (validated here; field
 *    errors come back, never an exception), `get` one by id, and
 *    `findBySourceUrl` (so Job discovery does not fetch a known posting again).
 *  - `migrateJobOffers(database)` — creates / upgrades the table.
 * Capturing a posting already stored returns the stored Job Offer: postings
 * are told apart by their source URL (without tracking parameters) and by
 * their content (ignoring case and spacing), so one posting seen on two sites
 * is one Job Offer.
 * A Job Offer belongs to no one: Candidates and Guests share it, so it needs no
 * account and is kept when a Candidate deletes theirs (ADR-0010). One that only
 * Guests captured is forgotten within 24 hours (ADR-0003): see
 * `forgetExpiredGuestCaptures`, which the worker runs on a schedule. A Candidate
 * capturing it, or saving it as an Application (`keepForCandidate`), keeps it
 * for good.
 * Every few days the worker re-checks the source of each Job Offer an ongoing
 * Application follows (`createSourceChecks` schedules and records it); one found
 * no longer published there twice in a row becomes an Expired Job Offer
 * (`expiredAt`). Nothing else about it, or its Applications, changes.
 * Expiry is not for good: a later re-check finding it published, or capturing
 * its source page again, makes it a published Job Offer again.
 * A Job Offer captured without structured data (no JobPosting) has only a title
 * and its text: `fillFromText` adds, once per Job Offer, the fields an AI reads
 * from that text (the second phase of a Match Score), never replacing one stated.
 * The Job Offer Summary (two or three sentences the AI writes from the offer's
 * text) comes with that reading, or with Job discovery's reading of the page
 * (`TrustedFacts.summary`). A Job Offer stored without one gets it from
 * `summarize`, the first time its Application page is shown: read once, never
 * twice at a time in this process.
 */
import { createHash } from "node:crypto";
import { CONTRACT_TYPES, JOB_OFFER_SECTOR_MAX_CHARS, JOB_OFFER_SUMMARY_MAX_CHARS, REMOTE_WORK_OPTIONS, type JobOffer } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import { fieldErrors, type FieldError } from "../validation";
import { GUEST_EXPIRY_SQL } from "./guest-retention";

export { forgetExpiredGuestCaptures } from "./guest-retention";
export {
  createSourceChecks,
  EXPIRED_RECHECK_INTERVAL_DAYS,
  GONE_CHECKS_TO_EXPIRE,
  RECHECK_INTERVAL_DAYS,
  type SourceCheckOutcome,
  type SourceChecks,
} from "./source-checks";

export type { FieldError as JobOfferFieldError } from "../validation";

/** The fields of a Job Offer `fillFromText` and `summarize` can fill from what its text states, and its Job Offer Summary. */
export type FieldsFromText = Pick<
  JobOffer,
  "employer" | "location" | "contractType" | "remoteWork" | "salary" | "skills" | "requiredExperienceYears" | "summary" | "sector" | "subsector"
>;

export type CaptureJobOfferResult = { ok: true; jobOffer: JobOffer } | { ok: false; errors: FieldError[] };

/** Who captured a posting: a signed-in Candidate, or a Guest (no account). */
export type Captor = "candidate" | "guest";

/**
 * What the caller itself read from the posting's source, as opposed to `input`
 * (untrusted, from the browser): a posting date in `input` is ignored.
 */
export interface TrustedFacts {
  /** When the source states it first published the posting: never in the future. */
  postedAt?: Date;
  /** The Job Offer Summary an AI wrote from the posting (Job discovery's reading of its page). */
  summary?: string;
  /** The employer's sector and sub-sector, read by the same AI with the summary. */
  sector?: string;
  subsector?: string;
}

// A Date the caller built from what it read, never text to coerce: nothing from a request body reaches it.
const postedAtSchema = z
  .date()
  .min(new Date("2000-01-01T00:00:00Z"))
  .refine((date) => date.getTime() <= Date.now() + 24 * 60 * 60 * 1000);

export interface JobOffers {
  /**
   * Stores a captured posting. `input` is untrusted (it comes from the browser).
   * A posting only Guests captured is forgotten within 24 hours.
   */
  capture(input: unknown, capturedBy?: Captor, trusted?: TrustedFacts): Promise<CaptureJobOfferResult>;
  /**
   * A Candidate now holds on to this Job Offer (they saved it as an Application,
   * perhaps from what they did as a Guest), so it is never forgotten as a Guest
   * capture. Returns it, or null if there is none with this id.
   */
  keepForCandidate(id: string): Promise<JobOffer | null>;
  /** The Job Offer, or null if there is none with this id. */
  get(id: string): Promise<JobOffer | null>;
  /** The Job Offer captured from this source URL (ignoring tracking parameters), or null. */
  findBySourceUrl(url: string): Promise<JobOffer | null>;
  /**
   * Fills the fields the Job Offer lacks from what `read` finds in its text, once per Job Offer:
   * after a read that succeeded (even one finding nothing), `read` is never called for it again.
   * A field already stated is never replaced. Returns the Job Offer as stored afterwards, or
   * null if there is none with this id. What `read` throws is thrown, and the next call reads again.
   */
  fillFromText(id: string, read: (jobOffer: JobOffer) => Promise<FieldsFromText>): Promise<JobOffer | null>;
  /**
   * The Job Offer with its Job Offer Summary: the stored one, else one `read` from its text, stored
   * with the fields it lacks (as `fillFromText` does). `read` is called once per Job Offer: never
   * again after a read that succeeded (even one giving no summary), and a second call while one
   * reads waits for it. Null if there is none with this id. What `read` throws is thrown, and the
   * next call reads again.
   */
  summarize(id: string, read: (jobOffer: JobOffer) => Promise<FieldsFromText>): Promise<JobOffer | null>;
}

/** Drops NUL characters: text scraped from a page can carry them, and Postgres cannot store them in text columns. */
const withoutNul = z.string().overwrite((value) => value.replaceAll("\0", ""));
const text = withoutNul.trim();
const optionalText = text.max(500).optional().transform((value) => value || undefined);
const salary = z.number().int().positive().max(10_000_000).optional();

const inputSchema = z.object({
  source: z
    .object({
      url: withoutNul.pipe(z.url({ protocol: /^https?$/ }).max(2000)).optional(),
      name: optionalText,
    })
    .prefault({}),
  title: text.min(1).max(500),
  content: text.min(1).max(100_000),
  employer: optionalText,
  location: optionalText,
  contractType: z.enum(CONTRACT_TYPES).optional(),
  remoteWork: z.enum(REMOTE_WORK_OPTIONS).optional(),
  salary: z.object({ min: salary, max: salary }).optional(),
  skills: z
    .array(text.max(200))
    .max(200)
    .optional()
    .transform((items) => items?.filter(Boolean)),
  requiredExperienceYears: z.number().int().min(0).max(60).optional(),
});

/** The fields `fillFromText` may fill, validated as a captured posting's are. */
const FILLABLE = ["employer", "location", "contractType", "remoteWork", "salary", "skills", "requiredExperienceYears"] as const satisfies (keyof FieldsFromText)[];
const fillableSchema = inputSchema.pick(Object.fromEntries(FILLABLE.map((name) => [name, true])) as Record<(typeof FILLABLE)[number], true>);
/** A Job Offer Summary: only ever from an AI reading (never from a browser), checked like any text. */
const summarySchema = text
  .transform((value) => value.replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(JOB_OFFER_SUMMARY_MAX_CHARS))
  .optional();
/** A sector or sub-sector the AI read: a few words on one line. */
const sectorSchema = text
  .transform((value) => value.replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(JOB_OFFER_SECTOR_MAX_CHARS))
  .optional();

interface JobOfferRow {
  id: string;
  source_url: string | null;
  source_name: string | null;
  title: string;
  content: string;
  employer: string | null;
  location: string | null;
  contract_type: JobOffer["contractType"] | null;
  remote_work: JobOffer["remoteWork"] | null;
  salary_min: number | null;
  salary_max: number | null;
  skills: string[] | null;
  required_experience_years: number | null;
  posted_at: Date | null;
  expired_at: Date | null;
  summary: string | null;
  sector: string | null;
  subsector: string | null;
}

const COLUMNS = `id, source_url, source_name, title, content, employer, location, contract_type, remote_work,
  salary_min, salary_max, skills, required_experience_years, posted_at, expired_at, summary, sector, subsector`;

function jobOfferFrom(row: JobOfferRow): JobOffer {
  const jobOffer: JobOffer = { id: row.id, source: {}, title: row.title, content: row.content };
  if (row.source_url !== null) jobOffer.source.url = row.source_url;
  if (row.source_name !== null) jobOffer.source.name = row.source_name;
  if (row.employer !== null) jobOffer.employer = row.employer;
  if (row.location !== null) jobOffer.location = row.location;
  if (row.contract_type !== null) jobOffer.contractType = row.contract_type;
  if (row.remote_work !== null) jobOffer.remoteWork = row.remote_work;
  if (row.salary_min !== null || row.salary_max !== null) {
    jobOffer.salary = {};
    if (row.salary_min !== null) jobOffer.salary.min = row.salary_min;
    if (row.salary_max !== null) jobOffer.salary.max = row.salary_max;
  }
  if (row.skills !== null) jobOffer.skills = row.skills;
  if (row.required_experience_years !== null) jobOffer.requiredExperienceYears = row.required_experience_years;
  if (row.posted_at !== null) jobOffer.postedAt = row.posted_at;
  if (row.expired_at !== null) jobOffer.expiredAt = row.expired_at;
  if (row.summary !== null) jobOffer.summary = row.summary;
  if (row.sector !== null) jobOffer.sector = row.sector;
  if (row.subsector !== null) jobOffer.subsector = row.subsector;
  return jobOffer;
}

/** Query parameters that track where the visitor came from, not which posting it is. */
const TRACKING = /^(utm_.*|fbclid|gclid|msclkid|mc_[a-z]+|ref|refid|trk|trackingid|origin|from|src|source)$/i;

/** The posting's URL without scheme, "www.", fragment, trailing slash or tracking parameters. */
function urlKey(url: string): string {
  const parsed = new URL(url);
  const params = [...parsed.searchParams].filter(([name]) => !TRACKING.test(name)).sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return `${host}${parsed.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
}

/** The posting's text, ignoring case and spacing. */
function contentFingerprint(content: string): string {
  return createHash("sha256").update(content.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");
}

const siteName = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReadRow = JobOfferRow & { text_read_at: Date | null; summary_read_at: Date | null; sector_read_at: Date | null };

export function createJobOffers(database: Pool): JobOffers {
  /** The summaries being read now, by Job Offer id: a second call waits for the first one's. */
  const summarizingNow = new Map<string, Promise<JobOffer | null>>();

  async function readRow(id: string): Promise<ReadRow | undefined> {
    const { rows } = await database.query<ReadRow>(`SELECT ${COLUMNS}, text_read_at, summary_read_at, sector_read_at FROM job_offer WHERE id = $1`, [id]);
    return rows[0];
  }

  /**
   * Stores what `read` finds in the Job Offer's text: the fields it lacks (never replacing one stated)
   * and its summary (unless it has one), and that its text was read, for both.
   */
  async function storeRead(row: ReadRow, read: (jobOffer: JobOffer) => Promise<FieldsFromText>): Promise<JobOffer | null> {
    // Each field is checked as a captured posting's is: one that fails is left out, the rest kept.
    const found = await read(jobOfferFrom(row));
    const valid: Record<string, unknown> = {};
    for (const name of FILLABLE) {
      const field = fillableSchema.shape[name].safeParse(found[name]);
      if (field.success && field.data !== undefined) valid[name] = field.data;
    }
    const fields = valid as FieldsFromText;
    const summary = summarySchema.safeParse(found.summary);
    const sector = sectorSchema.safeParse(found.sector);
    const subsector = sectorSchema.safeParse(found.subsector);
    const updated = await database.query<JobOfferRow>(
      `UPDATE job_offer SET
         employer = COALESCE(employer, $2),
         location = COALESCE(location, $3),
         contract_type = COALESCE(contract_type, $4),
         remote_work = COALESCE(remote_work, $5),
         salary_min = CASE WHEN salary_min IS NULL AND salary_max IS NULL THEN $6 ELSE salary_min END,
         salary_max = CASE WHEN salary_min IS NULL AND salary_max IS NULL THEN $7 ELSE salary_max END,
         skills = CASE WHEN COALESCE(cardinality(skills), 0) = 0 THEN $8 ELSE skills END,
         required_experience_years = COALESCE(required_experience_years, $9),
         summary = COALESCE(summary, $10),
         sector = COALESCE(sector, $11),
         subsector = CASE WHEN sector IS NULL THEN $12 ELSE subsector END,
         text_read_at = now(),
         summary_read_at = now(),
         sector_read_at = now()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [
        row.id,
        fields.employer ?? null,
        fields.location ?? null,
        fields.contractType ?? null,
        fields.remoteWork ?? null,
        fields.salary?.min ?? null,
        fields.salary?.max ?? null,
        fields.skills?.length ? fields.skills : null,
        fields.requiredExperienceYears ?? null,
        (summary.success && summary.data) || null,
        (sector.success && sector.data) || null,
        (sector.success && sector.data && subsector.success && subsector.data) || null,
      ],
    );
    return updated.rows[0] ? jobOfferFrom(updated.rows[0]) : null;
  }

  return {
    async capture(input, capturedBy = "candidate", trusted = {}) {
      const parsed = inputSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const offer = parsed.data;
      let postedAt: Date | undefined;
      if (trusted.postedAt !== undefined) {
        const stated = postedAtSchema.safeParse(trusted.postedAt);
        if (!stated.success) return { ok: false, errors: [{ field: "postedAt", code: "invalid" }] };
        postedAt = stated.data;
      }
      // Read by the same AI as the summary: kept when of the right shape, left out otherwise.
      const sectorRead = sectorSchema.safeParse(trusted.sector);
      const sector = (sectorRead.success && sectorRead.data) || undefined;
      const subsectorRead = sectorSchema.safeParse(trusted.subsector);
      const subsector = (subsectorRead.success && subsectorRead.data) || undefined;
      let summary: string | undefined;
      if (trusted.summary !== undefined) {
        const stated = summarySchema.safeParse(trusted.summary);
        // A summary of the wrong shape is left out: the posting is still worth keeping, and gets one later.
        if (stated.success) summary = stated.data;
      }
      const url = offer.source.url;
      const keys = [url ? urlKey(url) : null, contentFingerprint(offer.content)];

      const { rows } = await database.query<JobOfferRow>(
        `INSERT INTO job_offer (url_key, content_fingerprint, source_url, source_name, title, content, employer, location,
                                contract_type, remote_work, salary_min, salary_max, skills, required_experience_years,
                                posted_at, guest_expires_at, summary, summary_read_at, sector, subsector, sector_read_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 CASE WHEN $16 = 'guest' THEN ${GUEST_EXPIRY_SQL} END,
                 $17::text, CASE WHEN $17::text IS NOT NULL THEN now() END,
                 $18::text, $19::text, CASE WHEN $17::text IS NOT NULL THEN now() END)
         ON CONFLICT DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          ...keys,
          url ?? null,
          offer.source.name ?? (url ? siteName(url) : null),
          offer.title,
          offer.content,
          offer.employer ?? null,
          offer.location ?? null,
          offer.contractType ?? null,
          offer.remoteWork ?? null,
          offer.salary?.min ?? null,
          offer.salary?.max ?? null,
          offer.skills ?? null,
          offer.requiredExperienceYears ?? null,
          postedAt ?? null,
          capturedBy,
          summary ?? null,
          sector ?? null,
          (sector && subsector) ?? null,
        ],
      );
      if (rows[0]) return { ok: true, jobOffer: jobOfferFrom(rows[0]) };

      // Already captured: the same URL first, else the same text.
      const existing = await database.query<JobOfferRow>(
        `SELECT ${COLUMNS} FROM job_offer
          WHERE url_key = $1 OR content_fingerprint = $2
          ORDER BY (url_key IS NOT DISTINCT FROM $1) DESC, created_at
          LIMIT 1`,
        keys,
      );
      const row = existing.rows[0]!;
      if (capturedBy === "candidate") {
        await database.query(`UPDATE job_offer SET guest_expires_at = NULL WHERE id = $1 AND guest_expires_at IS NOT NULL`, [row.id]);
      }
      // Captured again from its own source page: that page publishes it, so it is not expired,
      // and the gone checks so far no longer count (as after a live re-check).
      if (keys[0] !== null) {
        const revived = await database.query(
          `UPDATE job_offer SET expired_at = NULL, gone_checks = 0
            WHERE id = $1 AND url_key = $2 AND (expired_at IS NOT NULL OR gone_checks > 0)`,
          [row.id, keys[0]],
        );
        if (revived.rowCount) row.expired_at = null;
      }
      // Stored without a summary: the one just read is kept.
      if (summary !== undefined && row.summary === null) {
        await database.query(
          `UPDATE job_offer SET summary = $2, summary_read_at = now(),
                  sector = COALESCE(sector, $3), subsector = CASE WHEN sector IS NULL THEN $4 ELSE subsector END, sector_read_at = now()
            WHERE id = $1 AND summary IS NULL`,
          [row.id, summary, sector ?? null, (sector && subsector) ?? null],
        );
        row.summary = summary;
        if (row.sector === null && sector) {
          row.sector = sector;
          row.subsector = subsector ?? null;
        }
      }
      return { ok: true, jobOffer: jobOfferFrom(row) };
    },

    async keepForCandidate(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await database.query<JobOfferRow>(
        `UPDATE job_offer SET guest_expires_at = NULL WHERE id = $1 RETURNING ${COLUMNS}`,
        [id],
      );
      return rows[0] ? jobOfferFrom(rows[0]) : null;
    },

    async get(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await database.query<JobOfferRow>(`SELECT ${COLUMNS} FROM job_offer WHERE id = $1`, [id]);
      return rows[0] ? jobOfferFrom(rows[0]) : null;
    },

    async findBySourceUrl(url) {
      if (!URL.canParse(url)) return null;
      const { rows } = await database.query<JobOfferRow>(`SELECT ${COLUMNS} FROM job_offer WHERE url_key = $1`, [urlKey(url)]);
      return rows[0] ? jobOfferFrom(rows[0]) : null;
    },

    async fillFromText(id, read) {
      if (!UUID.test(id)) return null;
      const row = await readRow(id);
      if (!row) return null;
      if (row.text_read_at !== null) return jobOfferFrom(row);
      return storeRead(row, read);
    },

    async summarize(id, read) {
      if (!UUID.test(id)) return null;
      let summarizing = summarizingNow.get(id);
      if (!summarizing) {
        summarizing = (async () => {
          const row = await readRow(id);
          if (!row) return null;
          // Read once: the summary, and the sector added since (an offer read before has none yet).
          if ((row.summary !== null || row.summary_read_at !== null) && row.sector_read_at !== null) return jobOfferFrom(row);
          return storeRead(row, read);
        })().finally(() => summarizingNow.delete(id));
        summarizingNow.set(id, summarizing);
      }
      return summarizing;
    },
  };
}

/** Creates or upgrades the Job Offer table. Safe to run repeatedly. */
export async function migrateJobOffers(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS job_offer (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      url_key text UNIQUE,
      content_fingerprint text NOT NULL UNIQUE,
      source_url text,
      source_name text,
      title text NOT NULL,
      content text NOT NULL,
      employer text,
      location text,
      contract_type text,
      remote_work text,
      salary_min integer,
      salary_max integer,
      skills text[],
      required_experience_years integer,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- Set while only Guests have captured the posting: when to forget it (ADR-0003).
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS guest_expires_at timestamptz;
    CREATE INDEX IF NOT EXISTS job_offer_guest_expires_at ON job_offer (guest_expires_at) WHERE guest_expires_at IS NOT NULL;
    -- Source re-checks (Expired Job Offers): when the source was last read, and when it was found no longer publishing the posting.
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS source_checked_at timestamptz;
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS expired_at timestamptz;
    -- Gone checks in a row: GONE_CHECKS_TO_EXPIRE of them make it expired, a live check resets it.
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS gone_checks integer NOT NULL DEFAULT 0;
    -- When the source first published the posting, when it states it in a form we trust (e.g. an ATS's API).
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS posted_at timestamptz;
    -- When an AI read the posting's text for the fields its structured data lacks (fillFromText): done once.
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS text_read_at timestamptz;
    -- The Job Offer Summary an AI wrote from the posting's text, and when that text was read for it: done once.
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS summary text;
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS summary_read_at timestamptz;
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS sector text;
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS subsector text;
    ALTER TABLE job_offer ADD COLUMN IF NOT EXISTS sector_read_at timestamptz;
  `);
}

/**
 * Job Offers: job postings captured by the extension or found by the AI Coach.
 *
 * One deep module in front of Postgres. Callers get:
 *  - `createJobOffers(database)` — `capture` a posting (validated here; field
 *    errors come back, never an exception) and `get` one by id.
 *  - `migrateJobOffers(database)` — creates / upgrades the table.
 * Capturing a posting already stored returns the stored Job Offer: postings
 * are told apart by their source URL (without tracking parameters) and by
 * their content (ignoring case and spacing), so one posting seen on two sites
 * is one Job Offer.
 * A Job Offer belongs to no one: Candidates and Guests share it, so it needs no
 * account and is kept when a Candidate deletes theirs (ADR-0010).
 */
import { createHash } from "node:crypto";
import { CONTRACT_TYPES, REMOTE_WORK_OPTIONS, type JobOffer } from "@jobhub/shared";
import type { Pool } from "pg";
import * as z from "zod";
import { fieldErrors, type FieldError } from "../validation";

export type { FieldError as JobOfferFieldError } from "../validation";

export type CaptureJobOfferResult = { ok: true; jobOffer: JobOffer } | { ok: false; errors: FieldError[] };

export interface JobOffers {
  /** Stores a captured posting. `input` is untrusted (it comes from the browser). */
  capture(input: unknown): Promise<CaptureJobOfferResult>;
  /** The Job Offer, or null if there is none with this id. */
  get(id: string): Promise<JobOffer | null>;
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
}

const COLUMNS = `id, source_url, source_name, title, content, employer, location, contract_type, remote_work,
  salary_min, salary_max, skills, required_experience_years`;

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

export function createJobOffers(database: Pool): JobOffers {
  return {
    async capture(input) {
      const parsed = inputSchema.safeParse(input, { reportInput: true });
      if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
      const offer = parsed.data;
      const url = offer.source.url;
      const keys = [url ? urlKey(url) : null, contentFingerprint(offer.content)];

      const { rows } = await database.query<JobOfferRow>(
        `INSERT INTO job_offer (url_key, content_fingerprint, source_url, source_name, title, content, employer, location,
                                contract_type, remote_work, salary_min, salary_max, skills, required_experience_years)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
      return { ok: true, jobOffer: jobOfferFrom(existing.rows[0]!) };
    },

    async get(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await database.query<JobOfferRow>(`SELECT ${COLUMNS} FROM job_offer WHERE id = $1`, [id]);
      return rows[0] ? jobOfferFrom(rows[0]) : null;
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
  `);
}

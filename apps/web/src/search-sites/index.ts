/**
 * Search sites (#188): the sites Jobbbox searches, managed by Administrators from
 * the Back Office without a release.
 *
 * One deep module. `createSearchSites(database)` answers:
 *  - where does the extension show its badge?   Job Sites: `jobSites`, `addJobSite`, `setJobSiteEnabled`, `removeJobSite`
 *  - what does Job discovery search?            Job discovery sources and sites: `jobDiscoverySources`,
 *                                               `setJobDiscoverySourceEnabled`, `jobDiscoverySites`, `addJobDiscoverySite`,
 *                                               `setJobDiscoverySiteEnabled`, `removeJobDiscoverySite`
 *  - what the extension and the worker read:    `extensionJobSites`, `jobDiscoverySettings`
 * and `migrateSearchSites(database)` creates its tables, seeded with what the
 * code did before: the extension's built-in Job Sites and every Job discovery
 * source enabled, no Job discovery site.
 *
 * Every write takes an optional `within`: it then runs in the caller's
 * transaction, as the Back Office does to record it in the Back Office Audit
 * (see admin/search-sites-back-office.ts). Each write answers what it changed,
 * as it was before, so that it can be recorded.
 *
 * Every input is untrusted and validated here. Forbidden sites (FORBIDDEN_SITES,
 * ADR-0002) can never be listed or enabled as Job discovery sites. Job Offers do
 * not reference these tables: removing a site never removes a Job Offer.
 */
import {
  BUILT_IN_JOB_SITES,
  isForbiddenSite,
  JOB_DISCOVERY_SOURCES,
  jobDiscoveryDomain,
  jobSitePattern,
  jobSitePatternHost,
  type ExtensionJobSiteList,
  type JobDiscoverySettings,
  type JobDiscoverySite,
  type JobDiscoverySource,
} from "@jobhub/shared";
import type { Pool } from "pg";
import type { Queryable } from "../database/pool";

/** One of the extension's Job Sites, as the Back Office shows it. */
export interface JobSite {
  pattern: string;
  postingPages: string | null;
  /** In the extension's manifest: it can be disabled, not removed. */
  builtIn: boolean;
  enabled: boolean;
}

export type AddJobSiteResult =
  | { ok: true; site: JobSite }
  /** `invalid`: not a usable match pattern, or posting pages on another host. `exists`: already listed. */
  | { ok: false; error: "invalid" | "exists" };

export type RemoveJobSiteResult = { ok: true; site: JobSite } | { ok: false; error: "built_in" | "not_found" };

export type AddJobDiscoverySiteResult =
  | { ok: true; site: JobDiscoverySite }
  /** `forbidden`: a site whose terms forbid crawling (ADR-0002). */
  | { ok: false; error: "invalid" | "forbidden" | "exists" };

export interface SearchSites {
  /** Every Job Site, built-in ones first, then by pattern. */
  jobSites(): Promise<JobSite[]>;
  /** Adds an enabled Job Site. `input` is untrusted: { pattern, postingPages? }. */
  addJobSite(input: unknown, within?: Queryable): Promise<AddJobSiteResult>;
  /** The Job Site as it was before; null when no such Job Site. */
  setJobSiteEnabled(pattern: string, enabled: boolean, within?: Queryable): Promise<JobSite | null>;
  /** The Job Site removed. `built_in`: a built-in Job Site is only ever disabled. */
  removeJobSite(pattern: string, within?: Queryable): Promise<RemoveJobSiteResult>;
  /** What the extension reads: every Job Site with whether it is enabled. */
  extensionJobSites(): Promise<ExtensionJobSiteList>;

  jobDiscoverySources(): Promise<Record<JobDiscoverySource, boolean>>;
  /** Whether the source was enabled before; null for an unknown source. */
  setJobDiscoverySourceEnabled(source: string, enabled: boolean, within?: Queryable): Promise<{ source: JobDiscoverySource; wasEnabled: boolean } | null>;
  /** Every Job discovery site, by domain. */
  jobDiscoverySites(): Promise<JobDiscoverySite[]>;
  /** Adds an enabled Job discovery site. `input` is untrusted: a domain or a URL. */
  addJobDiscoverySite(input: unknown, within?: Queryable): Promise<AddJobDiscoverySiteResult>;
  /** The site as it was before. A forbidden site is never enabled. */
  setJobDiscoverySiteEnabled(
    domain: string,
    enabled: boolean,
    within?: Queryable,
  ): Promise<{ ok: true; before: JobDiscoverySite } | { ok: false; error: "not_found" | "forbidden" }>;
  /** The site removed; null when no such site. Job Offers found on it stay. */
  removeJobDiscoverySite(domain: string, within?: Queryable): Promise<JobDiscoverySite | null>;
  /** What one run of Job discovery reads. Forbidden sites are left out even if listed. */
  jobDiscoverySettings(): Promise<JobDiscoverySettings>;
}

export async function migrateSearchSites(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS extension_job_site (
      pattern text PRIMARY KEY,
      posting_pages text,
      built_in boolean NOT NULL DEFAULT false,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS job_discovery_source (
      source text PRIMARY KEY CHECK (source IN (${JOB_DISCOVERY_SOURCES.map((source) => `'${source}'`).join(", ")})),
      enabled boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS job_discovery_site (
      domain text PRIMARY KEY,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  // Built-in Job Sites added to the extension since the last migration start enabled; existing rows keep their state.
  await database.query(
    `INSERT INTO extension_job_site (pattern, built_in) SELECT unnest($1::text[]), true
     ON CONFLICT (pattern) DO UPDATE SET built_in = true`,
    [[...BUILT_IN_JOB_SITES]],
  );
  // A pattern no longer built into the extension becomes an added Job Site: it can then be removed.
  await database.query("UPDATE extension_job_site SET built_in = false WHERE built_in AND NOT (pattern = ANY($1::text[]))", [[...BUILT_IN_JOB_SITES]]);
  // A source added to the code since the table was created (Fantastic.jobs, #243) must pass its check.
  await database.query(`
    ALTER TABLE job_discovery_source DROP CONSTRAINT IF EXISTS job_discovery_source_source_check;
    ALTER TABLE job_discovery_source ADD CONSTRAINT job_discovery_source_source_check CHECK (source IN (${JOB_DISCOVERY_SOURCES.map((source) => `'${source}'`).join(", ")}));
  `);
  await database.query("INSERT INTO job_discovery_source (source) SELECT unnest($1::text[]) ON CONFLICT (source) DO NOTHING", [[...JOB_DISCOVERY_SOURCES]]);
}

interface JobSiteRow {
  pattern: string;
  posting_pages: string | null;
  built_in: boolean;
  enabled: boolean;
}

const jobSiteFromRow = (row: JobSiteRow): JobSite => ({ pattern: row.pattern, postingPages: row.posting_pages, builtIn: row.built_in, enabled: row.enabled });

const isSource = (value: string): value is JobDiscoverySource => (JOB_DISCOVERY_SOURCES as readonly string[]).includes(value);

/** A Job Site's posting pages from the form: empty means none; otherwise a match pattern on the site's own host. */
function postingPagesFor(pattern: string, input: unknown): string | null | undefined {
  if (input === undefined || input === null || (typeof input === "string" && input.trim() === "")) return null;
  const postingPages = jobSitePattern(input);
  if (!postingPages || jobSitePatternHost(postingPages) !== jobSitePatternHost(pattern)) return undefined;
  return postingPages;
}

export function createSearchSites(database: Pool): SearchSites {
  async function jobSites(): Promise<JobSite[]> {
    const { rows } = await database.query<JobSiteRow>(
      "SELECT pattern, posting_pages, built_in, enabled FROM extension_job_site ORDER BY built_in DESC, pattern",
    );
    return rows.map(jobSiteFromRow);
  }

  async function jobDiscoverySites(): Promise<JobDiscoverySite[]> {
    const { rows } = await database.query<JobDiscoverySite>("SELECT domain, enabled FROM job_discovery_site ORDER BY domain");
    return rows;
  }

  async function jobDiscoverySources(): Promise<Record<JobDiscoverySource, boolean>> {
    const { rows } = await database.query<{ source: string; enabled: boolean }>("SELECT source, enabled FROM job_discovery_source");
    // A source missing from the table (added to the code since the last migration) is on, as before.
    const sources = Object.fromEntries(JOB_DISCOVERY_SOURCES.map((source) => [source, true])) as Record<JobDiscoverySource, boolean>;
    for (const row of rows) if (isSource(row.source)) sources[row.source] = row.enabled;
    return sources;
  }

  return {
    jobSites,

    async addJobSite(input, within = database) {
      const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      const pattern = jobSitePattern(fields.pattern);
      if (!pattern) return { ok: false, error: "invalid" };
      const postingPages = postingPagesFor(pattern, fields.postingPages);
      if (postingPages === undefined) return { ok: false, error: "invalid" };
      const { rows } = await within.query<JobSiteRow>(
        `INSERT INTO extension_job_site (pattern, posting_pages) VALUES ($1, $2)
         ON CONFLICT (pattern) DO NOTHING
         RETURNING pattern, posting_pages, built_in, enabled`,
        [pattern, postingPages],
      );
      return rows[0] ? { ok: true, site: jobSiteFromRow(rows[0]) } : { ok: false, error: "exists" };
    },

    async setJobSiteEnabled(pattern, enabled, within = database) {
      // The joined row is read from the statement's snapshot: it is the Job Site as it was.
      const { rows } = await within.query<JobSiteRow>(
        `UPDATE extension_job_site site SET enabled = $2, updated_at = now()
         FROM extension_job_site was WHERE site.pattern = $1 AND was.pattern = site.pattern
         RETURNING was.pattern, was.posting_pages, was.built_in, was.enabled`,
        [pattern, enabled],
      );
      return rows[0] ? jobSiteFromRow(rows[0]) : null;
    },

    async removeJobSite(pattern, within = database) {
      const { rows } = await within.query<JobSiteRow>(
        // A built-in Job Site is left in place: the CTE sees it, the DELETE skips it.
        `WITH found AS (SELECT pattern, posting_pages, built_in, enabled FROM extension_job_site WHERE pattern = $1),
              removed AS (DELETE FROM extension_job_site WHERE pattern = $1 AND NOT built_in RETURNING 1)
         SELECT pattern, posting_pages, built_in, enabled FROM found`,
        [pattern],
      );
      if (!rows[0]) return { ok: false, error: "not_found" };
      return rows[0].built_in ? { ok: false, error: "built_in" } : { ok: true, site: jobSiteFromRow(rows[0]) };
    },

    async extensionJobSites() {
      const sites = await jobSites();
      return { sites: sites.map(({ pattern, postingPages, enabled }) => ({ pattern, postingPages, enabled })) };
    },

    jobDiscoverySources,

    async setJobDiscoverySourceEnabled(source, enabled, within = database) {
      if (!isSource(source)) return null;
      // The CTE reads the statement's snapshot: the source as it was; a source not stored yet was on.
      const { rows } = await within.query<{ was_enabled: boolean | null }>(
        `WITH was AS (SELECT enabled FROM job_discovery_source WHERE source = $1)
         INSERT INTO job_discovery_source (source, enabled) VALUES ($1, $2)
         ON CONFLICT (source) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
         RETURNING (SELECT enabled FROM was) AS was_enabled`,
        [source, enabled],
      );
      return { source, wasEnabled: rows[0]?.was_enabled ?? true };
    },

    jobDiscoverySites,

    async addJobDiscoverySite(input, within = database) {
      const domain = jobDiscoveryDomain(input);
      if (!domain) return { ok: false, error: "invalid" };
      if (isForbiddenSite(domain)) return { ok: false, error: "forbidden" };
      const { rows } = await within.query<JobDiscoverySite>(
        "INSERT INTO job_discovery_site (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING RETURNING domain, enabled",
        [domain],
      );
      return rows[0] ? { ok: true, site: rows[0] } : { ok: false, error: "exists" };
    },

    async setJobDiscoverySiteEnabled(domain, enabled, within = database) {
      if (enabled && isForbiddenSite(domain)) return { ok: false, error: "forbidden" };
      const { rows } = await within.query<JobDiscoverySite>(
        `UPDATE job_discovery_site site SET enabled = $2, updated_at = now()
         FROM job_discovery_site was WHERE site.domain = $1 AND was.domain = site.domain
         RETURNING was.domain, was.enabled`,
        [domain, enabled],
      );
      return rows[0] ? { ok: true, before: rows[0] } : { ok: false, error: "not_found" };
    },

    async removeJobDiscoverySite(domain, within = database) {
      const { rows } = await within.query<JobDiscoverySite>("DELETE FROM job_discovery_site WHERE domain = $1 RETURNING domain, enabled", [domain]);
      return rows[0] ?? null;
    },

    async jobDiscoverySettings() {
      const [sources, sites] = await Promise.all([jobDiscoverySources(), jobDiscoverySites()]);
      return { sources, sites: sites.filter((site) => !(site.enabled && isForbiddenSite(site.domain))) };
    },
  };
}

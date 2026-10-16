/**
 * The sites Jobbbox searches, as Administrators manage them from the Back
 * Office (#188): the extension's Job Sites, and the Job discovery sources and
 * sites the worker uses. Shared by the web app (which stores and validates
 * them), the worker and the extension (which read them).
 */

/**
 * Sites whose terms of use forbid automated access (ADR-0002). Job discovery
 * never fetches them, and they can never be listed as a Job discovery site;
 * only Capture, in the browser extension, covers them.
 */
export const FORBIDDEN_SITES = ["linkedin.com", "indeed.com", "indeed.fr", "glassdoor.com", "glassdoor.fr"] as const;

/** Whether `hostname` (a domain, `www.` or not) is a forbidden site or one of its subdomains. */
export function isForbiddenSite(hostname: string, forbiddenSites: readonly string[] = FORBIDDEN_SITES): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return forbiddenSites.some((site) => host === site || host.endsWith(`.${site}`));
}

/** Whether `hostname` is `domain` or one of its subdomains (`www.` ignored). */
export function isOnDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Where Job discovery finds Job Offers, each of which an Administrator can turn off:
 * France Travail's API, the web-search provider, and the public APIs of the ATS
 * (Greenhouse, Lever, Ashby) postings are read through.
 */
export const JOB_DISCOVERY_SOURCES = ["france_travail", "web_search", "ats_apis"] as const;
export type JobDiscoverySource = (typeof JOB_DISCOVERY_SOURCES)[number];

/** A domain an Administrator listed for Job discovery: searched on purpose while enabled, skipped while disabled. */
export interface JobDiscoverySite {
  /** A domain name, e.g. "apec.fr" (without "www."). */
  domain: string;
  enabled: boolean;
}

/** What one run of Job discovery reads from the Back Office before it starts. */
export interface JobDiscoverySettings {
  sources: Record<JobDiscoverySource, boolean>;
  sites: JobDiscoverySite[];
}

/** Every source on and no site listed: Job discovery as it runs when the Back Office cannot be read. */
export const DEFAULT_JOB_DISCOVERY_SETTINGS: JobDiscoverySettings = Object.freeze({
  sources: Object.freeze({ france_travail: true, web_search: true, ats_apis: true }),
  sites: Object.freeze([]) as unknown as JobDiscoverySite[],
}) as JobDiscoverySettings;

/** The longest domain name DNS allows. */
const MAX_DOMAIN_LENGTH = 253;
/** A host name of at least two labels, ending with a top-level domain made of letters. */
const HOST_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * The domain an Administrator means by `input` ("apec.fr", "www.apec.fr" or
 * "https://www.apec.fr/emploi"), lower-cased and without "www.", or null when
 * it is not a domain name.
 */
export function jobDiscoveryDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let host = input.trim().toLowerCase();
  if (/^https?:\/\//.test(host)) {
    try {
      const url = new URL(host);
      if (url.port || url.username || url.password) return null;
      host = url.hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  return host.length <= MAX_DOMAIN_LENGTH && HOST_NAME.test(host) ? host : null;
}

/** One of the extension's Job Sites, as the extension reads it from the web app. */
export interface ExtensionJobSite {
  /** A browser match pattern ("https://*.gestmax.fr/*"): where the badge may show. */
  pattern: string;
  /**
   * A match pattern of the site's posting pages: the badge shows there even without
   * schema.org JobPosting data. Null: only pages publishing a JobPosting, or the
   * extension's own known posting pages for a built-in site.
   */
  postingPages: string | null;
  enabled: boolean;
}

/** What the extension reads from the web app (GET /api/job-sites). */
export interface ExtensionJobSiteList {
  sites: ExtensionJobSite[];
}

/**
 * The extension's built-in Job Sites: the sites its manifest covers (JOB_SITES in
 * apps/extension/src/job-page.ts; a test keeps both lists the same). Seeded into
 * the Back Office, where they can be disabled but not removed.
 */
export const BUILT_IN_JOB_SITES: readonly string[] = [
  "https://*.linkedin.com/*",
  "https://*.indeed.com/*",
  "https://*.indeed.fr/*",
  "https://*.indeed.co.uk/*",
  "https://*.indeed.de/*",
  "https://www.welcometothejungle.com/*",
  "https://www.apec.fr/*",
  "https://candidat.francetravail.fr/*",
  "https://www.hellowork.com/*",
  "https://www.cadremploi.fr/*",
  "https://*.glassdoor.fr/*",
  "https://*.glassdoor.com/*",
  "https://*.glassdoor.co.uk/*",
  "https://*.glassdoor.de/*",
  "https://*.glassdoor.be/*",
  "https://*.glassdoor.ch/*",
  "https://jobs.lever.co/*",
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://job-boards.eu.greenhouse.io/*",
  "https://*.teamtailor.com/*",
  "https://jobs.smartrecruiters.com/*",
  "https://careers.smartrecruiters.com/*",
  "https://*.myworkdayjobs.com/*",
  "https://apply.workable.com/*",
  "https://*.recruitee.com/*",
  "https://*.welcomekit.co/*",
  "https://*.gestmax.fr/*",
];

/** The longest match pattern a Job Site may have. */
const MAX_PATTERN_LENGTH = 300;
/** A match pattern's path: from "/", URL characters and "*" only. */
const PATTERN_PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;

/**
 * The browser match pattern an Administrator means by `input`, or null when it is
 * not one the extension can use. Only https, one site per pattern (a host name,
 * optionally with a leading "*." for it and its subdomains; never every site), no port.
 * A missing scheme means https and a missing path "/*": "*.gestmax.fr" is
 * "https://*.gestmax.fr/*".
 */
export function jobSitePattern(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (!text.includes("://")) text = `https://${text}`;
  const parts = /^https:\/\/([^/?#]+)(\/.*)?$/.exec(text);
  if (!parts) return null;
  const host = parts[1]!.toLowerCase();
  const path = parts[2] ?? "/*";
  const name = host.startsWith("*.") ? host.slice(2) : host;
  if (name.length > MAX_DOMAIN_LENGTH || !HOST_NAME.test(name) || !PATTERN_PATH.test(path)) return null;
  const pattern = `https://${host}${path}`;
  return pattern.length <= MAX_PATTERN_LENGTH ? pattern : null;
}

/** The host part of a match pattern from `jobSitePattern` ("*.gestmax.fr"). */
export function jobSitePatternHost(pattern: string): string {
  return /^https:\/\/([^/]+)/.exec(pattern)?.[1] ?? "";
}

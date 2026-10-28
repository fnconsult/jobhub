/**
 * The extension's Job Sites as Administrators manage them in the Back Office
 * (#188): where the "Analyser cette offre" badge shows, without a new release.
 *
 * The background reads the list from the web app (GET /api/job-sites), keeps it
 * in storage.local and reads it again after an hour; while the web app cannot be
 * reached, the last list read stands, and before any was read, the built-in
 * sites (JOB_SITES), all enabled. The badge's content script asks the background
 * for it, then `badgeShows` decides:
 *  - a built-in site keeps its manifest permission and content script; disabled,
 *    it gets no badge;
 *  - an added site is read through the optional every-site permission: the
 *    content script registered for every other site once the person grants it
 *    (all-sites-detection.ts) runs there, and an enabled added site's posting
 *    pages get the badge even without JobPosting data;
 *  - elsewhere, as before, a page publishing one JobPosting gets the badge.
 * Manual Capture from the Side Panel works everywhere, disabled sites included.
 */
import { jobSitePattern, type ExtensionJobSite, type ExtensionJobSiteList } from "@jobhub/shared";
import { MatchPattern } from "wxt/utils/match-patterns";
import { JOB_SITES, readJobPage, type PageSnapshot } from "./job-page";

/** The list before the web app ever answered: the built-in sites, all enabled. */
export const BUILT_IN_JOB_SITE_LIST: ExtensionJobSiteList = Object.freeze({
  sites: JOB_SITES.map((pattern) => ({ pattern, postingPages: null, enabled: true })),
});

/** How long a list read from the web app is used before it is read again. */
export const JOB_SITES_MAX_AGE_MS = 60 * 60 * 1000;
/** How long the extension waits before asking a web app that did not answer again. */
export const JOB_SITES_RETRY_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const STORAGE_KEY = "jobSites";

/** A pattern the extension may use: an https match pattern of one site, as the Back Office accepts. */
function usablePattern(value: unknown): value is string {
  if (typeof value !== "string" || jobSitePattern(value) !== value) return false;
  try {
    new MatchPattern(value);
    return true;
  } catch {
    return false;
  }
}

/** The list the web app sent, without the entries the extension cannot use; null when it is not a list. */
export function jobSiteListFrom(json: unknown): ExtensionJobSiteList | null {
  if (typeof json !== "object" || json === null || !Array.isArray((json as { sites?: unknown }).sites)) return null;
  const sites: ExtensionJobSite[] = [];
  for (const entry of (json as { sites: unknown[] }).sites) {
    if (typeof entry !== "object" || entry === null) continue;
    const { pattern, postingPages, enabled } = entry as Record<string, unknown>;
    if (!usablePattern(pattern) || typeof enabled !== "boolean") continue;
    sites.push({ pattern, postingPages: usablePattern(postingPages) ? postingPages : null, enabled });
  }
  return { sites };
}

const includes = (pattern: string, url: string): boolean => {
  try {
    return new MatchPattern(pattern).includes(url);
  } catch {
    return false;
  }
};

/**
 * Whether the badge shows on this page: it is a job posting (see `readJobPage`) or
 * a posting page of an enabled added site, and it is on no disabled site.
 * A URL on a disabled site and an enabled one gets no badge.
 */
export function badgeShows(page: PageSnapshot, list: ExtensionJobSiteList): boolean {
  if (!/^https?:/.test(page.url)) return false;
  const sitesOfPage = list.sites.filter((site) => includes(site.pattern, page.url));
  if (sitesOfPage.some((site) => !site.enabled)) return false;
  if (readJobPage(page).detected) return true;
  return sitesOfPage.some((site) => site.postingPages !== null && includes(site.postingPages, page.url));
}

/** The part of chrome.storage.local this module uses. */
export interface JobSitesStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface Kept {
  list: ExtensionJobSiteList | null;
  /** When the list was read from the web app (ms since the epoch). */
  readAt: number;
  /** When the web app last failed to answer, if after `readAt`. */
  failedAt?: number;
}

export interface JobSites {
  /** The Job Sites to use now: read again from the web app when the kept list is too old. Never throws. */
  current(): Promise<ExtensionJobSiteList>;
}

export function createJobSites(options: { origin: string; fetch: typeof globalThis.fetch; storage: JobSitesStorage; now?: () => number }): JobSites {
  const now = options.now ?? Date.now;
  let reading: Promise<ExtensionJobSiteList> | undefined;

  async function kept(): Promise<Kept | null> {
    const stored = (await options.storage.get(STORAGE_KEY))[STORAGE_KEY];
    if (typeof stored !== "object" || stored === null) return null;
    const { list, readAt, failedAt } = stored as Record<string, unknown>;
    if (typeof readAt !== "number") return null;
    return { list: jobSiteListFrom(list), readAt, ...(typeof failedAt === "number" ? { failedAt } : {}) };
  }

  async function read(): Promise<ExtensionJobSiteList> {
    const last = await kept().catch(() => null);
    const time = now();
    if (last?.list && time - last.readAt < JOB_SITES_MAX_AGE_MS) return last.list;
    if (last?.failedAt !== undefined && time - last.failedAt < JOB_SITES_RETRY_MS) return last.list ?? BUILT_IN_JOB_SITE_LIST;
    try {
      const response = await options.fetch(`${options.origin}/api/job-sites`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const list = response.ok ? jobSiteListFrom(await response.json()) : null;
      if (!list) throw new Error(`the web app answered ${response.status} without a list of Job Sites`);
      await options.storage.set({ [STORAGE_KEY]: { list, readAt: time } }).catch(() => undefined);
      return list;
    } catch {
      await options.storage.set({ [STORAGE_KEY]: { list: last?.list ?? null, readAt: last?.readAt ?? 0, failedAt: time } }).catch(() => undefined);
      return last?.list ?? BUILT_IN_JOB_SITE_LIST;
    }
  }

  return {
    current() {
      // Pages opening together share one read.
      reading ??= read().finally(() => (reading = undefined));
      return reading;
    },
  };
}

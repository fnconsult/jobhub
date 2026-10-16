import { BUILT_IN_JOB_SITES, type ExtensionJobSiteList } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { JOB_SITES, type PageSnapshot } from "./job-page";
import { badgeShows, BUILT_IN_JOB_SITE_LIST, createJobSites, JOB_SITES_MAX_AGE_MS, JOB_SITES_RETRY_MS, jobSiteListFrom, type JobSitesStorage } from "./job-sites";

/** A page as the content script sees it, without JobPosting data unless given. */
function page(url: string, structuredData: string[] = []): PageSnapshot {
  return { url, title: "Offre", heading: "Directeur financier H/F", structuredData, text: "Directeur financier H/F\nVous pilotez la finance." };
}
const withJobPosting = (url: string) => page(url, [JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "DAF H/F", description: "Poste de DAF." })]);

const LINKEDIN_POSTING = "https://www.linkedin.com/jobs/view/3912345678/";
const TALEEZ_POSTING = "https://recrutement.taleez.fr/4521/1/directeur-financier/offre/fr_FR";

/** The built-in sites, with some changed as an Administrator would. */
function listWith(...changes: { pattern: string; postingPages?: string | null; enabled: boolean }[]): ExtensionJobSiteList {
  const sites = BUILT_IN_JOB_SITE_LIST.sites.filter((site) => !changes.some((change) => change.pattern === site.pattern));
  return { sites: [...sites, ...changes.map((change) => ({ postingPages: null, ...change }))] };
}

describe("the extension's built-in Job Sites", () => {
  it("are the ones the Back Office starts from, so each can be disabled there", () => {
    expect([...BUILT_IN_JOB_SITES].sort()).toEqual([...JOB_SITES].sort());
  });

  it("all survive the extension's own check of the list the web app sends", () => {
    expect(jobSiteListFrom(BUILT_IN_JOB_SITE_LIST)).toEqual(BUILT_IN_JOB_SITE_LIST);
  });
});

describe("where the badge shows", () => {
  it("on a built-in site's postings while it is enabled, as before", () => {
    expect(badgeShows(page(LINKEDIN_POSTING), BUILT_IN_JOB_SITE_LIST)).toBe(true);
  });

  it("nowhere on a built-in site an Administrator disabled, even on a page publishing a JobPosting", () => {
    const list = listWith({ pattern: "https://*.linkedin.com/*", enabled: false });

    expect(badgeShows(page(LINKEDIN_POSTING), list)).toBe(false);
    expect(badgeShows(withJobPosting(LINKEDIN_POSTING), list)).toBe(false);
  });

  it("on an added site's posting pages, even without JobPosting data, while it is enabled", () => {
    const added = { pattern: "https://*.taleez.fr/*", postingPages: "https://*.taleez.fr/*/offre/*", enabled: true };

    expect(badgeShows(page(TALEEZ_POSTING), listWith(added))).toBe(true);
    expect(badgeShows(page("https://recrutement.taleez.fr/search"), listWith(added))).toBe(false);
    expect(badgeShows(page(TALEEZ_POSTING), listWith({ ...added, enabled: false }))).toBe(false);
    expect(badgeShows(withJobPosting(TALEEZ_POSTING), listWith({ ...added, enabled: false }))).toBe(false);
  });

  it("elsewhere, only on a page publishing a JobPosting, as before", () => {
    expect(badgeShows(page(TALEEZ_POSTING), BUILT_IN_JOB_SITE_LIST)).toBe(false);
    expect(badgeShows(withJobPosting("https://careers.example-industrie.fr/postes/daf"), BUILT_IN_JOB_SITE_LIST)).toBe(true);
  });
});

describe("the list the web app sends", () => {
  it("keeps only the entries the extension can use", () => {
    expect(
      jobSiteListFrom({
        sites: [
          { pattern: "https://*.taleez.fr/*", postingPages: "https://*.taleez.fr/*/offre/*", enabled: true },
          { pattern: "https://*/*", postingPages: null, enabled: true },
          { pattern: "<all_urls>", postingPages: null, enabled: true },
          { pattern: "http://example.fr/*", postingPages: null, enabled: true },
          { pattern: "https://www.apec.fr/*", postingPages: "not a pattern", enabled: false },
          { pattern: "https://jobs.example.fr/*", postingPages: null, enabled: "yes" },
          "https://jobs.example.fr/*",
        ],
      }),
    ).toEqual({
      sites: [
        { pattern: "https://*.taleez.fr/*", postingPages: "https://*.taleez.fr/*/offre/*", enabled: true },
        { pattern: "https://www.apec.fr/*", postingPages: null, enabled: false },
      ],
    });
  });

  it.each([null, "sites", {}, { sites: "all" }])("is no list when it is %j", (json) => {
    expect(jobSiteListFrom(json)).toBeNull();
  });
});

describe("reading the Job Sites from the web app", () => {
  const ORIGIN = "https://app.jobbbox.fr";
  const FROM_WEB_APP: ExtensionJobSiteList = listWith({ pattern: "https://*.linkedin.com/*", enabled: false });

  function setup(answer: () => Promise<Response>) {
    let time = 1_000_000;
    const requests: string[] = [];
    const stored = new Map<string, unknown>();
    const storage: JobSitesStorage = {
      async get(key) {
        return stored.has(key) ? { [key]: stored.get(key) } : {};
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) stored.set(key, structuredClone(value));
      },
    };
    const fetch = (async (input: string | URL | Request) => {
      requests.push(String(input));
      return answer();
    }) as typeof globalThis.fetch;
    const options = { origin: ORIGIN, fetch, storage, now: () => time };
    return {
      jobSites: createJobSites(options),
      /** The extension started again (its background is stopped by the browser now and then): only storage.local is left. */
      restarted: () => createJobSites(options),
      requests,
      later: (ms: number) => (time += ms),
    };
  }

  it("reads them from the web app and keeps them an hour, across restarts of the extension", async () => {
    const { jobSites, restarted, requests, later } = setup(async () => Response.json(FROM_WEB_APP));

    expect(await jobSites.current()).toEqual(FROM_WEB_APP);
    expect(await restarted().current()).toEqual(FROM_WEB_APP);
    expect(requests).toEqual([`${ORIGIN}/api/job-sites`]);

    later(JOB_SITES_MAX_AGE_MS);
    await jobSites.current();
    expect(requests).toHaveLength(2);
  });

  it("uses the built-in sites, all enabled, until the web app has answered once", async () => {
    const { jobSites } = setup(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await jobSites.current()).toEqual(BUILT_IN_JOB_SITE_LIST);
  });

  it("keeps the last list while the web app cannot be reached, and does not ask it again for a few minutes", async () => {
    let up = true;
    const { jobSites, requests, later } = setup(async () => (up ? Response.json(FROM_WEB_APP) : new Response("Bad Gateway", { status: 502 })));
    await jobSites.current();
    up = false;
    later(JOB_SITES_MAX_AGE_MS);

    expect(await jobSites.current()).toEqual(FROM_WEB_APP);
    expect(await jobSites.current()).toEqual(FROM_WEB_APP);
    expect(requests).toHaveLength(2);

    up = true;
    later(JOB_SITES_RETRY_MS);
    expect(await jobSites.current()).toEqual(FROM_WEB_APP);
    expect(requests).toHaveLength(3);
  });

  it("asks the web app once for pages opening together", async () => {
    const { jobSites, requests } = setup(async () => Response.json(FROM_WEB_APP));

    await Promise.all([jobSites.current(), jobSites.current(), jobSites.current()]);

    expect(requests).toHaveLength(1);
  });
});

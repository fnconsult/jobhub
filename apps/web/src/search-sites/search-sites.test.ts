import { BUILT_IN_JOB_SITES, DEFAULT_JOB_DISCOVERY_SETTINGS } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { createSearchSites, migrateSearchSites, type SearchSites } from "./index";

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("Search sites (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  let database: Pool;
  let sites: SearchSites;

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_search_sites");
    database = throwaway.pool;
    await migrateSearchSites(database);
    sites = createSearchSites(database);
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  describe("the extension's Job Sites", () => {
    it("start as the extension's built-in sites, all enabled", async () => {
      const listed = await sites.jobSites();

      expect(listed.map((site) => site.pattern).sort()).toEqual([...BUILT_IN_JOB_SITES].sort());
      expect(listed.every((site) => site.builtIn && site.enabled && site.postingPages === null)).toBe(true);
    });

    it("can be added, with the match pattern of their posting pages, and are then read by the extension", async () => {
      const added = await sites.addJobSite({ pattern: " *.Gestmax.fr ", postingPages: "https://*.gestmax.fr/*/offre/*" });

      expect(added).toEqual({ ok: true, site: { pattern: "https://*.gestmax.fr/*", postingPages: "https://*.gestmax.fr/*/offre/*", builtIn: false, enabled: true } });
      expect((await sites.extensionJobSites()).sites).toContainEqual({ pattern: "https://*.gestmax.fr/*", postingPages: "https://*.gestmax.fr/*/offre/*", enabled: true });
    });

    it.each([
      ["every site", { pattern: "https://*/*" }],
      ["every site, written another way", { pattern: "<all_urls>" }],
      ["a plain http site", { pattern: "http://example.fr/*" }],
      ["a port", { pattern: "https://example.fr:8443/*" }],
      ["a host without a domain", { pattern: "https://localhost/*" }],
      ["something that is not a pattern", { pattern: "<script>" }],
      ["posting pages on another site", { pattern: "https://*.gestmax.fr/*", postingPages: "https://evil.example/*" }],
      ["no pattern", {}],
      ["not a form", "https://*.gestmax.fr/*"],
    ])("refuses %s", async (_, input) => {
      expect(await sites.addJobSite(input)).toEqual({ ok: false, error: "invalid" });
    });

    it("refuses a site listed already", async () => {
      expect(await sites.addJobSite({ pattern: "https://www.apec.fr/*" })).toEqual({ ok: false, error: "exists" });
    });

    it("can be disabled and enabled again, and the extension reads which", async () => {
      expect(await sites.setJobSiteEnabled("https://*.linkedin.com/*", false)).toBe(true);
      expect((await sites.extensionJobSites()).sites).toContainEqual({ pattern: "https://*.linkedin.com/*", postingPages: null, enabled: false });

      await sites.setJobSiteEnabled("https://*.linkedin.com/*", true);
      expect((await sites.extensionJobSites()).sites).toContainEqual({ pattern: "https://*.linkedin.com/*", postingPages: null, enabled: true });
      expect(await sites.setJobSiteEnabled("https://unknown.example/*", false)).toBe(false);
    });

    it("can be removed when added, while a built-in one, in the extension's manifest, can only be disabled", async () => {
      await sites.addJobSite({ pattern: "https://*.gestmax.fr/*" });

      expect(await sites.removeJobSite("https://*.gestmax.fr/*")).toBe("removed");
      expect(await sites.removeJobSite("https://*.gestmax.fr/*")).toBe("not_found");
      expect(await sites.removeJobSite("https://www.apec.fr/*")).toBe("built_in");
      expect((await sites.jobSites()).map((site) => site.pattern)).toContain("https://www.apec.fr/*");
    });
  });

  describe("Job discovery sources", () => {
    it("are all enabled to start with, as Job discovery ran before", async () => {
      expect(await sites.jobDiscoverySettings()).toEqual(DEFAULT_JOB_DISCOVERY_SETTINGS);
    });

    it("can be disabled and enabled again; an unknown source is refused", async () => {
      expect(await sites.setJobDiscoverySourceEnabled("france_travail", false)).toBe(true);
      expect(await sites.jobDiscoverySources()).toEqual({ france_travail: false, web_search: true, ats_apis: true });

      await sites.setJobDiscoverySourceEnabled("france_travail", true);
      expect((await sites.jobDiscoverySources()).france_travail).toBe(true);
      expect(await sites.setJobDiscoverySourceEnabled("monster", false)).toBe(false);
    });
  });

  describe("Job discovery sites", () => {
    it("are added as domains, enabled, whatever way the Administrator writes them", async () => {
      expect(await sites.addJobDiscoverySite("https://www.Cadremploi.fr/emploi/liste_offres")).toEqual({ ok: true, site: { domain: "cadremploi.fr", enabled: true } });
      expect(await sites.addJobDiscoverySite("apec.fr")).toEqual({ ok: true, site: { domain: "apec.fr", enabled: true } });
      expect(await sites.addJobDiscoverySite("www.apec.fr")).toEqual({ ok: false, error: "exists" });

      expect((await sites.jobDiscoverySettings()).sites).toEqual([
        { domain: "apec.fr", enabled: true },
        { domain: "cadremploi.fr", enabled: true },
      ]);
    });

    it.each(["linkedin.com", "fr.linkedin.com", "https://www.indeed.fr/emplois", "glassdoor.com"])("never lists %s, a site whose terms forbid crawling", async (site) => {
      expect(await sites.addJobDiscoverySite(site)).toEqual({ ok: false, error: "forbidden" });
      expect(await sites.jobDiscoverySites()).toEqual([]);
    });

    it.each(["", "apec", "https://", "apec.fr:8080", "http://user@apec.fr", "apec .fr", 42, null])("refuses %j, not a domain", async (input) => {
      expect(await sites.addJobDiscoverySite(input)).toEqual({ ok: false, error: "invalid" });
    });

    it("can be disabled, enabled again and removed", async () => {
      await sites.addJobDiscoverySite("apec.fr");

      expect(await sites.setJobDiscoverySiteEnabled("apec.fr", false)).toEqual({ ok: true });
      expect((await sites.jobDiscoverySettings()).sites).toEqual([{ domain: "apec.fr", enabled: false }]);
      expect(await sites.setJobDiscoverySiteEnabled("apec.fr", true)).toEqual({ ok: true });
      expect(await sites.removeJobDiscoverySite("apec.fr")).toBe(true);
      expect(await sites.removeJobDiscoverySite("apec.fr")).toBe(false);
      expect(await sites.setJobDiscoverySiteEnabled("apec.fr", true)).toEqual({ ok: false, error: "not_found" });
    });

    it("never enables a forbidden site, even one written into the table by hand", async () => {
      await database.query("INSERT INTO job_discovery_site (domain, enabled) VALUES ('linkedin.com', false)");

      expect(await sites.setJobDiscoverySiteEnabled("linkedin.com", true)).toEqual({ ok: false, error: "forbidden" });
      await database.query("UPDATE job_discovery_site SET enabled = true WHERE domain = 'linkedin.com'");
      expect((await sites.jobDiscoverySettings()).sites).toEqual([]);
    });

    it("removing one keeps the Job Offers found on it", async () => {
      await migrateJobOffers(database);
      const captured = await createJobOffers(database).capture({
        source: { url: "https://www.apec.fr/candidat/offre/1" },
        title: "DAF H/F",
        content: "Nous recherchons un DAF pour un groupe industriel à Lyon, avec 15 ans d'expérience.",
      });
      if (!captured.ok) throw new Error("fixture refused");
      await sites.addJobDiscoverySite("apec.fr");

      await sites.removeJobDiscoverySite("apec.fr");

      const { rows } = await database.query("SELECT id FROM job_offer WHERE id = $1", [captured.jobOffer.id]);
      expect(rows).toHaveLength(1);
    });
  });

  it("can be migrated again without losing what Administrators changed", async () => {
    await sites.setJobSiteEnabled("https://*.linkedin.com/*", false);
    await sites.addJobSite({ pattern: "https://*.gestmax.fr/*" });
    await sites.setJobDiscoverySourceEnabled("web_search", false);
    await sites.addJobDiscoverySite("apec.fr");

    await migrateSearchSites(database);

    const jobSites = await sites.jobSites();
    expect(jobSites).toHaveLength(BUILT_IN_JOB_SITES.length + 1);
    expect(jobSites.find((site) => site.pattern === "https://*.linkedin.com/*")?.enabled).toBe(false);
    expect(await sites.jobDiscoverySettings()).toEqual({
      sources: { france_travail: true, web_search: false, ats_apis: true },
      sites: [{ domain: "apec.fr", enabled: true }],
    });
  });

  it("a site the extension no longer builds in becomes an added one, keeping its state, so it can be removed", async () => {
    await sites.addJobSite({ pattern: "https://*.gestmax.fr/*" });
    await sites.setJobSiteEnabled("https://*.gestmax.fr/*", false);
    await database.query("UPDATE extension_job_site SET built_in = true WHERE pattern = 'https://*.gestmax.fr/*'");

    await migrateSearchSites(database);

    expect((await sites.jobSites()).find((site) => site.pattern === "https://*.gestmax.fr/*")).toMatchObject({ builtIn: false, enabled: false });
    expect(await sites.removeJobSite("https://*.gestmax.fr/*")).toBe("removed");
  });
});

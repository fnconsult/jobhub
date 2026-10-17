import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createSearchSites, migrateSearchSites, type SearchSites } from "../search-sites";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "./back-office";
import { createSearchSitesBackOffice, type SearchSitesBackOffice } from "./search-sites-back-office";

describe.skipIf(!connectionString)("the Search sites' Back Office writes and their Back Office Audit (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let searchSites: SearchSites;
  let changes: SearchSitesBackOffice;
  let claire: BackOfficeActor;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateSearchSites(database);
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, { billing: { setPlanQuotas: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused }, humanCoaches: { add: unused, retire: unused } });
    searchSites = createSearchSites(database);
    changes = createSearchSitesBackOffice(searchSites, backOffice);
    const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    claire = { id: user.id, email: user.email };
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  const entries = async () => (await backOffice.journal()).reverse().map(({ section, target, action, before, after }) => ({ section, target, action, before, after }));

  it("switching a Job discovery source records its state before and after; an unknown source records nothing", async () => {
    expect(await changes.setJobDiscoverySourceEnabled(claire, "web_search", false)).toBe(true);
    expect(await changes.setJobDiscoverySourceEnabled(claire, "monster", false)).toBe(false);

    expect((await searchSites.jobDiscoverySources()).web_search).toBe(false);
    expect(await backOffice.journal()).toEqual([
      expect.objectContaining({
        actor: { candidateId: claire.id, email: "claire@jobbbox.fr" },
        section: "job_discovery_sources",
        target: "web_search",
        action: "updated",
        before: { enabled: true },
        after: { enabled: false },
      }),
    ]);
  });

  it("adding, switching and removing a Job discovery site each record one entry; refused ones record nothing", async () => {
    expect(await changes.addJobDiscoverySite(claire, "https://www.apec.fr/")).toMatchObject({ ok: true });
    expect(await changes.addJobDiscoverySite(claire, "apec.fr")).toEqual({ ok: false, error: "exists" });
    expect(await changes.addJobDiscoverySite(claire, "linkedin.com")).toEqual({ ok: false, error: "forbidden" });
    expect(await changes.setJobDiscoverySiteEnabled(claire, "apec.fr", false)).toEqual({ ok: true });
    expect(await changes.setJobDiscoverySiteEnabled(claire, "unknown.fr", false)).toEqual({ ok: false, error: "not_found" });
    expect(await changes.removeJobDiscoverySite(claire, "apec.fr")).toBe(true);
    expect(await changes.removeJobDiscoverySite(claire, "apec.fr")).toBe(false);

    expect(await entries()).toEqual([
      { section: "job_discovery_sites", target: "apec.fr", action: "added", before: null, after: { enabled: true } },
      { section: "job_discovery_sites", target: "apec.fr", action: "updated", before: { enabled: true }, after: { enabled: false } },
      { section: "job_discovery_sites", target: "apec.fr", action: "removed", before: { enabled: false }, after: null },
    ]);
  });

  it("adding, switching and removing an extension Job Site each record one entry, with its posting pages; refused ones record nothing", async () => {
    const pattern = "https://*.taleez.fr/*";
    const postingPages = "https://*.taleez.fr/*/offre/*";
    expect(await changes.addJobSite(claire, { pattern, postingPages })).toMatchObject({ ok: true });
    expect(await changes.addJobSite(claire, { pattern: "<all_urls>" })).toEqual({ ok: false, error: "invalid" });
    expect(await changes.setJobSiteEnabled(claire, pattern, false)).toBe(true);
    expect(await changes.setJobSiteEnabled(claire, "https://unknown.example/*", false)).toBe(false);
    expect(await changes.removeJobSite(claire, "https://www.apec.fr/*")).toEqual({ ok: false, error: "built_in" });
    expect(await changes.removeJobSite(claire, pattern)).toMatchObject({ ok: true });

    expect(await entries()).toEqual([
      { section: "job_sites", target: pattern, action: "added", before: null, after: { postingPages, enabled: true } },
      { section: "job_sites", target: pattern, action: "updated", before: { postingPages, enabled: true }, after: { postingPages, enabled: false } },
      { section: "job_sites", target: pattern, action: "removed", before: { postingPages, enabled: false }, after: null },
    ]);
  });

  it("a change that cannot be recorded is not kept either", async () => {
    // An actor with no Candidate account: the entry's foreign key fails, so the change is rolled back.
    await expect(changes.setJobSiteEnabled({ id: "no-such-candidate", email: "ghost@jobbbox.fr" }, "https://*.linkedin.com/*", false)).rejects.toThrow();

    expect((await searchSites.jobSites()).find((site) => site.pattern === "https://*.linkedin.com/*")).toMatchObject({ enabled: true });
    expect(await backOffice.journal()).toEqual([]);
  });
});

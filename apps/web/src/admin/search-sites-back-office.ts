/**
 * The Search sites' Back Office writes (#188), each recorded in the Back Office Audit.
 *
 * `createSearchSitesBackOffice(searchSites, backOffice)` mirrors the Search sites'
 * writes with the Administrator making them: each runs through the Back Office's
 * `record`, so the change and its entry share one transaction. A refused write
 * (invalid, already listed, forbidden, unknown) records nothing. Entries hold the
 * enabled state and, for the extension's Job Sites, their posting pages: no secret.
 */
import type { JobDiscoverySite, JobDiscoverySource } from "@jobhub/shared";
import type { AddJobDiscoverySiteResult, AddJobSiteResult, JobSite, RemoveJobSiteResult, SearchSites } from "../search-sites";
import type { BackOffice, BackOfficeActor, BackOfficeChange } from "./back-office";

export interface SearchSitesBackOffice {
  setJobDiscoverySourceEnabled(actor: BackOfficeActor, source: string, enabled: boolean): Promise<boolean>;
  addJobDiscoverySite(actor: BackOfficeActor, input: unknown): Promise<AddJobDiscoverySiteResult>;
  setJobDiscoverySiteEnabled(actor: BackOfficeActor, domain: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: "not_found" | "forbidden" }>;
  removeJobDiscoverySite(actor: BackOfficeActor, domain: string): Promise<boolean>;
  addJobSite(actor: BackOfficeActor, input: unknown): Promise<AddJobSiteResult>;
  setJobSiteEnabled(actor: BackOfficeActor, pattern: string, enabled: boolean): Promise<boolean>;
  removeJobSite(actor: BackOfficeActor, pattern: string): Promise<RemoveJobSiteResult>;
}

/** A Job Site as recorded: its pattern is the entry's target. */
const recordedJobSite = (site: Pick<JobSite, "postingPages" | "enabled">) => ({ postingPages: site.postingPages, enabled: site.enabled });
const recordedDiscoverySite = (site: Pick<JobDiscoverySite, "enabled">) => ({ enabled: site.enabled });

export function createSearchSitesBackOffice(searchSites: SearchSites, backOffice: Pick<BackOffice, "record">): SearchSitesBackOffice {
  const sourceChange = (source: JobDiscoverySource, before: boolean, after: boolean): BackOfficeChange => ({
    section: "job_discovery_sources",
    target: source,
    action: "updated",
    before: { enabled: before },
    after: { enabled: after },
  });

  return {
    async setJobDiscoverySourceEnabled(actor, source, enabled) {
      const set = await backOffice.record(
        actor,
        (within) => searchSites.setJobDiscoverySourceEnabled(source, enabled, within),
        (done) => (done ? sourceChange(done.source, done.wasEnabled, enabled) : null),
      );
      return set !== null;
    },

    addJobDiscoverySite(actor, input) {
      return backOffice.record(
        actor,
        (within) => searchSites.addJobDiscoverySite(input, within),
        (added) =>
          added.ok ? { section: "job_discovery_sites", target: added.site.domain, action: "added", before: null, after: recordedDiscoverySite(added.site) } : null,
      );
    },

    async setJobDiscoverySiteEnabled(actor, domain, enabled) {
      const set = await backOffice.record(
        actor,
        (within) => searchSites.setJobDiscoverySiteEnabled(domain, enabled, within),
        (done) =>
          done.ok
            ? { section: "job_discovery_sites", target: done.before.domain, action: "updated", before: recordedDiscoverySite(done.before), after: { enabled } }
            : null,
      );
      return set.ok ? { ok: true } : set;
    },

    async removeJobDiscoverySite(actor, domain) {
      const removed = await backOffice.record(
        actor,
        (within) => searchSites.removeJobDiscoverySite(domain, within),
        (site) => (site ? { section: "job_discovery_sites", target: site.domain, action: "removed", before: recordedDiscoverySite(site), after: null } : null),
      );
      return removed !== null;
    },

    addJobSite(actor, input) {
      return backOffice.record(
        actor,
        (within) => searchSites.addJobSite(input, within),
        (added) => (added.ok ? { section: "job_sites", target: added.site.pattern, action: "added", before: null, after: recordedJobSite(added.site) } : null),
      );
    },

    async setJobSiteEnabled(actor, pattern, enabled) {
      const before = await backOffice.record(
        actor,
        (within) => searchSites.setJobSiteEnabled(pattern, enabled, within),
        (site) => (site ? { section: "job_sites", target: site.pattern, action: "updated", before: recordedJobSite(site), after: recordedJobSite({ ...site, enabled }) } : null),
      );
      return before !== null;
    },

    removeJobSite(actor, pattern) {
      return backOffice.record(
        actor,
        (within) => searchSites.removeJobSite(pattern, within),
        (removed) => (removed.ok ? { section: "job_sites", target: removed.site.pattern, action: "removed", before: recordedJobSite(removed.site), after: null } : null),
      );
    },
  };
}

import type { SearchCriteria } from "@jobhub/shared";
import type { Pool } from "pg";
import type { FollowUps } from "@jobhub/web/follow-ups";
import { createSourceChecks, forgetExpiredGuestCaptures } from "@jobhub/web/job-offers";
import { JOB_DISCOVERY_QUEUE, type JobSearches } from "@jobhub/web/job-searches";
import type { JobDiscovery } from "./job-discovery";
import { createSourceRecheck } from "./source-recheck";
import type { JobDefinition } from "./job-runner";

/**
 * Queue name: search the web for Job Offers matching one Profile.
 * Data: { candidateId, profileId, jobSearchId? }; with a `jobSearchId` (a Job
 * Search the Candidate started), the outcome is reported to that Job Search.
 */
export const JOB_DISCOVERY = JOB_DISCOVERY_QUEUE;

/** Queue name: re-check the sources of the Job Offers due, to find Expired Job Offers. Runs daily. */
export const SOURCE_RECHECK = "job-offers.recheck-sources";
/** Queue name: propose the Follow-ups (and "Abandonnée" suggestions) now due, and tell each Candidate. */
export const FOLLOW_UPS = "follow-ups.propose";

/** Postgres error code for a table that does not exist yet (the web app's migrations have not run). */
const UNDEFINED_TABLE = "42P01";

/** Job discovery when the worker cannot run it (e.g. no AI keys in local development): why. */
export interface DiscoveryUnavailable {
  unavailable: string;
}

export interface JobsDeps {
  database: Pick<Pool, "query">;
  now?: () => Date;
  discovery: JobDiscovery | DiscoveryUnavailable;
  /** Reads a Profile, scoped to its Candidate. Satisfied by the web app's Profiles module. */
  profiles: {
    get(candidateId: string, profileId: string): Promise<{ archived: boolean; searchCriteria: SearchCriteria } | null>;
  };
  /** Where a Job Search started by the Candidate gets its outcome. Satisfied by the web app's Job Searches module. */
  jobSearches: Pick<JobSearches, "record">;
  /** Satisfied by the web app's Follow-ups module. */
  followUps: Pick<FollowUps, "proposeDue">;
  log?: (line: string) => void;
  /** How the worker reaches job sites. Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
}

function discoveryTarget(data: unknown): { candidateId: string; profileId: string; jobSearchId?: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const { candidateId, profileId, jobSearchId } = data as Record<string, unknown>;
  if (typeof candidateId !== "string" || typeof profileId !== "string") return null;
  return typeof jobSearchId === "string" ? { candidateId, profileId, jobSearchId } : { candidateId, profileId };
}

/** Every background job the worker runs, by queue name. */
export function createJobs(deps: JobsDeps): Record<string, JobDefinition> {
  const log = deps.log ?? ((line) => console.info(line));
  const now = deps.now ?? (() => new Date());
  /** Runs a job that reads the web app's tables: before its migrations have run, there is nothing to do. */
  const onceTablesExist = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
    }
  };
  return {
    // Proves the runner is alive end to end.
    "system.heartbeat": {
      cron: "*/5 * * * *",
      handler: async () => {
        log(`[worker] heartbeat ${new Date().toISOString()}`);
      },
    },

    [JOB_DISCOVERY]: {
      handler: async (data) => {
        const target = discoveryTarget(data);
        if (!target) return log(`[job-discovery] ignored a malformed job`);
        const { jobSearchId } = target;
        const fail = async (reason: string) => {
          if (jobSearchId) await deps.jobSearches.record(jobSearchId, { failed: reason });
        };
        const profile = await deps.profiles.get(target.candidateId, target.profileId);
        if (!profile || profile.archived) {
          await fail("profile_unavailable");
          return log(`[job-discovery] profile ${target.profileId}: gone or archived, skipped`);
        }

        if ("unavailable" in deps.discovery) {
          await fail("unavailable");
          return log(
            `[job-discovery] profile ${target.profileId}: skipped, Job discovery is unavailable (${deps.discovery.unavailable})`,
          );
        }
        let report;
        try {
          report = await deps.discovery.discover({ candidateId: target.candidateId, criteria: profile.searchCriteria });
        } catch (error) {
          // The Candidate is waiting for this Job Search: say it failed rather than retry it later.
          if (!jobSearchId) throw error;
          await fail("discovery_failed");
          return log(`[job-discovery] profile ${target.profileId}: failed (${error instanceof Error ? error.message : String(error)})`);
        }
        if (jobSearchId) await deps.jobSearches.record(jobSearchId, { jobOfferIds: report.jobOffers.map((jobOffer) => jobOffer.id) });
        const reasons = new Map<string, number>();
        for (const { reason } of report.skipped) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        const detail = [...reasons].map(([reason, count]) => `${reason}: ${count}`).join(", ");
        log(
          `[job-discovery] profile ${target.profileId}: ${report.jobOffers.length} Job Offer(s), ` +
            `${report.skipped.length} page(s) skipped${detail ? ` (${detail})` : ""}`,
        );
      },
    },

    // Working mornings, 6:00 UTC (7:00 or 8:00 in France): the notice emails arrive with the day. Safe to run again.
    [FOLLOW_UPS]: {
      cron: "0 6 * * 1-5",
      handler: async () => {
        try {
          await deps.followUps.proposeDue((deps.now ?? (() => new Date()))());
        } catch (error) {
          if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
        }
      },
    },

    // Guest data is deleted within 24 hours (ADR-0003); GUEST_RETENTION_HOURS leaves room for this interval.
    "guests.forget": {
      cron: "*/15 * * * *",
      handler: () =>
        onceTablesExist(async () => {
          const forgotten = await forgetExpiredGuestCaptures(deps.database, now());
          if (forgotten) log(`[worker] forgot ${forgotten} Job Offer(s) captured by Guests`);
        }),
    },

    // Daily, for the Job Offers whose source was last read RECHECK_INTERVAL_DAYS ago or more (ADR-0002 rules).
    [SOURCE_RECHECK]: {
      cron: "0 4 * * *",
      handler: () =>
        onceTablesExist(async () => {
          const recheck = createSourceRecheck({ store: createSourceChecks(deps.database), fetch: deps.fetch });
          const report = await recheck.run(now());
          log(
            `[source-recheck] ${report.checked} Job Offer(s) re-checked, ${report.expired.length} expired, ${report.unknown.length} unread`,
          );
        }),
    },
  };
}

import type { SearchCriteria } from "@jobhub/shared";
import type { Pool } from "pg";
import type { JobDigests } from "@jobhub/web/job-digests";
import { forgetExpiredGuestCaptures } from "@jobhub/web/job-offers";
import { JOB_DISCOVERY_QUEUE, type JobSearches } from "@jobhub/web/job-searches";
import type { JobDiscovery } from "./job-discovery";
import type { JobDefinition } from "./job-runner";

/**
 * Queue name: search the web for Job Offers matching one Profile.
 * Data: { candidateId, profileId, jobSearchId? }; with a `jobSearchId` (a Job
 * Search the Candidate started), the outcome is reported to that Job Search.
 */
export const JOB_DISCOVERY = JOB_DISCOVERY_QUEUE;

/** Queue name, run every hour: queues a JOB_DIGEST_RUN for each Profile whose Job Digest is due. */
export const JOB_DIGEST_SCHEDULE = "job-digest.schedule";

/**
 * Queue name: make one Profile's Job Digest. Data: { candidateId, profileId }.
 * Job discovery runs on the Profile's current Search Criteria, then the Job
 * Offers found that the Profile was never shown before are kept and emailed.
 */
export const JOB_DIGEST_RUN = "job-digest.run";

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
  /** The worker's side of Job Digests. Satisfied by the web app's Job Digests module. */
  jobDigests: Pick<JobDigests, "claimDue" | "deliver">;
  /** Queues another job of this worker. */
  enqueue: (name: string, data: object) => Promise<void>;
  log?: (line: string) => void;
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

    [JOB_DIGEST_SCHEDULE]: {
      cron: "0 * * * *",
      handler: async () => {
        for (const due of await deps.jobDigests.claimDue()) await deps.enqueue(JOB_DIGEST_RUN, due);
      },
    },

    [JOB_DIGEST_RUN]: {
      handler: async (data) => {
        const target = discoveryTarget(data);
        if (!target) return log(`[job-digest] ignored a malformed job`);
        const profile = await deps.profiles.get(target.candidateId, target.profileId);
        if (!profile || profile.archived) return log(`[job-digest] profile ${target.profileId}: gone or archived, skipped`);
        if ("unavailable" in deps.discovery) {
          return log(`[job-digest] profile ${target.profileId}: skipped, Job discovery is unavailable (${deps.discovery.unavailable})`);
        }
        const report = await deps.discovery.discover({ candidateId: target.candidateId, criteria: profile.searchCriteria });
        const found = report.jobOffers.map((jobOffer) => jobOffer.id);
        const digest = await deps.jobDigests.deliver(target.candidateId, target.profileId, found);
        log(
          `[job-digest] profile ${target.profileId}: ${found.length} Job Offer(s) found, ` +
            (digest ? "Job Digest sent" : "nothing new to send"),
        );
      },
    },

    // Guest data is deleted within 24 hours (ADR-0003); GUEST_RETENTION_HOURS leaves room for this interval.
    "guests.forget": {
      cron: "*/15 * * * *",
      handler: async () => {
        try {
          const forgotten = await forgetExpiredGuestCaptures(deps.database, (deps.now ?? (() => new Date()))());
          if (forgotten) log(`[worker] forgot ${forgotten} Job Offer(s) captured by Guests`);
        } catch (error) {
          if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
        }
      },
    },
  };
}

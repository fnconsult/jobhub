import type { SearchCriteria } from "@jobhub/shared";
import type { JobDiscovery } from "./job-discovery";
import type { JobDefinition } from "./job-runner";

/** Queue name: search the web for Job Offers matching one Profile. Data: { candidateId, profileId }. */
export const JOB_DISCOVERY = "job-discovery.run";

/** Job discovery when the worker cannot run it (e.g. no AI keys in local development): why. */
export interface DiscoveryUnavailable {
  unavailable: string;
}

export interface JobsDeps {
  discovery: JobDiscovery | DiscoveryUnavailable;
  /** Reads a Profile, scoped to its Candidate. Satisfied by the web app's Profiles module. */
  profiles: {
    get(candidateId: string, profileId: string): Promise<{ archived: boolean; searchCriteria: SearchCriteria } | null>;
  };
  log?: (line: string) => void;
}

function discoveryTarget(data: unknown): { candidateId: string; profileId: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const { candidateId, profileId } = data as Record<string, unknown>;
  return typeof candidateId === "string" && typeof profileId === "string" ? { candidateId, profileId } : null;
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
        const profile = await deps.profiles.get(target.candidateId, target.profileId);
        if (!profile || profile.archived) return log(`[job-discovery] profile ${target.profileId}: gone or archived, skipped`);

        if ("unavailable" in deps.discovery) {
          return log(
            `[job-discovery] profile ${target.profileId}: skipped, Job discovery is unavailable (${deps.discovery.unavailable})`,
          );
        }
        const report = await deps.discovery.discover({ candidateId: target.candidateId, criteria: profile.searchCriteria });
        const reasons = new Map<string, number>();
        for (const { reason } of report.skipped) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
        const detail = [...reasons].map(([reason, count]) => `${reason}: ${count}`).join(", ");
        log(
          `[job-discovery] profile ${target.profileId}: ${report.jobOffers.length} Job Offer(s), ` +
            `${report.skipped.length} page(s) skipped${detail ? ` (${detail})` : ""}`,
        );
      },
    },
  };
}

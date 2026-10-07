import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { DiscoverRequest, DiscoveryReport } from "./job-discovery";
import { createJobs, JOB_DISCOVERY } from "./jobs";

const criteria: SearchCriteria = { targetRole: "Directeur financier", location: "Lyon" };

function setup() {
  const runs: DiscoverRequest[] = [];
  const logs: string[] = [];
  const jobs = createJobs({
    discovery: {
      async discover(request): Promise<DiscoveryReport> {
        runs.push(request);
        return { jobOffers: [], skipped: [{ url: "https://fr.linkedin.com/jobs/1", reason: "site_terms" }] };
      },
    },
    profiles: {
      async get(candidateId, profileId) {
        if (candidateId !== "candidate-1" || !["profile-1", "archived-1"].includes(profileId)) return null;
        return { archived: profileId === "archived-1", searchCriteria: criteria };
      },
    },
    log: (line) => logs.push(line),
  });
  return { run: jobs[JOB_DISCOVERY]!.handler, runs, logs };
}

describe("the Job discovery job", () => {
  it("searches with the Profile's current Search Criteria", async () => {
    const { run, runs, logs } = setup();

    await run({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(runs).toEqual([{ candidateId: "candidate-1", criteria }]);
    expect(logs).toEqual(["[job-discovery] profile profile-1: 0 Job Offer(s), 1 page(s) skipped (site_terms: 1)"]);
  });

  it("does nothing for a Profile that no longer exists or is archived, or a malformed job", async () => {
    const { run, runs } = setup();

    await run({ candidateId: "candidate-1", profileId: "gone" });
    await run({ candidateId: "candidate-1", profileId: "archived-1" });
    await run({ candidateId: 42 });

    expect(runs).toEqual([]);
  });
});

describe("the worker without an AI layer", () => {
  // The local docker-compose worker has no AI keys: it must still run its other jobs.
  it("keeps the heartbeat and skips Job discovery, saying why", async () => {
    const logs: string[] = [];
    const jobs = createJobs({
      discovery: { unavailable: "Missing environment variable PERPLEXITY_API_KEY" },
      profiles: { get: async () => ({ archived: false, searchCriteria: criteria }) },
      log: (line) => logs.push(line),
    });

    await jobs["system.heartbeat"]!.handler(undefined);
    await jobs[JOB_DISCOVERY]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(logs[0]).toMatch(/^\[worker\] heartbeat /);
    expect(logs[1]).toBe(
      "[job-discovery] profile profile-1: skipped, Job discovery is unavailable (Missing environment variable PERPLEXITY_API_KEY)",
    );
  });
});

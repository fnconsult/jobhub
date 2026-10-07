import type { SearchCriteria } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { DiscoverRequest, DiscoveryReport } from "./job-discovery";
import type { JobSearchOutcome } from "@jobhub/web/job-searches";
import { createJobs, JOB_DISCOVERY } from "./jobs";

const criteria: SearchCriteria = { targetRole: "Directeur financier", location: "Lyon" };

const found = [
  { id: "offer-1", source: {}, title: "DAF H/F", content: "DAF à Lyon." },
  { id: "offer-2", source: {}, title: "Directeur financier", content: "Directeur financier à Lyon." },
];

function setup(discover?: (request: DiscoverRequest) => Promise<DiscoveryReport>) {
  const runs: DiscoverRequest[] = [];
  const logs: string[] = [];
  const recorded: [string, JobSearchOutcome][] = [];
  const jobs = createJobs({
    discovery: {
      async discover(request): Promise<DiscoveryReport> {
        runs.push(request);
        if (discover) return discover(request);
        return { jobOffers: [], skipped: [{ url: "https://fr.linkedin.com/jobs/1", reason: "site_terms" }] };
      },
    },
    jobSearches: { record: async (id, outcome) => void recorded.push([id, outcome]) },
    profiles: {
      async get(candidateId, profileId) {
        if (candidateId !== "candidate-1" || !["profile-1", "archived-1"].includes(profileId)) return null;
        return { archived: profileId === "archived-1", searchCriteria: criteria };
      },
    },
    log: (line) => logs.push(line),
  });
  return { run: jobs[JOB_DISCOVERY]!.handler, runs, logs, recorded };
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

describe("the Job discovery job, for a Job Search the Candidate started", () => {
  it("reports the Job Offers found to the Job Search", async () => {
    const { run, recorded } = setup(async () => ({ jobOffers: found, skipped: [] }));

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(recorded).toEqual([["search-1", { jobOfferIds: ["offer-1", "offer-2"] }]]);
  });

  it("reports the Job Search as failed when its Profile is gone or archived", async () => {
    const { run, recorded } = setup();

    await run({ candidateId: "candidate-1", profileId: "gone", jobSearchId: "search-1" });
    await run({ candidateId: "candidate-1", profileId: "archived-1", jobSearchId: "search-2" });

    expect(recorded).toEqual([
      ["search-1", { failed: "profile_unavailable" }],
      ["search-2", { failed: "profile_unavailable" }],
    ]);
  });

  it("reports the Job Search as failed when Job discovery breaks, instead of trying again", async () => {
    const { run, recorded, logs } = setup(async () => Promise.reject(new Error("Perplexity answered 500")));

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(recorded).toEqual([["search-1", { failed: "discovery_failed" }]]);
    expect(logs).toEqual(["[job-discovery] profile profile-1: failed (Perplexity answered 500)"]);
  });
});

describe("the worker without an AI layer", () => {
  // The local docker-compose worker has no AI keys: it must still run its other jobs.
  it("keeps the heartbeat and skips Job discovery, saying why", async () => {
    const logs: string[] = [];
    const recorded: [string, JobSearchOutcome][] = [];
    const jobs = createJobs({
      discovery: { unavailable: "Missing environment variable PERPLEXITY_API_KEY" },
      profiles: { get: async () => ({ archived: false, searchCriteria: criteria }) },
      jobSearches: { record: async (id, outcome) => void recorded.push([id, outcome]) },
      log: (line) => logs.push(line),
    });

    await jobs["system.heartbeat"]!.handler(undefined);
    await jobs[JOB_DISCOVERY]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(logs[0]).toMatch(/^\[worker\] heartbeat /);
    expect(logs[1]).toBe(
      "[job-discovery] profile profile-1: skipped, Job discovery is unavailable (Missing environment variable PERPLEXITY_API_KEY)",
    );

    await jobs[JOB_DISCOVERY]!.handler({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });
    expect(recorded).toEqual([["search-1", { failed: "unavailable" }]]);
  });
});

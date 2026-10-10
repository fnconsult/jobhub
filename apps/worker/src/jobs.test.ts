import type { SearchCriteria } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJobOffers, migrateJobOffers } from "@jobhub/web/job-offers";
import { createThrowawayDatabase } from "../../web/src/test-support/throwaway-database";
import type { DiscoverRequest, DiscoveryReport } from "./job-discovery";
import type { JobSearchOutcome } from "@jobhub/web/job-searches";
import type { DueJobDigest } from "@jobhub/web/job-digests";
import { createJobs, FOLLOW_UPS, JOB_DIGEST_RUN, JOB_DIGEST_SCHEDULE, JOB_DISCOVERY, type JobsDeps } from "./jobs";

const connectionString = process.env.DATABASE_URL;

/** For the jobs that never touch the database. */
const noDatabase: JobsDeps["database"] = {
  query: async () => {
    throw new Error("unexpected query");
  },
};

/** For the jobs that never touch Job Digests. */
const noJobDigests: JobsDeps["jobDigests"] = {
  claimDue: async () => [],
  deliver: async () => null,
};

const criteria: SearchCriteria = { targetRole: "Directeur financier", location: "Lyon" };

const found = [
  { id: "offer-1", source: {}, title: "DAF H/F", content: "DAF à Lyon." },
  { id: "offer-2", source: {}, title: "Directeur financier", content: "Directeur financier à Lyon." },
];

function setup(discover?: (request: DiscoverRequest) => Promise<DiscoveryReport>, due: DueJobDigest[] = []) {
  const runs: DiscoverRequest[] = [];
  const logs: string[] = [];
  const recorded: [string, JobSearchOutcome][] = [];
  const enqueued: { name: string; data: object }[] = [];
  const delivered: [string, string, string[]][] = [];
  const jobs = createJobs({
    database: noDatabase,
    discovery: {
      async discover(request): Promise<DiscoveryReport> {
        runs.push(request);
        if (discover) return discover(request);
        return { jobOffers: [], skipped: [{ url: "https://fr.linkedin.com/jobs/1", reason: "site_terms" }] };
      },
    },
    jobSearches: { record: async (id, outcome) => void recorded.push([id, outcome]) },
    followUps: { proposeDue: async () => {} },
    profiles: {
      async get(candidateId, profileId) {
        if (candidateId !== "candidate-1" || !["profile-1", "archived-1"].includes(profileId)) return null;
        return { archived: profileId === "archived-1", searchCriteria: criteria };
      },
    },
    jobDigests: {
      claimDue: async () => due.splice(0),
      async deliver(candidateId, profileId, jobOfferIds) {
        delivered.push([candidateId, profileId, jobOfferIds]);
        return jobOfferIds.length ? { id: "digest-1", sentAt: new Date(), results: [] } : null;
      },
    },
    enqueue: async (name, data) => void enqueued.push({ name, data }),
    log: (line) => logs.push(line),
  });
  return { jobs, run: jobs[JOB_DISCOVERY]!.handler, runs, logs, recorded, enqueued, delivered };
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

describe("the Job Digest jobs", () => {
  it("look every hour for the Job Digests due, and run each one on its own", async () => {
    const due = [
      { candidateId: "candidate-1", profileId: "profile-1" },
      { candidateId: "candidate-2", profileId: "profile-2" },
    ];
    const { jobs, enqueued } = setup(undefined, [...due]);

    expect(jobs[JOB_DIGEST_SCHEDULE]?.cron).toBe("0 * * * *");
    await jobs[JOB_DIGEST_SCHEDULE]!.handler({});

    expect(enqueued).toEqual(due.map((data) => ({ name: JOB_DIGEST_RUN, data })));
  });

  it("search with the Profile's current Search Criteria, then deliver what was found", async () => {
    const { jobs, runs, delivered, logs } = setup(async () => ({ jobOffers: found, skipped: [] }));

    await jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(runs).toEqual([{ candidateId: "candidate-1", criteria }]);
    expect(delivered).toEqual([["candidate-1", "profile-1", ["offer-1", "offer-2"]]]);
    expect(logs).toEqual(["[job-digest] profile profile-1: 2 Job Offer(s) found, Job Digest sent"]);
  });

  it("do nothing for a Profile that is gone or archived, or a malformed job", async () => {
    const { jobs, runs, delivered } = setup();

    await jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "gone" });
    await jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "archived-1" });
    await jobs[JOB_DIGEST_RUN]!.handler({ profileId: 42 });

    expect(runs).toEqual([]);
    expect(delivered).toEqual([]);
  });
});

describe("the worker without an AI layer", () => {
  // The local docker-compose worker has no AI keys: it must still run its other jobs.
  it("keeps the heartbeat and skips Job discovery, saying why", async () => {
    const logs: string[] = [];
    const recorded: [string, JobSearchOutcome][] = [];
    const jobs = createJobs({
      database: noDatabase,
      discovery: { unavailable: "Missing environment variable PERPLEXITY_API_KEY" },
      profiles: { get: async () => ({ archived: false, searchCriteria: criteria }) },
      jobSearches: { record: async (id, outcome) => void recorded.push([id, outcome]) },
      jobDigests: noJobDigests,
      enqueue: async () => {},
      followUps: { proposeDue: async () => {} },
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

    await jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });
    expect(logs.at(-1)).toBe("[job-digest] profile profile-1: skipped, Job discovery is unavailable (Missing environment variable PERPLEXITY_API_KEY)");
  });
});

const otherDeps = {
  discovery: { unavailable: "not under test" },
  profiles: { get: async () => null },
  jobSearches: { record: async () => {} },
  jobDigests: noJobDigests,
  enqueue: async () => {},
  followUps: { proposeDue: async () => {} },
  log: () => {},
};

describe("the Follow-ups job", () => {
  it("proposes, every working morning, the Follow-ups now due", async () => {
    const runs: Date[] = [];
    const now = new Date("2026-11-12T06:00:00Z");
    const job = createJobs({ ...otherDeps, database: noDatabase, now: () => now, followUps: { proposeDue: async (at) => void runs.push(at) } })[FOLLOW_UPS];

    expect(job?.cron).toBe("0 6 * * 1-5");
    await job!.handler({});
    expect(runs).toEqual([now]);
  });
});

describe.skipIf(!connectionString)("worker jobs (needs Postgres: DATABASE_URL)", () => {
  let throwaway: Awaited<ReturnType<typeof createThrowawayDatabase>>;
  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_worker_jobs");
    await migrateJobOffers(throwaway.pool);
  });
  afterEach(async () => {
    await throwaway.drop();
  });

  it("forgets, every 15 minutes, the Job Offers Guests captured more than 23 hours ago (ADR-0003)", async () => {
    const jobOffers = createJobOffers(throwaway.pool);
    const captured = await jobOffers.capture({ title: "DAF", content: "Poste de DAF à Lyon." }, "guest");
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);

    const job = createJobs({ ...otherDeps, database: throwaway.pool, now: () => tomorrow })["guests.forget"];

    expect(job?.cron).toBe("*/15 * * * *");
    await job!.handler({});
    expect(await jobOffers.get(captured.ok ? captured.jobOffer.id : "")).toBeNull();
  });

  it("has nothing to forget before the web app has created its tables", async () => {
    const empty = await createThrowawayDatabase("test_worker_jobs_empty");
    try {
      await expect(createJobs({ ...otherDeps, database: empty.pool })["guests.forget"]!.handler({})).resolves.toBeUndefined();
    } finally {
      await empty.drop();
    }
  });
});

import { createProvenanceRecorder, type AiLayer } from "@jobhub/ai";
import type { MasterCvContent, ProvenanceEvent, SearchCriteria } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJobOffers, migrateJobOffers } from "@jobhub/web/job-offers";
import { createProfiles, migrateProfiles } from "@jobhub/web/profiles";
import { createApplications, migrateApplications } from "../../web/src/applications";
import { createCoachConversations, migrateCoachConversations } from "@jobhub/web/coach-conversations";
import { createBackOffice, migrateBackOfficeAudit } from "@jobhub/web/back-office";
import { createAssistantConversations, migrateAssistantConversations } from "@jobhub/web/back-office-assistant";
import { createBilling, migrateBilling, STARTING_PLAN_QUOTAS } from "@jobhub/web/billing";
import { createPostgresUsageLog, migrateAiUsage } from "@jobhub/web/ai-usage";
import { signInWithMagicLink, startTestAuth } from "../../web/src/auth/test-support";
import { createThrowawayDatabase } from "../../web/src/test-support/throwaway-database";
import { createGuardrailStore, migrateGuardrails } from "@jobhub/web/guardrails";
import { JobDiscoveryError, type DiscoverRequest, type DiscoveryReport } from "./job-discovery";
import type { JobSearchOutcome } from "@jobhub/web/job-searches";
import type { DueJobDigest, JobDigestResult } from "@jobhub/web/job-digests";
import { AI_USAGE_PURGE, APPOINTMENT_REMINDERS, BACK_OFFICE_ASSISTANT_PURGE, GUARDRAIL_TRIGGERS_PURGE, BACK_OFFICE_AUDIT_PURGE, COACH_CONVERSATIONS_PURGE, createJobs, PROVIDER_SECRETS_REENCRYPT, REFERENCE_DATA_REFRESH, FOLLOW_UPS, JOB_DIGEST_RUN, JOB_DIGEST_SCHEDULE, JOB_DISCOVERY, JOB_SEARCH_TIMEOUTS, SOURCE_RECHECK, type JobsDeps } from "./jobs";

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
  deliver: async () => ({ digest: null, discovery: "not_run" }),
};

const criteria: SearchCriteria = { targetRole: "Directeur financier", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

const found = [
  { id: "offer-1", source: {}, title: "DAF H/F", content: "DAF à Lyon." },
  { id: "offer-2", source: {}, title: "Directeur financier", content: "Directeur financier à Lyon." },
];

/** A run's recorder for a fake Job discovery: its steps are timed Tools and rules, no AI call. */
const runRecorder = (onEvent?: (event: ProvenanceEvent) => void) => createProvenanceRecorder({} as AiLayer, { onEvent });

/** What Job discovery reports: the Job Offers found, what it measured, and the run's steps. */
function discoveryReport(report: Partial<DiscoveryReport> = {}): DiscoveryReport {
  return {
    run: runRecorder(),
    jobOffers: [],
    skipped: [],
    funnel: { providerUrls: 0, fetched: 0, extracted: 0, alreadyStored: 0 },
    costEur: 0,
    franceTravail: { status: "off", offers: 0, calls: 0 },
    fantasticJobs: { status: "off", offers: 0, calls: 0, costEur: 0 },
    ...report,
  };
}

/** One Job Offer the Profile matches (its skill, in its town), one it does not. */
const strongMatch = { id: "offer-strong", source: {}, title: "Directrice financière", content: "DAF à Lyon, IFRS.", location: "Lyon", skills: ["IFRS"] };
const weakMatch = { id: "offer-weak", source: {}, title: "Développeur Java", content: "Java à Brest.", location: "Brest", skills: ["Java", "Kubernetes"], contractType: "freelance" as const };

/** A run that read 3 of 6 provider URLs, skipped 4 pages and kept 2 Job Offers, one of them from France Travail. */
const measuredRun = discoveryReport({
  jobOffers: [strongMatch, weakMatch],
  skipped: [
    { url: "https://fr.linkedin.com/jobs/1", reason: "site_terms" },
    { url: "https://emplois.example.fr/1", reason: "gone" },
    { url: "https://emplois.example.fr/2", reason: "gone" },
    { url: "https://emplois.example.fr/liste", reason: "not_a_job_offer" },
  ],
  funnel: { providerUrls: 6, fetched: 3, extracted: 2, alreadyStored: 1 },
  costEur: 0.0123,
  franceTravail: { status: "searched", offers: 1, calls: 2 },
  fantasticJobs: { status: "searched", offers: 3, calls: 1, costEur: 0.024 },
});

/** What the Job Search or Job Digest keeps of `measuredRun`. */
const measuredMetrics = {
  funnel: { providerUrls: 6, fetched: 3, extracted: 2, alreadyStored: 1, afterDedup: 2, matched: 1 },
  skipped: { robots: 0, site_terms: 1, bot_protection: 0, login_wall: 0, not_public: 0, gone: 2, unreachable: 0, not_a_job_offer: 1, invalid: 0, too_old: 0, site_disabled: 0 },
  costEur: 0.0123,
  franceTravail: { status: "searched", offers: 1, calls: 2 },
  fantasticJobs: { status: "searched", offers: 3, calls: 1, costEur: 0.024 },
};

/**
 * What the fake Job Digests module does with the Job discovery it is handed:
 * `true` runs it (the stored Job Offers were too few), `false` does not.
 */
type DigestPlan = { runsDiscovery: boolean };

function setup(
  discover?: (request: DiscoverRequest) => Promise<DiscoveryReport>,
  due: DueJobDigest[] = [],
  digestPlan: DigestPlan = { runsDiscovery: true },
  now?: () => Date,
  /** The Candidate asked to stop their Job Search (#331): `stopRequested` answers it. */
  stop: { requested: boolean } = { requested: false },
) {
  const runs: DiscoverRequest[] = [];
  const logs: string[] = [];
  const recorded: [string, JobSearchOutcome][] = [];
  /** Each write of a Job Search's live steps, and each outcome, in the order they came. */
  const written: string[] = [];
  const progressed: [string, ProvenanceEvent[]][] = [];
  const enqueued: { name: string; data: object }[] = [];
  /** Per delivery: the Candidate, the Profile, and what Job discovery gave the Job Digest (or how it failed). */
  const delivered: [string, string, string[] | string | null][] = [];
  const jobs = createJobs({
    database: noDatabase,
    discovery: {
      async discover(request): Promise<DiscoveryReport> {
        runs.push(request);
        if (discover) return discover(request);
        return discoveryReport({ skipped: [{ url: "https://fr.linkedin.com/jobs/1", reason: "site_terms" }] });
      },
    },
    jobSearches: {
      record: async (id, outcome) => {
        recorded.push([id, outcome]);
        written.push(`outcome ${id}`);
      },
      progress: async (id, steps) => {
        progressed.push([id, steps]);
        written.push(`progress ${id}`);
      },
      stopRequested: async () => stop.requested,
      expireTimedOut: async () => 0,
    },
    stopCheckMs: 5,
    followUps: { proposeDue: async () => {} },
    profiles: {
      async get(candidateId, profileId) {
        if (candidateId !== "candidate-1" || !["profile-1", "archived-1"].includes(profileId)) return null;
        return { archived: profileId === "archived-1", searchCriteria: criteria, masterCv: { content: masterCv } };
      },
    },
    jobDigests: {
      claimDue: async () => due.splice(0),
      async deliver(candidateId, profileId, discoverForDigest) {
        // One stored Job Offer qualified.
        const digest = { id: "digest-1", profile: { id: profileId, name: "DAF" }, sentAt: new Date(), results: [{} as JobDigestResult] };
        if (!digestPlan.runsDiscovery) {
          delivered.push([candidateId, profileId, null]);
          return { digest, discovery: "not_run" };
        }
        try {
          const found = await discoverForDigest();
          delivered.push([candidateId, profileId, found]);
          return { digest, discovery: "ran" };
        } catch (error) {
          delivered.push([candidateId, profileId, (error as Error).message]);
          return { digest, discovery: "failed" };
        }
      },
    },
    enqueue: async (name, data) => void enqueued.push({ name, data }),
    log: (line) => logs.push(line),
    now,
  });
  return { jobs, run: jobs[JOB_DISCOVERY]!.handler, runs, logs, recorded, written, progressed, enqueued, delivered };
}

describe("the Job discovery job", () => {
  it("searches with the Profile's current Search Criteria", async () => {
    const { run, runs, logs } = setup();

    await run({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(runs).toEqual([{ candidateId: "candidate-1", criteria, onEvent: undefined }]);
    expect(logs).toEqual(["[job-discovery] profile profile-1: 0 Job Offer(s), 1 page(s) skipped (site_terms: 1)"]);
  });

  it("logs France Travail's part when it is configured", async () => {
    const searched = setup(async () => discoveryReport({ jobOffers: found, franceTravail: { status: "searched", offers: 1, calls: 2 } }));
    const refused = setup(async () => discoveryReport({ franceTravail: { status: "refused", offers: 0, calls: 2 } }));

    await searched.run({ candidateId: "candidate-1", profileId: "profile-1" });
    await refused.run({ candidateId: "candidate-1", profileId: "profile-1" });

    expect([...searched.logs, ...refused.logs]).toEqual([
      "[job-discovery] profile profile-1: 2 Job Offer(s), 0 page(s) skipped, France Travail searched (1 Job Offer(s), 2 call(s))",
      "[job-discovery] profile profile-1: 0 Job Offer(s), 0 page(s) skipped, France Travail refused (0 Job Offer(s), 2 call(s))",
    ]);
  });

  it("logs Fantastic.jobs' part, with its estimated cost, when its key is set", async () => {
    const searched = setup(async () => discoveryReport({ jobOffers: found, fantasticJobs: { status: "searched", offers: 2, calls: 1, costEur: 0.016 } }));
    const refused = setup(async () => discoveryReport({ fantasticJobs: { status: "refused", offers: 0, calls: 1, costEur: 0 } }));

    await searched.run({ candidateId: "candidate-1", profileId: "profile-1" });
    await refused.run({ candidateId: "candidate-1", profileId: "profile-1" });

    expect([...searched.logs, ...refused.logs]).toEqual([
      "[job-discovery] profile profile-1: 2 Job Offer(s), 0 page(s) skipped, Fantastic.jobs searched (2 Job Offer(s), 1 call(s), €0.016)",
      "[job-discovery] profile profile-1: 0 Job Offer(s), 0 page(s) skipped, Fantastic.jobs refused (0 Job Offer(s), 1 call(s), €0)",
    ]);
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
    const { run, recorded } = setup(async () => discoveryReport({ jobOffers: found }));

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(recorded).toEqual([["search-1", expect.objectContaining({ jobOfferIds: ["offer-1", "offer-2"] })]]);
  });

  it("reports with them the funnel, the pages skipped by reason and the cost in €", async () => {
    const { run, recorded } = setup(async () => measuredRun);

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(recorded).toEqual([["search-1", { jobOfferIds: ["offer-strong", "offer-weak"], metrics: measuredMetrics, provenance: expect.any(Object) }]]);
  });

  it("counts in the funnel only the Job Offers with a Match Score of 60 or more against the Profile's Master CV", async () => {
    const { run, recorded } = setup(async () => discoveryReport({ jobOffers: [strongMatch, strongMatch, weakMatch, weakMatch].map((offer, i) => ({ ...offer, id: `offer-${i}` })) }));

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(recorded[0]![1]).toMatchObject({ metrics: { funnel: { afterDedup: 4, matched: 2 } } });
  });

  it("reports what Job discovery found and measured before it broke: its Job Offers are kept (#331)", async () => {
    const { run, recorded } = setup(async () => Promise.reject(new JobDiscoveryError(measuredRun, new Error("LLM down"))));

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(recorded).toEqual([
      ["search-1", { failed: "discovery_failed", jobOfferIds: ["offer-strong", "offer-weak"], metrics: measuredMetrics, provenance: expect.any(Object) }],
    ]);
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

describe("the Job discovery job, for a Job Search the Candidate started: its Provenance and live steps (#330)", () => {
  /** A Job discovery that searches France Travail, telling the request's sink, then reports. */
  const searchingFranceTravail = async (request: DiscoverRequest) => {
    const run = runRecorder(request.onEvent);
    await run.step({ tool: "france-travail" }, async () => []);
    return discoveryReport({ jobOffers: [strongMatch], run });
  };
  const subjects = (events: ProvenanceEvent[]) =>
    events.map(({ type, step }) => `${type} ${"tool" in step ? step.tool : "rule" in step ? step.rule : step.task}`);

  it("writes on the Job Search each step of the run as it starts and ends, its Match Scores too, the last before its outcome", async () => {
    const { run, progressed, written } = setup(searchingFranceTravail);

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(progressed.every(([id]) => id === "search-1")).toBe(true);
    expect(subjects(progressed.at(-1)![1])).toEqual(["step_ended france-travail", "step_ended match_score"]);
    expect(written.at(-1)).toBe("outcome search-1");
  });

  it("keeps with the Job Search the run's Provenance: its steps, its Match Scores included", async () => {
    const { run, recorded } = setup(searchingFranceTravail);

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    const { provenance } = recorded[0]![1];
    expect(provenance?.steps).toMatchObject([
      { kind: "tool", tool: "france-travail", outcome: "ok" },
      { kind: "rules", rule: "match_score", outcome: "ok" },
    ]);
  });

  it("keeps with a failed Job Search the Provenance of the steps it ran", async () => {
    const { run, recorded } = setup(async (request) => {
      const partial = await searchingFranceTravail(request);
      await partial.run.step({ tool: "job-site" }, () => Promise.reject(new Error("timeout"))).catch(() => undefined);
      throw new JobDiscoveryError(partial, new Error("LLM down"));
    });

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(recorded[0]![1]).toMatchObject({ failed: "discovery_failed" });
    expect(recorded[0]![1].provenance?.steps).toMatchObject([
      { kind: "tool", tool: "france-travail", outcome: "ok" },
      { kind: "tool", tool: "job-site", outcome: "failed" },
      { kind: "rules", rule: "match_score" },
    ]);
  });

  it("writes no live steps for a run no Candidate is waiting on", async () => {
    const { run, runs, progressed } = setup(searchingFranceTravail);

    await run({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(runs[0]!.onEvent).toBeUndefined();
    expect(progressed).toEqual([]);
  });
});

describe("the Job discovery job, for a Job Search the Candidate stops (#331)", () => {
  /** A Job discovery that searches France Travail, then searches the web until its signal aborts, then reports what it found. */
  const searchingUntilStopped = async (request: DiscoverRequest) => {
    const run = runRecorder(request.onEvent);
    await run.step({ tool: "france-travail" }, async () => []);
    await run.step({ tool: "job-site" }, () => new Promise<void>((resolve) => request.signal?.addEventListener("abort", () => resolve())));
    return discoveryReport({ jobOffers: [strongMatch], run });
  };

  it("stops the run once the Candidate asks, and records the Job Search stopped, with the Job Offers found and the steps it finished", async () => {
    const stop = { requested: false };
    const { run, recorded, runs } = setup(searchingUntilStopped, [], undefined, undefined, stop);

    const running = run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    stop.requested = true;
    await running;

    expect(runs[0]!.signal?.aborted).toBe(true);
    expect(recorded).toEqual([["search-1", { stopped: true, jobOfferIds: ["offer-strong"], metrics: expect.any(Object), provenance: expect.any(Object) }]]);
    expect(recorded[0]![1].provenance?.steps).toMatchObject([
      { kind: "tool", tool: "france-travail", outcome: "ok" },
      { kind: "tool", tool: "job-site", outcome: "ok" },
      { kind: "rules", rule: "match_score", outcome: "ok" },
    ]);
  });

  it("records it stopped, not failed, when the stop made Job discovery break", async () => {
    const stop = { requested: false };
    const { run, recorded, runs } = setup(
      async (request) => {
        await new Promise((resolve) => request.signal?.addEventListener("abort", resolve));
        throw new JobDiscoveryError(discoveryReport({ jobOffers: [strongMatch] }), request.signal?.reason);
      },
      [],
      undefined,
      undefined,
      stop,
    );

    const running = run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    stop.requested = true;
    await running;

    expect(recorded).toEqual([["search-1", expect.objectContaining({ stopped: true, jobOfferIds: ["offer-strong"] })]]);
  });

  it("does not run Job discovery for a Job Search stopped before the worker began it: it is recorded stopped, with nothing found", async () => {
    const { run, recorded, runs } = setup(searchingUntilStopped, [], undefined, undefined, { requested: true });

    await run({ candidateId: "candidate-1", profileId: "profile-1", jobSearchId: "search-1" });

    expect(runs).toEqual([]);
    expect(recorded).toEqual([["search-1", { stopped: true, jobOfferIds: [] }]]);
  });

  it("gives no stop to a run no Candidate is waiting on", async () => {
    const { run, runs } = setup();

    await run({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(runs[0]!.signal).toBeUndefined();
  });
});

describe("the Job Digest jobs", () => {
  it("look, every day at 07:00 Europe/Paris, for the Job Digests due, and run each one on its own", async () => {
    const due = [
      { candidateId: "candidate-1", profileId: "profile-1" },
      { candidateId: "candidate-2", profileId: "profile-2" },
    ];
    const { jobs, enqueued } = setup(undefined, [...due]);

    expect(jobs[JOB_DIGEST_SCHEDULE]).toMatchObject({ cron: "0 7 * * *", tz: "Europe/Paris" });
    await jobs[JOB_DIGEST_SCHEDULE]!.handler({});

    expect(enqueued).toEqual(due.map((data) => ({ name: JOB_DIGEST_RUN, data })));
  });

  it("hand the Job Digest a Job discovery on the Profile's current Search Criteria, run only if it asks", async () => {
    const asked = setup(async () => discoveryReport({ jobOffers: found }));
    await asked.jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });
    expect(asked.runs).toEqual([{ candidateId: "candidate-1", criteria }]);
    expect(asked.delivered).toEqual([["candidate-1", "profile-1", ["offer-1", "offer-2"]]]);
    expect(asked.logs[0]).toBe("[job-digest] profile profile-1: Job Digest sent (1 Job Offer(s)), Job discovery ran");

    const enough = setup(async () => discoveryReport({ jobOffers: found }), [], { runsDiscovery: false });
    await enough.jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });
    expect(enough.runs).toEqual([]);
    expect(enough.delivered).toEqual([["candidate-1", "profile-1", null]]);
    expect(enough.logs[0]).toBe("[job-digest] profile profile-1: Job Digest sent (1 Job Offer(s)), Job discovery not needed");
  });

  it("let a failed Job discovery fail without retrying: the Job Digest sends what it has", async () => {
    const { jobs, delivered, logs } = setup(async () => Promise.reject(new Error("Perplexity answered 503")));

    await expect(jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" })).resolves.toBeUndefined();

    expect(delivered).toEqual([["candidate-1", "profile-1", "Perplexity answered 503"]]);
    expect(logs[0]).toBe("[job-digest] profile profile-1: Job Digest sent (1 Job Offer(s)), Job discovery failed");
  });

  it("log a record of each run with the same metrics as a Job Search, and how long it took", async () => {
    let clock = Date.parse("2026-10-12T05:00:00Z");
    const tick = () => new Date((clock += 1500) - 1500);
    const { jobs, logs } = setup(async () => measuredRun, [], { runsDiscovery: true }, tick);

    await jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(logs.slice(1).map((line) => JSON.parse(line))).toEqual([
      { event: "job_digest_run", profileId: "profile-1", discovery: "ran", sent: 1, metrics: { ...measuredMetrics, durationMs: 1500 } },
    ]);
  });

  it("log a run where Job discovery was not needed or broke, with what it measured", async () => {
    const enough = setup(async () => measuredRun, [], { runsDiscovery: false });
    await enough.jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });
    expect(JSON.parse(enough.logs[1]!)).toMatchObject({
      discovery: "not_run",
      metrics: { funnel: { providerUrls: 0, afterDedup: 0, matched: 0 }, skipped: { gone: 0 }, costEur: 0 },
    });

    const broke = setup(async () => Promise.reject(new JobDiscoveryError(measuredRun, new Error("LLM down"))));
    await broke.jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });
    expect(JSON.parse(broke.logs[1]!)).toMatchObject({ discovery: "failed", metrics: measuredMetrics });
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
      profiles: { get: async () => ({ archived: false, searchCriteria: criteria, masterCv: { content: masterCv } }) },
      jobSearches: { record: async (id, outcome) => void recorded.push([id, outcome]), progress: async () => {}, stopRequested: async () => false, expireTimedOut: async () => 0 },
      followUps: { proposeDue: async () => {} },
      jobDigests: {
        claimDue: async () => [],
        async deliver(_candidateId, _profileId, discover) {
          await expect(discover()).rejects.toThrow("Job discovery is unavailable (Missing environment variable PERPLEXITY_API_KEY)");
          return { digest: { id: "digest-1", profile: { id: "profile-1", name: "DAF" }, sentAt: new Date(), results: [{} as JobDigestResult] }, discovery: "failed" };
        },
      },
      enqueue: async () => {},
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

    // A Job Digest still sends what the stored Job Offers give.
    await jobs[JOB_DIGEST_RUN]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });
    expect(logs.at(-2)).toBe("[job-digest] profile profile-1: Job Digest sent (1 Job Offer(s)), Job discovery failed");
  });
});

describe("Job discovery asked for on each job (#208)", () => {
  it("runs once its keys appear, without a restart: the getter is asked again on each job", async () => {
    const logs: string[] = [];
    let current: Exclude<JobsDeps["discovery"], () => unknown> = { unavailable: "Missing environment variable MISTRAL_API_KEY" };
    const discover = vi.fn(async () => discoveryReport());
    const jobs = createJobs({
      ...otherDeps,
      database: noDatabase,
      discovery: () => current,
      profiles: { get: async () => ({ archived: false, searchCriteria: criteria, masterCv: { content: masterCv } }) },
      log: (line) => logs.push(line),
    });

    await jobs[JOB_DISCOVERY]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });
    current = { discover } as never;
    await jobs[JOB_DISCOVERY]!.handler({ candidateId: "candidate-1", profileId: "profile-1" });

    expect(logs[0]).toContain("skipped, Job discovery is unavailable (Missing environment variable MISTRAL_API_KEY)");
    expect(discover).toHaveBeenCalledTimes(1);
  });
});

const otherDeps = {
  discovery: { unavailable: "not under test" },
  profiles: { get: async () => null },
  jobSearches: { record: async () => {}, progress: async () => {}, stopRequested: async () => false, expireTimedOut: async () => 0 },
  followUps: { proposeDue: async () => {} },
  jobDigests: noJobDigests,
  enqueue: async () => {},
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

describe("the Appointment Reminders job", () => {
  it("emails, every day at 18:00 French time, the Appointment Reminders due, saying how many", async () => {
    const logs: string[] = [];
    const sendDue = vi.fn(async () => ({ emails: 2, items: 3, failed: 0 }));
    const job = createJobs({ ...otherDeps, database: noDatabase, appointmentReminders: { sendDue }, log: (line) => logs.push(line) })[APPOINTMENT_REMINDERS]!;

    expect(job).toMatchObject({ cron: "0 18 * * *", tz: "Europe/Paris" });
    await job.handler({});
    sendDue.mockResolvedValueOnce({ emails: 1, items: 1, failed: 1 });
    await job.handler({});

    expect(sendDue).toHaveBeenCalledTimes(2);
    expect(logs).toEqual([
      "[appointment-reminders] 2 Appointment Reminder(s) sent, for 3 Agenda Item(s)",
      "[appointment-reminders] 1 Appointment Reminder(s) sent, for 1 Agenda Item(s); 1 could not be sent, left to the next run",
    ]);
  });

  it("does nothing without Appointment Reminders, or before the web app has created their tables", async () => {
    await expect(createJobs({ ...otherDeps, database: noDatabase })[APPOINTMENT_REMINDERS]!.handler({})).resolves.toBeUndefined();
    const missingTable = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    const sendDue = vi.fn(async () => Promise.reject(missingTable));
    await expect(createJobs({ ...otherDeps, database: noDatabase, appointmentReminders: { sendDue } })[APPOINTMENT_REMINDERS]!.handler({})).resolves.toBeUndefined();
  });
});

describe("the Provider Secrets re-encryption job", () => {
  it("re-encrypts, every night and when asked, the Provider Secrets not under the newest master key, saying how many", async () => {
    const logs: string[] = [];
    const reencrypt = vi.fn(async () => 2);
    const job = createJobs({ ...otherDeps, database: noDatabase, providerSecrets: { reencrypt }, log: (line) => logs.push(line) })[PROVIDER_SECRETS_REENCRYPT]!;

    expect(job.cron).toBe("15 4 * * *");
    await job.handler({});

    expect(reencrypt).toHaveBeenCalledTimes(1);
    expect(logs).toEqual(["[provider-secrets] 2 Provider Secret(s) re-encrypted under the newest master key"]);
  });

  it("does nothing without Provider Secrets, or before the web app has created their table", async () => {
    await expect(createJobs({ ...otherDeps, database: noDatabase })[PROVIDER_SECRETS_REENCRYPT]!.handler({})).resolves.toBeUndefined();
    const missingTable = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    const reencrypt = vi.fn(async () => Promise.reject(missingTable));
    await expect(createJobs({ ...otherDeps, database: noDatabase, providerSecrets: { reencrypt } })[PROVIDER_SECRETS_REENCRYPT]!.handler({})).resolves.toBeUndefined();
  });
});

describe("the reference data refresh job (#236)", () => {
  it("asks INSEE and France Travail again for the Sectors', Subsectors' and Domains' labels once a month, saying how each went", async () => {
    const logs: string[] = [];
    const refresh = vi.fn(async () => ({ naf: "refreshed" as const, romeDomains: { failed: "api.francetravail.fr answered 503" } }));
    const job = createJobs({ ...otherDeps, database: noDatabase, referenceData: { refresh }, log: (line) => logs.push(line) })[REFERENCE_DATA_REFRESH]!;

    expect(job.cron).toBe("0 5 2 * *");
    await job.handler({});

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(logs).toEqual(["[reference-data] naf: refreshed, romeDomains: failed (api.francetravail.fr answered 503), its labels kept"]);
  });

  it("does nothing without reference data, or before the web app has created its table", async () => {
    await expect(createJobs({ ...otherDeps, database: noDatabase })[REFERENCE_DATA_REFRESH]!.handler({})).resolves.toBeUndefined();
    const missingTable = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    const refresh = vi.fn(async () => Promise.reject(missingTable));
    await expect(createJobs({ ...otherDeps, database: noDatabase, referenceData: { refresh } })[REFERENCE_DATA_REFRESH]!.handler({})).resolves.toBeUndefined();
  });
});

describe("the Job Search timeouts job", () => {
  it("fails, every 5 minutes, the Job Searches the worker never answered, so they give their use back", async () => {
    let expired = 0;
    const logs: string[] = [];
    const job = createJobs({
      ...otherDeps,
      database: noDatabase,
      jobSearches: { record: async () => {}, progress: async () => {}, stopRequested: async () => false, expireTimedOut: async () => ++expired },
      log: (line) => void logs.push(line),
    })[JOB_SEARCH_TIMEOUTS];

    expect(job?.cron).toBe("*/5 * * * *");
    await job!.handler({});
    expect(expired).toBe(1);
    expect(logs).toEqual(["[job-searches] 1 Job Search(es) timed out, their use given back"]);
  });

  it("has nothing to expire before the web app has created its tables", async () => {
    const job = createJobs({
      ...otherDeps,
      database: noDatabase,
      jobSearches: { record: async () => {}, progress: async () => {}, stopRequested: async () => false, expireTimedOut: async () => Promise.reject(Object.assign(new Error("no table"), { code: "42P01" })) },
    })[JOB_SEARCH_TIMEOUTS];

    await expect(job!.handler({})).resolves.toBeUndefined();
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

  it("re-checks every day the Job Offers Candidates are applying to, and expires those gone at their source twice in a row", async () => {
    // Applications need Candidates: a database with the Candidate accounts too.
    const testAuth = await startTestAuth();
    try {
      const database = testAuth.database;
      await migrateProfiles(database);
      await migrateJobOffers(database);
      await migrateApplications(database);
      const jobOffers = createJobOffers(database);
      const profiles = createProfiles(database);
      const applications = createApplications(database, { jobOffers, profiles });
      const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      const session = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as { user: { id: string } };
      const candidateId = session.user.id;
      const profile = await profiles.create(candidateId, { masterCv, searchCriteria: criteria });
      const followed = await jobOffers.capture({ source: { url: "https://emploi.example.fr/offres/daf" }, title: "DAF", content: "Poste de DAF à Lyon." });
      const unfollowed = await jobOffers.capture({ source: { url: "https://emploi.example.fr/offres/autre" }, title: "DAF", content: "Autre poste de DAF." });
      if (!profile.ok || !followed.ok || !unfollowed.ok) throw new Error("fixture refused");
      const saved = await applications.save(candidateId, { jobOfferId: followed.jobOffer.id, profileId: profile.profile.id });
      if (!saved.ok) throw new Error("fixture Application refused");
      const id = followed.jobOffer.id;

      const requested: string[] = [];
      const fetch = (async (input: string) => {
        requested.push(String(input));
        return String(input).endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response("", { status: 410 });
      }) as typeof globalThis.fetch;
      const logs: string[] = [];
      const jobAt = (days: number) => {
        const at = new Date(Date.now() + days * 86_400_000);
        return { at, job: createJobs({ ...otherDeps, database, now: () => at, fetch, log: (line) => logs.push(line) })[SOURCE_RECHECK]! };
      };

      const first = jobAt(4);
      expect(first.job.cron).toBe("0 4 * * *");
      await first.job.handler({});
      expect(await jobOffers.get(id)).not.toHaveProperty("expiredAt");

      const second = jobAt(7.5);
      await second.job.handler({});
      expect(await jobOffers.get(id)).toMatchObject({ expiredAt: second.at });

      expect(logs).toEqual([
        "[source-recheck] 1 Job Offer(s) re-checked, 1 gone, 0 expired, 0 unread",
        "[source-recheck] 1 Job Offer(s) re-checked, 1 gone, 1 expired, 0 unread",
      ]);
      expect(requested).not.toContain("https://emploi.example.fr/offres/autre");
      expect(await jobOffers.get(unfollowed.jobOffer.id)).not.toHaveProperty("expiredAt");
    } finally {
      await testAuth.stop();
    }
  });

  it("purges, every night, the Coach Conversations whose last message is 12 months old", async () => {
    const testAuth = await startTestAuth();
    try {
      const database = testAuth.database;
      await migrateProfiles(database);
      await migrateJobOffers(database);
      await migrateApplications(database);
      await migrateCoachConversations(database);
      const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
      const session = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as { user: { id: string } };
      const conversations = createCoachConversations(database, {
        coach: {
          reply: async () => ({
            ok: true,
            reply: "Bonjour Marie",
            outcome: "replied",
            cost: { provider: "mistral", model: "mistral-large-latest", inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, eur: 0.0001 },
            provenance: { v: 1, steps: [], sites: [], startedAt: "2026-10-13T08:00:00.000Z", wallMs: 0 },
            playbooks: [],
            consultations: [],
          }),
        },
        profiles: createProfiles(database),
      });
      const sent = await conversations.send(session.user.id, { message: "Bonjour" });
      if (!sent.ok) throw new Error("fixture refused");
      const logs: string[] = [];
      const jobAt = (days: number) =>
        createJobs({ ...otherDeps, database, now: () => new Date(Date.now() + days * 86_400_000), log: (line) => logs.push(line) })[COACH_CONVERSATIONS_PURGE]!;

      expect(jobAt(0).cron).toBe("30 3 * * *");
      await jobAt(360).handler({});
      expect(await conversations.open(session.user.id, sent.conversation.id)).not.toBeNull();

      await jobAt(370).handler({});
      expect(await conversations.open(session.user.id, sent.conversation.id)).toBeNull();
      expect(logs).toEqual(["[coach-conversations] 1 Coach Conversation(s) purged, 12 months after their last message"]);
    } finally {
      await testAuth.stop();
    }
  });

  it("purges, every night, the Back Office Assistant conversations whose last message is 12 months old", async () => {
    const testAuth = await startTestAuth();
    try {
      const database = testAuth.database;
      await migrateAssistantConversations(database);
      const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
      const session = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as { user: { id: string } };
      const conversations = createAssistantConversations(database, {
        assistant: {
          reply: async () => ({
            ok: true,
            reply: "Bonjour Claire",
            outcome: "replied",
            cost: { provider: "mistral", model: "mistral-large-latest", inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, eur: 0.0001 },
            sections: ["planQuotas"],
            provenance: { v: 1, steps: [], sites: [], startedAt: "2026-10-13T08:00:00.000Z", wallMs: 0 },
          }),
        },
      });
      const sent = await conversations.send({ id: session.user.id, access: { roles: ["support"], can: () => true } }, { message: "Bonjour" });
      if (!sent.ok) throw new Error("fixture refused");
      const logs: string[] = [];
      const jobAt = (days: number) =>
        createJobs({ ...otherDeps, database, now: () => new Date(Date.now() + days * 86_400_000), log: (line) => logs.push(line) })[BACK_OFFICE_ASSISTANT_PURGE]!;

      expect(jobAt(0).cron).toBe("35 3 * * *");
      await jobAt(360).handler({});
      expect(await conversations.open(session.user.id, sent.conversation.id)).not.toBeNull();

      await jobAt(370).handler({});
      expect(await conversations.open(session.user.id, sent.conversation.id)).toBeNull();
      expect(logs).toEqual(["[back-office-assistant] 1 Back Office Assistant conversation(s) purged, 12 months after their last message"]);
    } finally {
      await testAuth.stop();
    }
  });

  it("has no Back Office Assistant conversation to purge before the web app has created its tables", async () => {
    const empty = await createThrowawayDatabase("test_worker_jobs_empty");
    try {
      await expect(createJobs({ ...otherDeps, database: empty.pool })[BACK_OFFICE_ASSISTANT_PURGE]!.handler({})).resolves.toBeUndefined();
    } finally {
      await empty.drop();
    }
  });

  it("purges, every night, the Back Office Audit entries 3 years old", async () => {
    const testAuth = await startTestAuth();
    try {
      const database = testAuth.database;
      await migrateBilling(database);
      await migrateBackOfficeAudit(database);
      const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
      const session = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()) as { user: { id: string; email: string } };
      const unused = async () => {
        throw new Error("not under test");
      };
      const backOffice = createBackOffice(database, { billing: createBilling({ database, baseURL: "http://localhost:3000" }), humanCoaches: { add: unused, retire: unused } });
      await backOffice.setPlanQuotas(session.user, "free", { ...STARTING_PLAN_QUOTAS.free, matchScores: 4 });
      const logs: string[] = [];
      const jobAt = (days: number) =>
        createJobs({ ...otherDeps, database, now: () => new Date(Date.now() + days * 86_400_000), log: (line) => logs.push(line) })[BACK_OFFICE_AUDIT_PURGE]!;

      expect(jobAt(0).cron).toBe("45 3 * * *");
      await jobAt(3 * 365 - 5).handler({});
      expect(await backOffice.journal()).toHaveLength(1);

      await jobAt(3 * 365 + 5).handler({});
      expect(await backOffice.journal()).toEqual([]);
      expect(logs).toEqual(["[back-office-audit] 1 Back Office Audit entry(ies) purged, 3 years after they were made"]);
    } finally {
      await testAuth.stop();
    }
  });

  it("purges, every night, the AI Message Log 30 days old and the AI Usage 24 months old", async () => {
    const testAuth = await startTestAuth();
    try {
      const database = testAuth.database;
      await migrateAiUsage(database);
      const usage = createPostgresUsageLog(database);
      const call = { candidateId: null, task: "scoring" as const, provider: "mistral" as const, endpoint: "fake", model: "m", inputTokens: 1, outputTokens: 1, outcome: "ok" as const, sent: true, durationMs: 1, costEur: 0, tools: [] };
      await usage.record({ ...call, transcript: { messages: [{ role: "user", content: "Score" }], reply: "82" }, at: new Date() });
      const logs: string[] = [];
      const jobAt = (days: number) => createJobs({ ...otherDeps, database, now: () => new Date(Date.now() + days * 86_400_000), log: (line) => logs.push(line) })[AI_USAGE_PURGE]!;
      const counted = async () => (await database.query<{ usage: number; logs: number }>(`SELECT (SELECT count(*) FROM ai_usage)::int AS usage, (SELECT count(*) FROM ai_message_log)::int AS logs`)).rows[0];

      expect(jobAt(0).cron).toBe("50 3 * * *");
      await jobAt(29).handler({});
      expect(await counted()).toEqual({ usage: 1, logs: 1 });

      await jobAt(31).handler({});
      expect(await counted()).toEqual({ usage: 1, logs: 0 });

      await jobAt(2 * 366).handler({});
      expect(await counted()).toEqual({ usage: 0, logs: 0 });
      expect(logs).toEqual([
        "[ai-usage] 1 AI Message Log(s) purged after 30 days, 0 AI call(s) and 0 external API call(s) after 24 months",
        "[ai-usage] 0 AI Message Log(s) purged after 30 days, 1 AI call(s) and 0 external API call(s) after 24 months",
      ]);
    } finally {
      await testAuth.stop();
    }
  });

  it("has no AI Usage to purge before the web app has created its tables", async () => {
    const empty = await createThrowawayDatabase("test_worker_jobs_empty");
    try {
      await expect(createJobs({ ...otherDeps, database: empty.pool })[AI_USAGE_PURGE]!.handler({})).resolves.toBeUndefined();
    } finally {
      await empty.drop();
    }
  });

  it("purges, every night, the Guardrail Triggers 24 months old (#228)", async () => {
    const throwaway = await createThrowawayDatabase("test_worker_jobs_guardrails");
    try {
      const database = throwaway.pool;
      await migrateGuardrails(database);
      await createGuardrailStore(database, { serving: "latest" }).triggers.record({ guardrail: "distress", setting: "block", action: "blocked", agent: "ai_coach", at: new Date() });
      const logs: string[] = [];
      const jobAt = (days: number) =>
        createJobs({ ...otherDeps, database, now: () => new Date(Date.now() + days * 86_400_000), log: (line) => logs.push(line) })[GUARDRAIL_TRIGGERS_PURGE]!;
      const counted = async () => (await database.query<{ n: number }>("SELECT count(*)::int AS n FROM guardrail_trigger")).rows[0]!.n;

      expect(jobAt(0).cron).toBe("55 3 * * *");
      await jobAt(365).handler({});
      expect(await counted()).toBe(1);
      await jobAt(2 * 366).handler({});
      expect(await counted()).toBe(0);
      expect(logs).toEqual(["[guardrails] 1 Guardrail Trigger(s) purged, 24 months after they were recorded"]);
      await expect(createJobs({ ...otherDeps, database: (await createThrowawayDatabase("test_worker_jobs_empty")).pool })[GUARDRAIL_TRIGGERS_PURGE]!.handler({})).resolves.toBeUndefined();
    } finally {
      await throwaway.drop();
    }
  });

  it("has no Back Office Audit to purge before the web app has created its tables", async () => {
    const empty = await createThrowawayDatabase("test_worker_jobs_empty");
    try {
      await expect(createJobs({ ...otherDeps, database: empty.pool })[BACK_OFFICE_AUDIT_PURGE]!.handler({})).resolves.toBeUndefined();
    } finally {
      await empty.drop();
    }
  });

  it("has nothing to purge before the web app has created its tables", async () => {
    const empty = await createThrowawayDatabase("test_worker_jobs_empty");
    try {
      await expect(createJobs({ ...otherDeps, database: empty.pool })[COACH_CONVERSATIONS_PURGE]!.handler({})).resolves.toBeUndefined();
    } finally {
      await empty.drop();
    }
  });

  it("has nothing to re-check before the web app has created its tables", async () => {
    const empty = await createThrowawayDatabase("test_worker_jobs_empty");
    try {
      await expect(createJobs({ ...otherDeps, database: empty.pool })[SOURCE_RECHECK]!.handler({})).resolves.toBeUndefined();
    } finally {
      await empty.drop();
    }
  });
});

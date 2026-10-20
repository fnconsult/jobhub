import type { SearchCriteria } from "@jobhub/shared";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFantasticJobs, fantasticJobsFromEnv } from "./index";

// A real `active-ats` answer captured on 2026-10-20 (#243): 3 jobs, its `ai_hiring_manager_*` cleared.
const ACTIVE_ATS = readFileSync(new URL("../fixtures/fantastic-jobs/active-ats.json", import.meta.url), "utf8");

const NOW = new Date("2026-10-20T12:00:00Z");

const criteria: SearchCriteria = { targetRole: "Chef de projet", locations: ["Paris"], contractTypes: [], remoteWorkOptions: [] };

interface Answer {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

/** Fantastic.jobs as the adapter sees it: its `active-ats` endpoint, and the requests made to it. */
function fakeFantasticJobs(answer: Answer | (() => Answer) = {}) {
  const requests: { url: URL; headers: Headers }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    requests.push({ url, headers: new Headers(init?.headers) });
    const given = typeof answer === "function" ? answer() : answer;
    if (given.status === 0) throw new TypeError("fetch failed");
    return new Response(given.body ?? ACTIVE_ATS, { status: given.status ?? 200, headers: { "content-type": "application/json", ...given.headers } });
  };
  const request = () => {
    const [first] = requests;
    if (!first) throw new Error("no request was made");
    return first;
  };
  return { fetch: fetch as typeof globalThis.fetch, requests, request };
}

function setup(answer?: Answer | (() => Answer), options: { eurPerJob?: number; maxPerSearch?: number } = {}) {
  const api = fakeFantasticJobs(answer);
  const fantasticJobs = createFantasticJobs({ apiKey: "fj-key", fetch: api.fetch, ...options });
  return { api, fantasticJobs };
}

describe("Fantastic.jobs search", () => {
  it("asks its active-ats endpoint with the API key as a bearer token", async () => {
    const { api, fantasticJobs } = setup();

    const result = await fantasticJobs.search(criteria, { max: 30, now: NOW });

    expect(result.calls).toBe(1);
    const { url, headers } = api.request();
    expect(url.origin + url.pathname).toBe("https://data.fantastic.jobs/v1/active-ats");
    expect(headers.get("authorization")).toBe("Bearer fj-key");
  });

  it("searches the title near the location, posted in the last 30 days, with descriptions, for no more jobs than wanted", async () => {
    const { api, fantasticJobs } = setup();

    await fantasticJobs.search(criteria, { max: 8, now: NOW });

    expect(Object.fromEntries(api.request().url.searchParams)).toEqual({
      title: "Chef de projet",
      location: "Paris",
      time_frame: "6m",
      date_posted_gte: "2026-09-20T12:00:00Z",
      description_format: "text",
      limit: "8",
    });
  });

  it("asks for no more than 10 jobs a search by default, however many are wanted, so a trial's credits last ~50 searches", async () => {
    const { api, fantasticJobs } = setup();

    await fantasticJobs.search(criteria, { max: 30, now: NOW });

    expect(api.request().url.searchParams.get("limit")).toBe("10");
  });

  it("asks for no more jobs a search than its set maximum", async () => {
    const { api, fantasticJobs } = setup({}, { maxPerSearch: 4 });

    await fantasticJobs.search(criteria, { max: 30, now: NOW });
    await fantasticJobs.search(criteria, { max: 2, now: NOW });

    expect(api.requests.map((request) => request.url.searchParams.get("limit"))).toEqual(["4", "2"]);
  });

  it("searches one of several locations at a time, and France when the Search Criteria name none", async () => {
    const { api, fantasticJobs } = setup();

    await fantasticJobs.search({ ...criteria, locations: ["Paris", "Lyon"] }, { max: 10, now: NOW, location: "Lyon" });
    await fantasticJobs.search({ ...criteria, locations: [] }, { max: 10, now: NOW });

    expect(api.requests.map((request) => request.url.searchParams.get("location"))).toEqual(["Lyon", "France"]);
  });

  it("reads each job as a posting at its ATS page, dated by its posting, with what the answer states of it", async () => {
    const { fantasticJobs } = setup();

    const result = await fantasticJobs.search(criteria, { max: 30, now: NOW });

    if (!result.ok) throw new Error(result.detail);
    expect(result.offers.map((offer) => offer.url)).toEqual([
      "https://jobs.smartrecruiters.com/BIOGARAN/744000156514679-chef-de-projet-assurance-qualite-systeme-f-h-",
      "https://recrutement.ividata.com/jobs/8574590-consultant-freelance-chef-de-projet-cmc-capex-h-f",
      "https://jobs.workable.com/view/aCUfnyk6GG7RAz1pyEnWpe/cdd---chef-de-projet-marketing-junior-(h%2Ff)-in-paris-at-s%C3%A9zane",
    ]);
    const [biogaran, ividata, sezane] = result.offers.map((offer) => offer.details);
    expect(biogaran).toMatchObject({
      title: "Chef de projet Assurance Qualité Système (F/H)",
      employer: "BIOGARAN",
      location: "Colombes, Ile-de-France, France",
      contractType: "cdd",
      remoteWork: "on_site",
      requiredExperienceYears: 5,
      postedAt: new Date("2026-10-20T09:53:29.286Z"),
    });
    expect(biogaran?.content).toContain("Au sein du Département Assurance Qualité Systèmes");
    expect(biogaran?.skills).toContain("Quality Management Systems");
    expect(ividata).toMatchObject({ employer: "Ividata Life Sciences", location: "Paris, Ile-de-France, France", postedAt: new Date("2026-10-20T09:25:09Z") });
    expect(ividata?.contractType).toBeUndefined();
    expect(sezane).toMatchObject({ contractType: "cdd", requiredExperienceYears: 0 });
  });

  it("never keeps the hiring manager's name or email (GDPR minimisation)", async () => {
    const jobs = JSON.parse(ACTIVE_ATS) as Record<string, unknown>[];
    const withManager = jobs.map((job) => ({ ...job, ai_hiring_manager_name: "Jeanne Martin", ai_hiring_manager_email_address: "jeanne.martin@example.com" }));
    const { fantasticJobs } = setup({ body: JSON.stringify(withManager) });

    const result = await fantasticJobs.search(criteria, { max: 30, now: NOW });

    expect(JSON.stringify(result)).not.toMatch(/Jeanne|jeanne\.martin/);
  });

  it("states the estimated cost of the jobs it returned, by the count Fantastic.jobs charges", async () => {
    const counted = setup({ headers: { "x-api-jobs-this-request": "3" } }, { eurPerJob: 0.01 });
    const uncounted = setup({}, { eurPerJob: 0.01 });

    const charged = await counted.fantasticJobs.search(criteria, { max: 30, now: NOW });
    const unstated = await uncounted.fantasticJobs.search(criteria, { max: 30, now: NOW });

    expect(charged).toMatchObject({ ok: true, costEur: 0.03 });
    // Without the header, every job returned is charged.
    expect(unstated).toMatchObject({ ok: true, costEur: 0.03 });
  });

  it("gives no offer when Fantastic.jobs has none", async () => {
    const { fantasticJobs } = setup({ body: "[]" });

    expect(await fantasticJobs.search(criteria, { max: 30, now: NOW })).toEqual({ ok: true, offers: [], calls: 1, costEur: 0 });
  });

  describe("quota guard: once a quota is spent, no call is made until it is renewed", () => {
    const LATER = new Date("2026-10-20T13:00:00Z");
    const spent = (headers: Record<string, string>) => {
      let n = 0;
      return setup(() => (n++ === 0 ? { headers } : {}));
    };

    it.each([
      ["its Jobs credits", { "x-api-jobs-remaining": "0", "x-api-requests-remaining": "40" }],
      ["its API requests", { "x-api-jobs-remaining": "300", "x-api-requests-remaining": "0" }],
    ])("is refused without a call once an answer says %s are spent", async (_, headers) => {
      const { api, fantasticJobs } = spent(headers);

      expect(await fantasticJobs.search(criteria, { max: 30, now: NOW })).toMatchObject({ ok: true });
      expect(await fantasticJobs.search(criteria, { max: 30, now: LATER })).toMatchObject({ ok: false, reason: "refused", calls: 0 });
      expect(api.requests).toHaveLength(1);
    });

    it.each([402, 429])("is refused without a call after Fantastic.jobs answered %i", async (status) => {
      let n = 0;
      const { api, fantasticJobs } = setup(() => (n++ === 0 ? { status, body: '{"message":"no"}' } : {}));

      await fantasticJobs.search(criteria, { max: 30, now: NOW });
      expect(await fantasticJobs.search(criteria, { max: 30, now: LATER })).toMatchObject({ ok: false, reason: "refused", calls: 0 });
      expect(api.requests).toHaveLength(1);
    });

    it("calls again once the next billing date it stated is past", async () => {
      const { api, fantasticJobs } = spent({ "x-api-jobs-remaining": "0", "x-api-requests-remaining": "40", "x-api-next-billing-date": "2026-11-01T00:00:00Z" });

      await fantasticJobs.search(criteria, { max: 30, now: NOW });
      expect(await fantasticJobs.search(criteria, { max: 30, now: new Date("2026-10-31T23:59:00Z") })).toMatchObject({ ok: false, reason: "refused", calls: 0 });
      expect(await fantasticJobs.search(criteria, { max: 30, now: new Date("2026-11-01T00:01:00Z") })).toMatchObject({ ok: true, calls: 1 });
      expect(api.requests).toHaveLength(2);
    });

    it("calls again after the wait a 429 asked for (Retry-After)", async () => {
      let n = 0;
      const { api, fantasticJobs } = setup(() => (n++ === 0 ? { status: 429, headers: { "retry-after": "60" } } : {}));

      await fantasticJobs.search(criteria, { max: 30, now: NOW });
      expect(await fantasticJobs.search(criteria, { max: 30, now: new Date(NOW.getTime() + 30_000) })).toMatchObject({ ok: false, reason: "refused", calls: 0 });
      expect(await fantasticJobs.search(criteria, { max: 30, now: new Date(NOW.getTime() + 61_000) })).toMatchObject({ ok: true, calls: 1 });
      expect(api.requests).toHaveLength(2);
    });

    it("without a renewal date stated, holds the calls back for a day", async () => {
      const { api, fantasticJobs } = spent({ "x-api-jobs-remaining": "0" });

      await fantasticJobs.search(criteria, { max: 30, now: NOW });
      expect(await fantasticJobs.search(criteria, { max: 30, now: new Date("2026-10-21T11:59:00Z") })).toMatchObject({ ok: false, reason: "refused", calls: 0 });
      expect(await fantasticJobs.search(criteria, { max: 30, now: new Date("2026-10-21T12:01:00Z") })).toMatchObject({ ok: true, calls: 1 });
      expect(api.requests).toHaveLength(2);
    });

    it("asks for no more jobs than the Jobs credits left", async () => {
      const { api, fantasticJobs } = spent({ "x-api-jobs-remaining": "3", "x-api-requests-remaining": "40" });

      await fantasticJobs.search(criteria, { max: 30, now: NOW });
      await fantasticJobs.search(criteria, { max: 30, now: LATER });

      expect(api.requests.map((request) => request.url.searchParams.get("limit"))).toEqual(["10", "3"]);
    });

    it("keeps calling while both quotas have some left", async () => {
      const { api, fantasticJobs } = setup({ headers: { "x-api-jobs-remaining": "300", "x-api-requests-remaining": "40" } });

      await fantasticJobs.search(criteria, { max: 30, now: NOW });
      expect(await fantasticJobs.search(criteria, { max: 30, now: LATER })).toMatchObject({ ok: true, calls: 1 });
      expect(api.requests).toHaveLength(2);
    });
  });

  describe("failing soft: a search never throws, so Job discovery goes on without Fantastic.jobs", () => {
    it.each([401, 402, 403, 429])("is refused when Fantastic.jobs answers %i (key rejected, quota exhausted)", async (status) => {
      const { fantasticJobs } = setup({ status, body: '{"message":"no"}' });

      expect(await fantasticJobs.search(criteria, { max: 30, now: NOW })).toMatchObject({ ok: false, reason: "refused", calls: 1 });
    });

    it.each([
      ["a server error", { status: 500 }],
      ["a gateway timeout", { status: 504 }],
      ["a network failure", { status: 0 }],
      ["an answer that is not JSON", { body: "<html>" }],
    ])("fails on %s", async (_, answer) => {
      const { fantasticJobs } = setup(answer);

      expect(await fantasticJobs.search(criteria, { max: 30, now: NOW })).toMatchObject({ ok: false, reason: "failed", calls: 1 });
    });
  });
});

describe("Fantastic.jobs from the environment", () => {
  it("is off unless FANTASTIC_JOBS_API_KEY is set", () => {
    expect(fantasticJobsFromEnv({})).toBeNull();
    expect(fantasticJobsFromEnv({ FANTASTIC_JOBS_API_KEY: "  " })).toBeNull();
    expect(fantasticJobsFromEnv({ FANTASTIC_JOBS_API_KEY: "fj-key" })).not.toBeNull();
  });

  it("goes to FANTASTIC_JOBS_API_URL when set (the e2e fake)", async () => {
    const api = fakeFantasticJobs({ body: "[]" });
    const fantasticJobs = fantasticJobsFromEnv({ FANTASTIC_JOBS_API_KEY: "fj-key", FANTASTIC_JOBS_API_URL: "http://localhost:4243/v1/" }, { fetch: api.fetch });

    await fantasticJobs!.search(criteria, { max: 5, now: NOW });

    expect(api.request().url.href).toMatch(/^http:\/\/localhost:4243\/v1\/active-ats\?/);
  });

  it("asks for no more jobs a search than FANTASTIC_JOBS_MAX_PER_SEARCH, 10 when unset or not a positive number", async () => {
    const limitWith = async (max: string | undefined) => {
      const api = fakeFantasticJobs({ body: "[]" });
      await fantasticJobsFromEnv({ FANTASTIC_JOBS_API_KEY: "fj-key", FANTASTIC_JOBS_MAX_PER_SEARCH: max }, { fetch: api.fetch })!.search(criteria, { max: 30, now: NOW });
      return api.request().url.searchParams.get("limit");
    };

    expect(await limitWith("25")).toBe("25");
    expect(await limitWith(undefined)).toBe("10");
    expect(await limitWith("0")).toBe("10");
    expect(await limitWith("many")).toBe("10");
  });
});

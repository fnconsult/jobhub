import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSearchLive } from "@/job-searches";

const WEB = "https://app.jobbbox.example";
const SEARCH_ID = "6f1c2a7e-3b4d-4c5e-8f90-123456789abc";

/** The signed-in Candidate, and what Job Searches answers, as each test sets them. */
const state = vi.hoisted(() => ({
  candidate: null as { id: string } | null,
  result: null as unknown,
  calls: [] as [string, string, readonly string[]][],
}));
vi.mock("@/auth/server", () => ({ getCurrentCandidate: async () => state.candidate }));
vi.mock("@/job-searches/server", () => ({
  getJobSearches: () => ({
    live: async (candidateId: string, jobSearchId: string, known: readonly string[]) => {
      state.calls.push([candidateId, jobSearchId, known]);
      return state.result;
    },
  }),
}));

const { GET } = await import("./route");

function call(query = "") {
  return GET(new Request(`${WEB}/api/job-searches/${SEARCH_ID}/live${query}`), { params: Promise.resolve({ id: SEARCH_ID }) });
}

describe("GET /api/job-searches/:id/live, what the onboarding's page reads (#1001)", () => {
  beforeEach(() => {
    state.candidate = { id: "marie" };
    state.calls = [];
  });

  it("gives the signed-in Candidate's Job Search with what it measured, not cached, leaving out the Job Offers the card has", async () => {
    const polled: JobSearchLive = { id: SEARCH_ID, status: "searching", failure: null, live: null, jobOffers: [] };
    state.result = polled;

    const response = await call("?known=a, b,,c");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(polled);
    expect(state.calls).toEqual([["marie", SEARCH_ID, ["a", "b", "c"]]]);
  });

  it("is 404 for a Job Search that is not theirs, and 401 signed out", async () => {
    state.result = null;
    expect((await call()).status).toBe(404);

    state.candidate = null;
    expect((await call()).status).toBe(401);
  });
});

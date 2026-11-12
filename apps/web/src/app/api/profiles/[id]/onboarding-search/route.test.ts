import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StartOfferedJobSearchResult } from "@/job-searches";

const WEB = "https://app.jobbbox.example";
const PROFILE_ID = "6f1c2a7e-3b4d-4c5e-8f90-123456789abc";

/** The signed-in Candidate, and what Job Searches answers, as each test sets them. */
const state = vi.hoisted(() => ({
  candidate: null as { id: string } | null,
  result: null as unknown,
  calls: [] as [string, string][],
}));
vi.mock("@/auth/server", () => ({
  getCurrentCandidate: async () => state.candidate,
  isFromTrustedOrigin: (request: Request) => request.headers.get("origin") === WEB,
}));
vi.mock("@/job-searches/server", () => ({
  getJobSearches: () => ({
    startOffered: async (candidateId: string, profileId: string) => {
      state.calls.push([candidateId, profileId]);
      return state.result;
    },
  }),
}));

const { POST } = await import("./route");

function call(origin = WEB) {
  return POST(new Request(`${WEB}/api/profiles/${PROFILE_ID}/onboarding-search`, { method: "POST", headers: { origin } }), {
    params: Promise.resolve({ id: PROFILE_ID }),
  });
}

describe("POST /api/profiles/:id/onboarding-search starts the Job Search the onboarding offers (#1000)", () => {
  beforeEach(() => {
    state.candidate = { id: "marie" };
    state.calls = [];
  });

  it("starts it for the signed-in Candidate's Profile: 201 with its id and whether it is the first or the restart", async () => {
    state.result = { ok: true, jobSearch: { id: "search-1" }, offered: "restart" } as unknown as StartOfferedJobSearchResult;

    const response = await call();

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "search-1", offered: "restart" });
    expect(state.calls).toEqual([["marie", PROFILE_ID]]);
  });

  it.each([
    ["not_found", 404],
    ["archived", 409],
    ["not_onboarding", 409],
    ["used_up", 409],
  ] as const)("answers %s with %i", async (error, status) => {
    state.result = { ok: false, error } satisfies StartOfferedJobSearchResult;

    const response = await call();

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("refuses anyone signed out (401) and a request from elsewhere (403), starting nothing", async () => {
    expect((await call("https://evil.example")).status).toBe(403);
    state.candidate = null;
    expect((await call()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { POST } from "./cancel/route";

// The Candidate's own session routes (#1019): « Espace coach v2 » on, a session that has ended answers 409 « too_late »,
// as the cancellation policy's « trop tard » (#883); off, they answer as on main.
const state = vi.hoisted(() => ({
  v2: true,
  policy: false,
  scheduled: { ok: true, session: { id: "s1" } } as unknown,
  cancelled: { ok: true, session: { id: "s1" } } as unknown,
  contractual: { ok: true, cancellation: { id: "c1" } } as unknown,
}));
vi.mock("@/auth/server", () => ({ isFromTrustedOrigin: () => true, getCurrentCandidate: async () => ({ id: "marie" }) }));
vi.mock("@/coach-space-v2/server", () => ({ coachSpaceV2On: () => state.v2 }));
vi.mock("@/coaching-booking/manual", () => ({ linkedBookingConflict: () => false }));
vi.mock("@/human-coaches/server", () => ({
  getHumanCoaches: () => ({ scheduleSession: async () => state.scheduled, cancelSession: async () => state.cancelled }),
}));
vi.mock("@/coaching-cancellations/server", () => ({
  cancellationPolicyOn: async () => state.policy,
  getCoachingCancellations: () => ({ candidateCancel: async () => state.contractual }),
}));

const params = { params: Promise.resolve({ sessionId: "s1" }) } as never;
const request = (body?: unknown) => new Request("https://jobbbox.test/api/coaching/sessions/s1", { method: "POST", body: JSON.stringify(body ?? {}) });
const TOO_LATE = { ok: false, error: "too_late" };

describe("a Candidate's session routes and a session that has ended (#1019)", () => {
  beforeEach(() => {
    state.v2 = true;
    state.policy = false;
    state.scheduled = { ok: true, session: { id: "s1" } };
    state.cancelled = { ok: true, session: { id: "s1" } };
    state.contractual = { ok: true, cancellation: { id: "c1" } };
  });

  it("refuses to move it: 409 too_late", async () => {
    state.scheduled = TOO_LATE;
    const response = await PATCH(request({ scheduledAt: "2026-06-05T10:00" }), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "too_late" });
  });

  it("refuses to cancel it, cancellation policy off or on: 409 too_late", async () => {
    state.cancelled = TOO_LATE;
    let response = await POST(request(), params);
    expect([response.status, await response.json()]).toEqual([409, { error: "too_late" }]);
    state.policy = true;
    state.contractual = TOO_LATE;
    response = await POST(request(), params);
    expect([response.status, await response.json()]).toEqual([409, TOO_LATE]);
  });

  it("moves and cancels a session to come or under way, as before", async () => {
    expect((await PATCH(request({ scheduledAt: "2026-12-05T10:00" }), params)).status).toBe(200);
    expect((await POST(request(), params)).status).toBe(200);
  });

  it("answers 404 for a session that is not the Candidate's, setting on or off", async () => {
    for (const v2 of [true, false]) {
      state.v2 = v2;
      state.scheduled = { ok: false, error: "not_found" };
      state.cancelled = { ok: false, error: "not_found" };
      expect((await PATCH(request({ scheduledAt: "2026-12-05T10:00" }), params)).status).toBe(404);
      expect((await POST(request(), params)).status).toBe(404);
    }
  });
});

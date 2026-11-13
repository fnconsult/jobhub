import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";
import { POST } from "./cancel/route";

// « Espace coach v2 » off (#1022, main's routes): a session that has ended answers 409 « too_late » and is not changed;
// one to come or under way is moved and cancelled as before.
const state = vi.hoisted(() => ({ scheduled: null as unknown, cancelled: null as unknown, policy: vi.fn() }));
vi.mock("@/auth/server", () => ({ isFromTrustedOrigin: () => true, getCurrentCandidate: async () => ({ id: "marie" }) }));
vi.mock("@/coach-space-v2/server", () => ({ coachSpaceV2On: () => false }));
vi.mock("@/coaching-booking/manual", () => ({ linkedBookingConflict: () => false }));
vi.mock("@/human-coaches/server", () => ({
  getHumanCoaches: () => ({ scheduleSession: async () => state.scheduled, cancelSession: async () => state.cancelled }),
}));
vi.mock("@/coaching-cancellations/server", () => ({
  cancellationPolicyOn: async () => true,
  getCoachingCancellations: () => ({ candidateCancel: state.policy }),
}));

const params = { params: Promise.resolve({ sessionId: "s1" }) } as never;
const request = (body?: unknown) => new Request("https://jobbbox.test/api/coaching/sessions/s1", { method: "POST", body: JSON.stringify(body ?? {}) });

describe("a Candidate's session routes, « Espace coach v2 » off (#1022)", () => {
  beforeEach(() => {
    state.scheduled = { ok: true, session: { id: "s1" } };
    state.cancelled = { ok: true, session: { id: "s1" } };
  });

  it("refuse to move or cancel a session that has ended: 409 too_late, without the cancellation policy", async () => {
    state.scheduled = { ok: false, error: "too_late" };
    state.cancelled = { ok: false, error: "too_late" };
    const moved = await PATCH(request({ scheduledAt: "2026-11-20T10:00" }), params);
    expect([moved.status, await moved.json()]).toEqual([409, { error: "too_late" }]);
    const cancelled = await POST(request(), params);
    expect([cancelled.status, await cancelled.json()]).toEqual([409, { error: "too_late" }]);
    expect(state.policy).not.toHaveBeenCalled();
  });

  it("move and cancel a session to come, as on main: 200", async () => {
    expect((await PATCH(request({ scheduledAt: "2026-11-20T10:00" }), params)).status).toBe(200);
    expect((await POST(request(), params)).status).toBe(200);
  });

  it("answer 404 for a session that is not the Candidate's", async () => {
    state.scheduled = { ok: false, error: "not_found" };
    state.cancelled = { ok: false, error: "not_found" };
    expect((await PATCH(request({ scheduledAt: "2026-11-20T10:00" }), params)).status).toBe(404);
    expect((await POST(request(), params)).status).toBe(404);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ coach: { id: "coach" } as { id: string } | null, v2: true }));
vi.mock("@/human-coaches/server", () => ({ requireHumanCoach: async () => { if (!state.coach) throw new Error("404"); return state.coach; } }));
vi.mock("@/coach-space-v2/server", () => ({ requireCoachSpaceV2: () => { if (!state.v2) throw new Error("404 v2 off"); } }));
import { requireCoachSpace } from "./server";
describe("Permanent Coach space entry", () => {
  beforeEach(() => { state.coach = { id: "coach" }; state.v2 = true; });
  it("uses the current authorized professional identity while « Espace coach v2 » is on", async () => {
    expect(await requireCoachSpace()).toEqual({ id: "coach" });
  });
  it("retains the underlying active identity and contract gate", async () => {
    state.coach = null;
    await expect(requireCoachSpace()).rejects.toThrow("404");
  });
  it("answers 404 while « Espace coach v2 » is off, even to an active Human Coach (ADR-0106)", async () => {
    state.v2 = false;
    await expect(requireCoachSpace()).rejects.toThrow("404 v2 off");
  });
});

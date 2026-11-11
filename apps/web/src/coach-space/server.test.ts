import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ coach: { id: "coach" } as { id: string } | null }));
vi.mock("@/human-coaches/server", () => ({ requireHumanCoach: async () => { if (!state.coach) throw new Error("404"); return state.coach; } }));
import { requireCoachSpace } from "./server";
describe("Permanent Coach space entry", () => {
  beforeEach(() => { state.coach = { id: "coach" }; });
  it("uses the current authorized professional identity without a temporary flag", async () => {
    expect(await requireCoachSpace()).toEqual({ id: "coach" });
  });
  it("retains the underlying active identity and contract gate", async () => {
    state.coach = null;
    await expect(requireCoachSpace()).rejects.toThrow("404");
  });
});

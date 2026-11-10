import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ setting: { value: "false", valid: true }, coach: { id: "coach" } as { id: string } | null }));
vi.mock("@/platform-settings/server", () => ({ getPlatformSettingsResolver: () => ({ current: () => ({ setting: () => state.setting }) }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
vi.mock("@/human-coaches/server", () => ({ requireHumanCoach: async () => { if (!state.coach) throw new Error("404"); return state.coach; } }));
import { coachSpaceV2On, requireCoachSpaceV2 } from "./server";

describe("Coach space rollout entry gate", () => {
  beforeEach(() => { state.setting = { value: "false", valid: true }; state.coach = { id: "coach" }; });
  it("keeps the legacy space until explicitly enabled, rejecting v2 deep links", async () => {
    expect(coachSpaceV2On()).toBe(false);
    await expect(requireCoachSpaceV2()).rejects.toThrow("404");
    state.setting.value = "true";
    expect(await requireCoachSpaceV2()).toEqual({ id: "coach" });
  });
  it("rejects an invalid setting and inactive coaches even while enabled", async () => {
    state.setting = { value: "true", valid: false };
    expect(coachSpaceV2On()).toBe(false);
    state.setting.valid = true;
    state.coach = null;
    await expect(requireCoachSpaceV2()).rejects.toThrow("404");
  });
});

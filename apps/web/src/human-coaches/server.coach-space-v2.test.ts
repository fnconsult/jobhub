import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HumanCoachesDeps } from "./index";

// « Espace coach v2 » (ADR-0106) on the app's Human Coaches: off, no contract, no cancellation policy, no Coaching notices,
// and only an active Human Coach sees « Espace coach », as on main.
const state = vi.hoisted(() => ({
  on: false,
  coach: null as { id: string } | null,
  actors: [] as { kind: string }[],
  deps: null as unknown,
}));
vi.mock("@/coach-space-v2/server", () => ({ coachSpaceV2On: () => state.on }));
vi.mock("@/coaching-notifications/activation-server", () => ({ coachingNoticesOn: () => true }));
vi.mock("@/coaching-cancellations/server", () => ({
  cancellationPolicyOn: async () => true,
  getCoachingCancellations: () => ({ maySchedule: async () => false }),
}));
vi.mock("@/coach-pages/server", () => ({ getCoachPages: () => ({ approved: async () => [] }) }));
vi.mock("@/coach-contracts/server", () => ({
  getCoachContracts: () => ({ actors: async () => state.actors, mayEnter: async () => false }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("404");
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/database/pool", () => ({ sharedPool: () => ({}) }));
vi.mock("@/applications/server", () => ({ getApplications: () => ({}) }));
vi.mock("@/auth/server", () => ({
  getCurrentCandidate: async () => ({ id: "person", email: "claire@example.com", emailVerified: true }),
  signInRedirect: () => {
    throw new Error("sign in");
  },
}));
vi.mock("@/profiles/server", () => ({ getProfiles: () => ({}) }));
vi.mock("@/push-notifications/server", () => ({ getPushNotifications: () => ({}) }));
vi.mock("@/tailored-cv/server", () => ({ getTailoredCvs: () => ({}) }));
vi.mock("@/tailored-documents/server", () => ({ getTailoredDocuments: () => ({}) }));
vi.mock("./index", () => ({
  createHumanCoaches: (_pool: unknown, deps: unknown) => {
    state.deps = deps;
    return { coachSignedIn: async () => state.coach };
  },
}));

import { currentHasHumanCoachIdentity, getHumanCoaches, requireHumanCoach } from "./server";

const deps = () => {
  getHumanCoaches();
  return state.deps as HumanCoachesDeps;
};

describe("the app's Human Coaches and « Espace coach v2 »", () => {
  beforeEach(() => {
    state.coach = null;
    state.actors = [{ kind: "coach" }];
  });

  describe("off: as on main", () => {
    beforeEach(() => {
      state.on = false;
    });
    it("tells the module it is off, and turns the epic's deps into main's", async () => {
      const d = deps();
      expect(await d.coachSpaceV2On?.()).toBe(false);
      expect(await d.contractualCancellationOn?.()).toBe(false);
      expect(await d.coachingNotificationsOwned?.()).toBe(false);
      expect(await d.mayEnter?.({ email: "claire@example.com", emailVerified: true }, "coach")).toBe(true);
      expect(await d.mayChangeSession?.({} as never, "session", "coach", null)).toBe(true);
    });
    it("answers 404 to a person whose contract is pending: no redirect to /espace-coach/contrat", async () => {
      await expect(requireHumanCoach()).rejects.toThrow("404");
    });
    it("shows « Espace coach » to an active Human Coach only", async () => {
      expect(await currentHasHumanCoachIdentity()).toBe(false);
      state.coach = { id: "coach" };
      expect(await currentHasHumanCoachIdentity()).toBe(true);
    });
  });

  describe("on: the epic's rules", () => {
    beforeEach(() => {
      state.on = true;
    });
    it("passes the contract, the cancellation policy and the Coaching notices", async () => {
      const d = deps();
      expect(await d.coachSpaceV2On?.()).toBe(true);
      expect(await d.contractualCancellationOn?.()).toBe(true);
      expect(await d.coachingNotificationsOwned?.()).toBe(true);
      expect(await d.mayEnter?.({ email: "claire@example.com", emailVerified: true }, "coach")).toBe(false);
      expect(await d.mayChangeSession?.({} as never, "session", "coach", null)).toBe(false);
    });
    it("sends a person whose contract is pending to the agreement", async () => {
      await expect(requireHumanCoach()).rejects.toThrow("redirect /espace-coach/contrat");
    });
    it("shows « Espace coach » to a contracted coach identity, contract pending or not", async () => {
      expect(await currentHasHumanCoachIdentity()).toBe(true);
    });
  });
});

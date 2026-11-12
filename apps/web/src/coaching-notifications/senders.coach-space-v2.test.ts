import { beforeEach, describe, expect, it, vi } from "vitest";

// « Espace coach v2 » (ADR-0106) on the Human Coach epic's senders: off, nothing goes to a Candidate or a Coach, and each
// notice stays pending (no query is even made) until it is on; on, each sender runs as before.
const state = vi.hoisted(() => ({ on: false, calRemindersDisabled: true, sent: [] as unknown[] }));
const untouched = {
  query: async () => {
    throw new Error("database reached");
  },
  connect: async () => {
    throw new Error("database reached");
  },
};
vi.mock("@/coach-space-v2/server", () => ({ coachSpaceV2On: () => state.on }));
vi.mock("@/database/pool", () => ({ sharedPool: () => untouched }));
vi.mock("@/auth/server", () => ({
  getAuth: () => ({ options: { baseURL: "https://app.jobbbox.fr", secret: "secret" } }),
  getMailer: () => ({ send: async (message: unknown) => void state.sent.push(message) }),
  getCurrentCandidate: async () => null,
  signInRedirect: () => {
    throw new Error("sign in");
  },
}));
vi.mock("@/platform-settings/server", () => ({
  getPlatformSettingsResolver: () => ({
    current: () => ({
      setting: (name: string) => (name === "CAL_COM_REMINDERS_DISABLED" ? { valid: true, value: String(state.calRemindersDisabled) } : undefined),
      env: {},
    }),
  }),
}));
vi.mock("./legal", () => ({ coachingNoticesEnabled: (calRemindersDisabled: boolean) => calRemindersDisabled }));
vi.mock("@/provider-secrets/server", () => ({ getSecretResolver: () => ({ current: () => ({ env: {} }) }) }));
vi.mock("@/push-notifications/server", () => ({ getPushNotifications: () => ({ notify: async () => true }) }));

beforeEach(() => {
  state.on = false;
  state.sent = [];
});

describe("the coaching notifications (#885)", () => {
  it("are off, settings and deliveries, while « Espace coach v2 » is off, whatever their own conditions", async () => {
    const { coachingNoticesOn } = await import("./activation-server");
    expect(coachingNoticesOn()).toBe(false);
    state.on = true;
    expect(coachingNoticesOn()).toBe(true);
    state.calRemindersDisabled = false;
    expect(coachingNoticesOn()).toBe(false);
    state.calRemindersDisabled = true;
  });
});

describe("the epic's notices, delivered from the web app", () => {
  const deliveries: [string, () => Promise<unknown>][] = [
    ["Coach page decisions", async () => (await import("@/coach-pages/server")).getCoachPages().deliverNotices()],
    ["Coach enrolment decisions", async () => (await import("@/coach-enrolments/server")).getCoachEnrolments().deliverNotices()],
    ["association invitations", async () => (await import("@/coach-associations/server")).getCoachAssociations().deliverInvitations()],
  ];
  for (const [name, deliver] of deliveries) {
    it(`${name}: nothing, not even a query, while it is off; delivered once it is on`, async () => {
      await expect(deliver()).resolves.toBe(0);
      expect(state.sent).toEqual([]);
      state.on = true;
      await expect(deliver()).rejects.toThrow("database reached");
    });
  }
});

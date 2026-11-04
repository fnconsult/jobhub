import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createPushNotifications, migratePushNotifications, type PushNotifications } from "./index";
import type { PushDevice, PushOutcome, PushPlatform, PushSender } from "./senders";
import type { PushMessage } from "./messages";

const IPHONE = "a1".repeat(32);
const IPAD = "b2".repeat(32);
const PIXEL = "fcm-token-pixel-0123456789";

/** A sender that answers each token as told (sent, by default), and keeps what it was asked to send. */
function fakeSender() {
  const sent: { token: string; environment: string; message: PushMessage }[] = [];
  const answers = new Map<string, PushOutcome>();
  const sender: PushSender = {
    async send(device: PushDevice, message: PushMessage) {
      sent.push({ token: device.token, environment: device.environment, message });
      return answers.get(device.token) ?? { ok: true };
    },
  };
  return { sender, sent, answer: (token: string, outcome: PushOutcome) => answers.set(token, outcome) };
}

describe.skipIf(!connectionString)("Push notifications (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let push: PushNotifications;
  let apns: ReturnType<typeof fakeSender>;
  let fcm: ReturnType<typeof fakeSender>;
  let senders: Partial<Record<PushPlatform, PushSender | null>>;
  const clock = { now: new Date("2026-11-04T09:00:00.000Z") };

  /** Signs `email` in, as the app does; their id, session id and cookie. */
  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    const { user, session } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    return { id: user.id as string, sessionId: session.id as string, cookie };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migratePushNotifications(database);
    await migratePushNotifications(database); // safe to run twice
    apns = fakeSender();
    fcm = fakeSender();
    senders = { ios: apns.sender, android: fcm.sender };
    push = createPushNotifications(database, { senders: () => senders, now: () => clock.now });
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("the devices", () => {
    it("registers a device with its platform, language and dates, and lists it without its token", async () => {
      const marie = await signIn("marie@example.fr");
      expect(await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" })).toEqual({ ok: true });
      expect(await push.devices(marie.id)).toEqual([{ platform: "ios", language: "fr", registeredAt: clock.now, lastSeenAt: clock.now }]);
    });

    it("refuses what is not a device: an unknown platform, an empty token, a language the app does not speak", async () => {
      const marie = await signIn("marie@example.fr");
      for (const device of [{ platform: "windows", token: IPHONE, language: "fr" }, { platform: "ios", token: " ", language: "fr" }, { platform: "ios", token: IPHONE, language: "de" }, null]) {
        expect(await push.register(marie, device)).toEqual({ ok: false, error: "invalid" });
      }
      expect(await push.devices(marie.id)).toEqual([]);
    });

    it("updates the date last seen and the language when the app registers the same token again", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      const registeredAt = clock.now;
      clock.now = new Date("2026-11-05T09:00:00.000Z");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "en" });
      expect(await push.devices(marie.id)).toEqual([{ platform: "ios", language: "en", registeredAt, lastSeenAt: clock.now }]);
    });

    it("moves a token to the account signed in on the device now", async () => {
      const marie = await signIn("marie@example.fr");
      const paul = await signIn("paul@example.fr");
      await push.register(marie, { platform: "android", token: PIXEL, language: "fr" });
      await push.register(paul, { platform: "android", token: PIXEL, language: "fr" });
      expect(await push.devices(marie.id)).toEqual([]);
      expect(await push.devices(paul.id)).toHaveLength(1);
    });

    it("forgets a device when its session signs out", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      const signedOut = await testAuth.request("/api/auth/sign-out", { method: "POST", body: {}, cookie: marie.cookie });
      expect(signedOut.ok).toBe(true);
      expect(await push.devices(marie.id)).toEqual([]);
    });

    it("forgets a device the app asks to forget, only the person's own", async () => {
      const marie = await signIn("marie@example.fr");
      const paul = await signIn("paul@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      await push.forget(paul.id, IPHONE);
      expect(await push.devices(marie.id)).toHaveLength(1);
      await push.forget(marie.id, IPHONE);
      expect(await push.devices(marie.id)).toEqual([]);
    });

    it("deletes the devices with the account", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      await push.setEnabled(marie.id, "job_digest", false);
      await database.query(`DELETE FROM candidate WHERE id = $1`, [marie.id]);
      const { rows } = await database.query(`SELECT 1 FROM push_device UNION ALL SELECT 1 FROM push_notification_setting`);
      expect(rows).toEqual([]);
    });
  });

  describe("the switches in Rappels", () => {
    it("has every event on until switched off", async () => {
      const marie = await signIn("marie@example.fr");
      const settings = await push.settings(marie.id);
      expect(Object.values(settings).every(Boolean)).toBe(true);
      await push.setEnabled(marie.id, "job_search_results", false);
      expect(await push.settings(marie.id)).toEqual({ ...settings, job_search_results: false });
      await push.setEnabled(marie.id, "job_search_results", true);
      expect(await push.settings(marie.id)).toEqual(settings);
    });
  });

  describe("sending", () => {
    it("sends to each of the person's devices, through its platform's provider, in the device's language", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      await push.register(marie, { platform: "ios", token: IPAD, language: "en", environment: "development" });
      await push.register(marie, { platform: "android", token: PIXEL, language: "fr" });
      expect(await push.send(marie.id, { event: "job_search_results", jobSearchId: "7f1c2a0e-3b4d-4e5f-8a9b-0c1d2e3f4a5b" })).toEqual({ sent: 3, failed: 0, removed: 0 });
      expect(apns.sent.map(({ token, environment, message }) => [token, environment, message.title])).toEqual(
        expect.arrayContaining([
          [IPHONE, "production", "Nouveaux résultats pour une recherche"],
          [IPAD, "development", "New results for a search"],
        ]),
      );
      expect(fcm.sent).toEqual([{ token: PIXEL, environment: "production", message: expect.objectContaining({ path: "/recherches/7f1c2a0e-3b4d-4e5f-8a9b-0c1d2e3f4a5b" }) }]);
    });

    it("sends nothing for an event the person switched off, and the test whatever the switches", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      await push.setEnabled(marie.id, "appointment_reminder", false);
      expect(await push.send(marie.id, { event: "appointment_reminder" })).toEqual({ sent: 0, failed: 0, removed: 0 });
      expect(await push.send(marie.id, { event: "test" })).toEqual({ sent: 1, failed: 0, removed: 0 });
    });

    it("sends only to the devices of one platform when asked (the Back Office's test of one provider)", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      await push.register(marie, { platform: "android", token: PIXEL, language: "fr" });
      expect(await push.send(marie.id, { event: "test" }, { platform: "android" })).toEqual({ sent: 1, failed: 0, removed: 0 });
      expect(apns.sent).toEqual([]);
    });

    it("sends nothing to a device whose session expired", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      await database.query(`UPDATE session SET "expiresAt" = $1 WHERE id = $2`, [new Date("2026-11-01T00:00:00Z"), marie.sessionId]);
      expect(await push.send(marie.id, { event: "test" })).toEqual({ sent: 0, failed: 0, removed: 0 });
    });

    it("deletes a token the provider says is no longer valid, and keeps the failure with its Failure Reason", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      await push.register(marie, { platform: "android", token: PIXEL, language: "fr" });
      apns.answer(IPHONE, { ok: false, reason: "device_token_invalid", tokenInvalid: true, status: 410, message: "Unregistered" });
      expect(await push.send(marie.id, { event: "coach_review", applicationId: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b" })).toEqual({ sent: 1, failed: 1, removed: 1 });
      expect((await push.devices(marie.id)).map((device) => device.platform)).toEqual(["android"]);
      expect(await push.failures()).toEqual([{ at: clock.now, platform: "ios", event: "coach_review", reason: "device_token_invalid", httpStatus: 410 }]);
    });

    it("keeps a token the provider refused for another reason, and the failure", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      // A wrong topic or environment is a configuration error: deleting would wipe every token.
      apns.answer(IPHONE, { ok: false, reason: "provider_rejected", tokenInvalid: false, status: 400, message: "BadDeviceToken" });
      expect(await push.send(marie.id, { event: "test" })).toEqual({ sent: 0, failed: 1, removed: 0 });
      expect(await push.devices(marie.id)).toHaveLength(1);
      expect((await push.failures()).map((failure) => failure.reason)).toEqual(["provider_rejected"]);
    });

    it("keeps the failure as key_missing when the provider's key is not entered, and one that throws as provider_unavailable", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      await push.register(marie, { platform: "android", token: PIXEL, language: "fr" });
      senders = {
        ios: null,
        android: {
          send: async () => {
            throw new Error("socket hang up");
          },
        },
      };
      expect(await push.send(marie.id, { event: "test" })).toEqual({ sent: 0, failed: 2, removed: 0 });
      expect((await push.failures()).map((failure) => [failure.platform, failure.reason]).sort()).toEqual([
        ["android", "provider_unavailable"],
        ["ios", "key_missing"],
      ]);
    });

    it("keeps no token, no account and no text with a failure", async () => {
      const marie = await signIn("marie@example.fr");
      await push.register(marie, { platform: "ios", token: IPHONE, language: "fr" });
      apns.answer(IPHONE, { ok: false, reason: "provider_rejected", tokenInvalid: false, status: 400, message: `BadDeviceToken ${IPHONE}` });
      await push.send(marie.id, { event: "test" });
      const { rows } = await database.query(`SELECT * FROM push_notification_failure`);
      expect(JSON.stringify(rows)).not.toContain(IPHONE);
      expect(JSON.stringify(rows)).not.toContain(marie.id);
    });
  });
});

import { generateKeyPairSync } from "node:crypto";
import type { ExternalApiCall } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { pushSendersFromEnv } from "./worker";

const TOKEN = "a1".repeat(32);
const MESSAGE = { title: "Notification de test", body: "Les notifications de Jobbbox arrivent bien sur cet appareil.", path: "/" };
const p8 = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const serviceAccount = () =>
  JSON.stringify({
    project_id: "jobbbox-app",
    private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: "push@jobbbox-app.iam.gserviceaccount.com",
  });

function recorder() {
  const calls: ExternalApiCall[] = [];
  return { calls, externalApis: { record: (call: ExternalApiCall) => void calls.push(call) } };
}

const ok = async () => Response.json({ access_token: "ya29.x", expires_in: 3600, name: "projects/jobbbox-app/messages/1" });

describe("the worker's Push notification providers, from their Provider Secrets (#698)", () => {
  it("has none while their keys are not entered: their devices then fail with key_missing", () => {
    const senders = pushSendersFromEnv({ env: () => ({}), http2: { fetch: ok, close() {} }, fetch: ok });
    expect(senders()).toEqual({ ios: null, android: null });
  });

  it("has APNs once its .p8, its Key ID and the Team ID are there, FCM once its service account is", () => {
    const env = { APNS_AUTH_KEY: p8(), APNS_KEY_ID: "ABC123DEFG", APPLE_TEAM_ID: "TEAM123456", FCM_SERVICE_ACCOUNT: serviceAccount() };
    const senders = pushSendersFromEnv({ env: () => env, http2: { fetch: ok, close() {} }, fetch: ok });
    expect(senders().ios).not.toBeNull();
    expect(senders().android).not.toBeNull();
  });

  it("keeps each provider while its keys stay the same (its tokens are reused), and builds it again once they change", () => {
    let env: Record<string, string> = { APNS_AUTH_KEY: p8(), APNS_KEY_ID: "ABC123DEFG", APPLE_TEAM_ID: "TEAM123456" };
    const senders = pushSendersFromEnv({ env: () => env, http2: { fetch: ok, close() {} }, fetch: ok });
    const first = senders().ios;
    expect(senders().ios).toBe(first);
    env = { ...env, APNS_KEY_ID: "ZZZ999YYYY" };
    expect(senders().ios).not.toBe(first);
  });

  it("has none for a key it cannot read, and says so", () => {
    const lines: string[] = [];
    const senders = pushSendersFromEnv({ env: () => ({ APNS_AUTH_KEY: "nope", APNS_KEY_ID: "K", APPLE_TEAM_ID: "T", FCM_SERVICE_ACCOUNT: "{}" }), http2: { fetch: ok, close() {} }, fetch: ok, log: (line) => lines.push(line) });
    expect(senders()).toEqual({ ios: null, android: null });
    expect(lines.join("\n")).toMatch(/APNS_AUTH_KEY/);
    expect(lines.join("\n")).toMatch(/FCM_SERVICE_ACCOUNT/);
  });

  it("records each call to APNs and FCM in AI Usage's external APIs, never the device's token", async () => {
    const { calls, externalApis } = recorder();
    const env = { APNS_AUTH_KEY: p8(), APNS_KEY_ID: "ABC123DEFG", APPLE_TEAM_ID: "TEAM123456", FCM_SERVICE_ACCOUNT: serviceAccount() };
    const senders = pushSendersFromEnv({ env: () => env, http2: { fetch: async () => new Response(null, { status: 200 }), close() {} }, fetch: ok, externalApis });
    await senders().ios!.send({ token: TOKEN, environment: "production" }, MESSAGE);
    await senders().android!.send({ token: TOKEN, environment: "production" }, MESSAGE);
    expect(calls.map(({ provider, operation, ok }) => ({ provider, operation, ok }))).toEqual([
      { provider: "apns", operation: "POST /3/device", ok: true },
      { provider: "fcm", operation: "POST /token", ok: true },
      { provider: "fcm", operation: "POST /v1/projects/messages:send", ok: true },
    ]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });
});

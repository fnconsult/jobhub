import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFcmSender, serviceAccountOf } from "./fcm";
import type { PushMessage } from "./messages";

const TOKEN = "fcm-token-pixel-0123456789";
const MESSAGE: PushMessage = { title: "Relance à faire", body: "Une de vos candidatures attend une relance.", path: "/candidatures/42" };

/** A service account's JSON key, as the Firebase console gives it. */
function serviceAccount() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const json = JSON.stringify({
    type: "service_account",
    project_id: "jobbbox-app",
    private_key_id: "0123abcd",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: "push@jobbbox-app.iam.gserviceaccount.com",
    token_uri: "https://oauth2.googleapis.com/token",
  });
  return { json, publicKey };
}

type Call = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } };

/** A fetch playing Google's OAuth endpoint (an access token for an hour) and FCM (`sendAnswers` in turn, the last one again). */
function fakeGoogle(...sendAnswers: (() => Response)[]) {
  const calls: Call[] = [];
  let tokens = 0;
  let sends = 0;
  const fetch = async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: `access-${++tokens}`, expires_in: 3600, token_type: "Bearer" });
    return (sendAnswers[Math.min(sends++, sendAnswers.length - 1)] ?? (() => Response.json({ name: "projects/jobbbox-app/messages/1" })))();
  };
  return { fetch, calls, sends: () => calls.filter((call) => call.url.includes("fcm.googleapis.com")) };
}

const fcmError = (code: number, status: string, errorCode?: string) => () =>
  Response.json(
    { error: { code, message: `${status} message`, status, details: errorCode ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] : [] } },
    { status: code },
  );

describe("FCM (HTTP v1, a service account's OAuth access token)", () => {
  const now = new Date("2026-11-04T09:00:00.000Z");

  it("gets an access token for the firebase.messaging scope with a JWT signed by the service account", async () => {
    const account = serviceAccount();
    const google = fakeGoogle();
    await createFcmSender({ serviceAccount: account.json, fetch: google.fetch, now: () => now }).send({ token: TOKEN, environment: "production" }, MESSAGE);

    const [grant] = google.calls;
    expect(grant!.init.method).toBe("POST");
    const form = new URLSearchParams(grant!.init.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [head, claims, signature] = form.get("assertion")!.split(".") as [string, string, string];
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), account.publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT", kid: "0123abcd" });
    const iat = Math.floor(now.getTime() / 1000);
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "push@jobbbox-app.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp: iat + 3600,
    });
  });

  it("sends the notification and its deep link to the device's token, in the project's messages:send", async () => {
    const google = fakeGoogle();
    expect(await createFcmSender({ serviceAccount: serviceAccount().json, fetch: google.fetch, now: () => now }).send({ token: TOKEN, environment: "production" }, MESSAGE)).toEqual({ ok: true });
    const [send] = google.sends();
    expect(send!.url).toBe("https://fcm.googleapis.com/v1/projects/jobbbox-app/messages:send");
    expect(new Headers(send!.init.headers).get("authorization")).toBe("Bearer access-1");
    expect(JSON.parse(send!.init.body!)).toEqual({ message: { token: TOKEN, notification: { title: MESSAGE.title, body: MESSAGE.body }, data: { path: "/candidatures/42" } } });
  });

  it("reuses its access token until shortly before it expires", async () => {
    let clock = now;
    const google = fakeGoogle();
    const fcm = createFcmSender({ serviceAccount: serviceAccount().json, fetch: google.fetch, now: () => clock });
    await fcm.send({ token: TOKEN, environment: "production" }, MESSAGE);
    clock = new Date(now.getTime() + 50 * 60_000);
    await fcm.send({ token: TOKEN, environment: "production" }, MESSAGE);
    clock = new Date(now.getTime() + 58 * 60_000);
    await fcm.send({ token: TOKEN, environment: "production" }, MESSAGE);
    expect(google.sends().map((call) => new Headers(call.init.headers).get("authorization"))).toEqual(["Bearer access-1", "Bearer access-1", "Bearer access-2"]);
  });

  it("gets a new access token and tries once more when FCM answers 401", async () => {
    const google = fakeGoogle(fcmError(401, "UNAUTHENTICATED", "THIRD_PARTY_AUTH_ERROR"), () => Response.json({ name: "projects/jobbbox-app/messages/2" }));
    expect(await createFcmSender({ serviceAccount: serviceAccount().json, fetch: google.fetch, now: () => now }).send({ token: TOKEN, environment: "production" }, MESSAGE)).toEqual({ ok: true });
    expect(google.sends().map((call) => new Headers(call.init.headers).get("authorization"))).toEqual(["Bearer access-1", "Bearer access-2"]);
  });

  it("says the token is no longer valid when FCM answers UNREGISTERED", async () => {
    const google = fakeGoogle(fcmError(404, "NOT_FOUND", "UNREGISTERED"));
    expect(await createFcmSender({ serviceAccount: serviceAccount().json, fetch: google.fetch }).send({ token: TOKEN, environment: "production" }, MESSAGE)).toEqual({
      ok: false,
      reason: "device_token_invalid",
      tokenInvalid: true,
      status: 404,
      message: "UNREGISTERED: NOT_FOUND message",
    });
  });

  it("keeps the token on INVALID_ARGUMENT or SENDER_ID_MISMATCH, tells the rate limit and unavailability apart", async () => {
    const send = (answer: () => Response) => createFcmSender({ serviceAccount: serviceAccount().json, fetch: fakeGoogle(answer).fetch }).send({ token: TOKEN, environment: "production" }, MESSAGE);
    expect(await send(fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT"))).toMatchObject({ ok: false, reason: "provider_rejected", tokenInvalid: false, status: 400 });
    expect(await send(fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"))).toMatchObject({ ok: false, reason: "provider_rejected", tokenInvalid: false, status: 403 });
    expect(await send(fcmError(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED"))).toMatchObject({ ok: false, reason: "rate_limited", status: 429 });
    expect(await send(fcmError(503, "UNAVAILABLE", "UNAVAILABLE"))).toMatchObject({ ok: false, reason: "provider_unavailable", status: 503 });
  });

  it("says why when Google refuses the service account", async () => {
    const fetch = async () => Response.json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, { status: 400 });
    expect(await createFcmSender({ serviceAccount: serviceAccount().json, fetch }).send({ token: TOKEN, environment: "production" }, MESSAGE)).toEqual({
      ok: false,
      reason: "provider_rejected",
      tokenInvalid: false,
      status: 400,
      message: "OAuth: invalid_grant Invalid JWT Signature.",
    });
  });
});

describe("the service account entered as a Provider Secret", () => {
  it("is read from its JSON key", () => {
    expect(serviceAccountOf(serviceAccount().json)).toMatchObject({ projectId: "jobbbox-app", clientEmail: "push@jobbbox-app.iam.gserviceaccount.com", tokenUri: "https://oauth2.googleapis.com/token" });
  });

  it("is refused when it is no service account's key", () => {
    expect(() => serviceAccountOf("{}")).toThrow(/FCM_SERVICE_ACCOUNT/);
    expect(() => serviceAccountOf("not json")).toThrow(/FCM_SERVICE_ACCOUNT/);
  });
});

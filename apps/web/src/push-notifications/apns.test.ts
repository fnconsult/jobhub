import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apnsKeyOf, createApnsSender } from "./apns";
import type { PushMessage } from "./messages";

const TOKEN = "a1".repeat(32);
const MESSAGE: PushMessage = { title: "Nouveaux résultats pour une recherche", body: "Ouvrez Jobbbox pour voir les offres trouvées.", path: "/recherches/42" };

/** A `.p8` as Apple gives it: a P-256 key in PKCS #8 PEM. */
function p8() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey };
}

/** A fetch that answers each call in turn (the last one again once they run out), and keeps the calls. */
function fakeFetch(...answers: (() => Response)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return (answers[Math.min(calls.length - 1, answers.length - 1)] ?? (() => new Response(null, { status: 200 })))();
  };
  return { fetch, calls };
}

const apnsError = (status: number, reason: string) => () => new Response(JSON.stringify({ reason }), { status, headers: { "content-type": "application/json" } });

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

/** The provider token's header and claims, and whether its ES256 signature holds for `publicKey`. */
function readJwt(jwt: string, publicKey: ReturnType<typeof p8>["publicKey"]) {
  const [head, claims, signature] = jwt.split(".") as [string, string, string];
  const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  const valid = verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
  return { header: decode(head), claims: decode(claims), valid };
}

describe("APNs (token-based connection, HTTP/2)", () => {
  const now = new Date("2026-11-04T09:00:00.000Z");

  it("posts an alert to the device's token on the production host, signed with a provider token from the .p8", async () => {
    const key = p8();
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 200 }));
    const apns = createApnsSender({ key: key.pem, keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "ai.jobbbox.app", fetch, now: () => now });
    expect(await apns.send({ token: TOKEN, environment: "production" }, MESSAGE)).toEqual({ ok: true });

    const [call] = calls;
    expect(call!.url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    expect(call!.init.method).toBe("POST");
    expect(header(call!.init, "apns-topic")).toBe("ai.jobbbox.app");
    expect(header(call!.init, "apns-push-type")).toBe("alert");
    expect(JSON.parse(String(call!.init.body))).toEqual({ aps: { alert: { title: MESSAGE.title, body: MESSAGE.body }, sound: "default" }, path: "/recherches/42" });

    const jwt = readJwt(header(call!.init, "authorization")!.replace(/^bearer /, ""), key.publicKey);
    expect(jwt.valid).toBe(true);
    expect(jwt.header).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(jwt.claims).toEqual({ iss: "TEAM123456", iat: Math.floor(now.getTime() / 1000) });
  });

  it("sends a development build's token to the sandbox", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 200 }));
    const apns = createApnsSender({ key: p8().pem, keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "ai.jobbbox.app", fetch });
    await apns.send({ token: TOKEN, environment: "development" }, MESSAGE);
    expect(calls[0]!.url).toBe(`https://api.sandbox.push.apple.com/3/device/${TOKEN}`);
  });

  it("signs a provider token once and reuses it for 50 minutes (Apple refuses one refreshed more than every 20)", async () => {
    let clock = now;
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 200 }));
    const apns = createApnsSender({ key: p8().pem, keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "ai.jobbbox.app", fetch, now: () => clock });
    await apns.send({ token: TOKEN, environment: "production" }, MESSAGE);
    clock = new Date(now.getTime() + 49 * 60_000);
    await apns.send({ token: TOKEN, environment: "production" }, MESSAGE);
    clock = new Date(now.getTime() + 51 * 60_000);
    await apns.send({ token: TOKEN, environment: "production" }, MESSAGE);
    const tokens = calls.map((call) => header(call.init, "authorization"));
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[2]).not.toBe(tokens[1]);
  });

  it("signs a new provider token and tries once more when APNs says it expired", async () => {
    let clock = now;
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 200 }), apnsError(403, "ExpiredProviderToken"), () => new Response(null, { status: 200 }));
    const apns = createApnsSender({ key: p8().pem, keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "ai.jobbbox.app", fetch, now: () => clock });
    await apns.send({ token: TOKEN, environment: "production" }, MESSAGE);
    clock = new Date(now.getTime() + 21 * 60_000);
    expect(await apns.send({ token: TOKEN, environment: "production" }, MESSAGE)).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(header(calls[2]!.init, "authorization")).not.toBe(header(calls[1]!.init, "authorization"));
  });

  it("says the token is no longer valid when APNs answers 410 Unregistered", async () => {
    const { fetch } = fakeFetch(apnsError(410, "Unregistered"));
    const apns = createApnsSender({ key: p8().pem, keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "ai.jobbbox.app", fetch });
    expect(await apns.send({ token: TOKEN, environment: "production" }, MESSAGE)).toEqual({ ok: false, reason: "device_token_invalid", tokenInvalid: true, status: 410, message: "Unregistered" });
  });

  it("keeps the token on BadDeviceToken or DeviceTokenNotForTopic: a wrong environment or topic is ours to fix", async () => {
    for (const reason of ["BadDeviceToken", "DeviceTokenNotForTopic"]) {
      const { fetch } = fakeFetch(apnsError(400, reason));
      const apns = createApnsSender({ key: p8().pem, keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "ai.jobbbox.app", fetch });
      expect(await apns.send({ token: TOKEN, environment: "production" }, MESSAGE)).toEqual({ ok: false, reason: "provider_rejected", tokenInvalid: false, status: 400, message: reason });
    }
  });

  it("tells APNs' rate limit and its unavailability apart", async () => {
    const limited = createApnsSender({ key: p8().pem, keyId: "K", teamId: "T", topic: "ai.jobbbox.app", fetch: fakeFetch(apnsError(429, "TooManyRequests")).fetch });
    expect(await limited.send({ token: TOKEN, environment: "production" }, MESSAGE)).toMatchObject({ ok: false, reason: "rate_limited", tokenInvalid: false, status: 429 });
    const down = createApnsSender({ key: p8().pem, keyId: "K", teamId: "T", topic: "ai.jobbbox.app", fetch: fakeFetch(apnsError(503, "ServiceUnavailable")).fetch });
    expect(await down.send({ token: TOKEN, environment: "production" }, MESSAGE)).toMatchObject({ ok: false, reason: "provider_unavailable", status: 503 });
  });
});

describe("the .p8 entered as a Provider Secret", () => {
  it("is read as Apple gives it, or pasted on one line, or without its armour", () => {
    const { pem } = p8();
    const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    expect(apnsKeyOf(pem)).toBe(apnsKeyOf(pem.replace(/\n/g, " ")));
    expect(apnsKeyOf(body)).toBe(apnsKeyOf(pem));
    expect(apnsKeyOf(pem)).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
  });

  it("is refused when it is no private key", () => {
    expect(() => apnsKeyOf("not a key")).toThrow(/APNS_AUTH_KEY/);
  });
});

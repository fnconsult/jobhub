/**
 * APNs, Apple's push service (#698), by its token-based connection: a provider token (a JWT signed ES256 with the `.p8`
 * key entered as the APNS_AUTH_KEY Provider Secret, ADR-0020, its Key ID and Apple's Team ID) on HTTP/2, to the
 * production host or, for a development build's token, the sandbox's.
 *
 * Facts from Apple's « Sending notification requests to APNs », « Establishing a token-based connection to APNs » and
 * « Handling notification responses from APNs » (docs/research/issue-698.md): a provider token is reused, refreshed no
 * more than once every 20 minutes and before 60; 410 Unregistered means the token is no longer valid; BadDeviceToken and
 * DeviceTokenNotForTopic mean a wrong environment or topic, kept with their Failure Reason, the token not deleted.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { reasonOfStatus, type PushDevice, type PushOutcome, type PushSender } from "./senders";
import type { PushMessage } from "./messages";

const HOSTS = { production: "https://api.push.apple.com", development: "https://api.sandbox.push.apple.com" } as const;

/** How long a provider token is reused: between Apple's 20 minutes and its 60. */
export const PROVIDER_TOKEN_MINUTES = 50;

/** An HTTP/2 fetch (http2-fetch.ts), or a test's. */
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

export interface ApnsConfig {
  /** The `.p8` key, as Apple gives it (apnsKeyOf reads it however it was pasted). */
  key: string;
  /** The key's Key ID (APNS_KEY_ID). */
  keyId: string;
  /** The Apple developer team's ID (APPLE_TEAM_ID). */
  teamId: string;
  /** The app's bundle identifier. */
  topic: string;
  /** An HTTP/2 fetch: APNs speaks nothing else. */
  fetch: FetchLike;
  now?: () => Date;
}

/**
 * The `.p8` as a PEM private key, however it was pasted: as Apple gives it, on one line, or its base64 alone. Throws when
 * it is not a P-256 private key.
 */
export function apnsKeyOf(value: string): string {
  const body = value.replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const pem = `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("not a P-256 key");
  } catch (error) {
    throw new Error(`APNS_AUTH_KEY is not a .p8 key: ${error instanceof Error ? error.message : String(error)}`);
  }
  return pem;
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A provider token: `{ alg: ES256, kid }`, `{ iss: team, iat }`, signed with the key. */
function providerToken(key: KeyObject, keyId: string, teamId: string, at: Date): string {
  const unsigned = `${base64url({ alg: "ES256", kid: keyId })}.${base64url({ iss: teamId, iat: Math.floor(at.getTime() / 1000) })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

/** APNs' reason for a refusal, from its JSON body; its status when it gave none. */
async function reasonIn(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { reason?: unknown } | null;
  return typeof body?.reason === "string" ? body.reason : `HTTP ${response.status}`;
}

/** Whether the `.p8` can sign a provider token with its Key ID and Team ID: the Provider Secret's connection test, which calls no one. */
export function checkApnsKey(key: string, keyId: string, teamId: string): { ok: true } | { ok: false; detail: string } {
  try {
    providerToken(createPrivateKey(apnsKeyOf(key)), keyId, teamId, new Date());
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export function createApnsSender(config: ApnsConfig): PushSender {
  const now = config.now ?? (() => new Date());
  const key = createPrivateKey(apnsKeyOf(config.key));
  let cached: { token: string; until: number } | undefined;

  const bearer = (fresh = false) => {
    const at = now();
    if (fresh || !cached || at.getTime() >= cached.until) cached = { token: providerToken(key, config.keyId, config.teamId, at), until: at.getTime() + PROVIDER_TOKEN_MINUTES * 60_000 };
    return cached.token;
  };

  const post = (device: PushDevice, message: PushMessage, token: string) =>
    config.fetch(`${HOSTS[device.environment]}/3/device/${device.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${token}`,
        "apns-topic": config.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      // expo-notifications gives the app, as a remote notification's data on iOS, only what is under `body` (#699).
      // `badge` is the icon's badge as a whole number, 0 taking it away (#818).
      body: JSON.stringify({
        aps: { alert: { title: message.title, body: message.body }, sound: "default", ...(message.badge === undefined ? {} : { badge: message.badge }) },
        path: message.path,
        body: { path: message.path },
      }),
    });

  return {
    async send(device, message): Promise<PushOutcome> {
      let response = await post(device, message, bearer());
      if (response.status === 403 && (await reasonIn(response.clone())) === "ExpiredProviderToken") response = await post(device, message, bearer(true));
      if (response.ok) return { ok: true };
      const reason = await reasonIn(response);
      if (response.status === 410 || reason === "Unregistered") return { ok: false, reason: "device_token_invalid", tokenInvalid: true, status: response.status, message: reason };
      return { ok: false, reason: reasonOfStatus(response.status), tokenInvalid: false, status: response.status, message: reason };
    },
  };
}

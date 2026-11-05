/**
 * FCM, Firebase Cloud Messaging (#698), by its HTTP v1 API: one `messages:send` per device, authorised by an OAuth 2.0
 * access token the service account entered as the FCM_SERVICE_ACCOUNT Provider Secret (ADR-0020) gets from Google, for
 * the `firebase.messaging` scope, by a JWT it signs (RS256). The token is reused until shortly before it expires.
 *
 * Not checked against Firebase's pages (docs/research/issue-698.md could not read them): v1 only, the legacy API being
 * shut down; UNREGISTERED (404) means the token is no longer valid; INVALID_ARGUMENT and SENDER_ID_MISMATCH are kept with
 * their Failure Reason, the token not deleted.
 */
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { reasonOfStatus, type PushOutcome, type PushSender } from "./senders";
import type { PushMessage } from "./messages";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const FCM_API = "https://fcm.googleapis.com/v1";
/** How long before its expiry an access token is no longer used. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/** The global fetch, or a test's. */
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

export interface FcmConfig {
  /** The service account's JSON key (serviceAccountOf reads it). */
  serviceAccount: string;
  fetch: FetchLike;
  now?: () => Date;
}

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: KeyObject;
  privateKeyId: string | null;
  tokenUri: string;
}

/** The service account of its JSON key; throws when it is not one. */
export function serviceAccountOf(json: string): ServiceAccount {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT is not a service account's JSON key");
  }
  const { project_id, client_email, private_key, private_key_id, token_uri } = parsed;
  if (typeof project_id !== "string" || typeof client_email !== "string" || typeof private_key !== "string") {
    throw new Error("FCM_SERVICE_ACCOUNT lacks its project_id, client_email or private_key");
  }
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(private_key);
  } catch (error) {
    throw new Error(`FCM_SERVICE_ACCOUNT's private_key cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    projectId: project_id,
    clientEmail: client_email,
    privateKey,
    privateKeyId: typeof private_key_id === "string" ? private_key_id : null,
    tokenUri: typeof token_uri === "string" && token_uri.startsWith("https://") ? token_uri : DEFAULT_TOKEN_URI,
  };
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** The JWT the service account asks its access token with. */
function assertion(account: ServiceAccount, at: Date): string {
  const iat = Math.floor(at.getTime() / 1000);
  const unsigned = `${base64url({ alg: "RS256", typ: "JWT", ...(account.privateKeyId ? { kid: account.privateKeyId } : {}) })}.${base64url({
    iss: account.clientEmail,
    scope: SCOPE,
    aud: account.tokenUri,
    iat,
    exp: iat + 3600,
  })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), account.privateKey).toString("base64url")}`;
}

/** A refusal from Google: its status and what it said. */
class GoogleRefusal {
  constructor(
    readonly status: number,
    readonly message: string,
  ) {}
}

/** FCM's error code (`FcmError.errorCode`), else its status, and its message. */
async function fcmErrorOf(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json().catch(() => null)) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null;
  const code = body?.error?.details?.find((detail) => typeof detail.errorCode === "string")?.errorCode ?? body?.error?.status ?? `HTTP ${response.status}`;
  return { code, message: body?.error?.message ?? "" };
}

export function createFcmSender(config: FcmConfig): PushSender {
  const now = config.now ?? (() => new Date());
  const account = serviceAccountOf(config.serviceAccount);
  let cached: { token: string; until: number } | undefined;

  async function accessToken(fresh = false): Promise<string> {
    const at = now();
    if (!fresh && cached && at.getTime() < cached.until) return cached.token;
    const response = await config.fetch(account.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion(account, at) }).toString(),
    });
    const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
    if (!response.ok || typeof body?.access_token !== "string") {
      throw new GoogleRefusal(response.status, `OAuth: ${[body?.error ?? `HTTP ${response.status}`, body?.error_description].filter(Boolean).join(" ")}`);
    }
    cached = { token: body.access_token, until: at.getTime() + (body.expires_in ?? 3600) * 1000 - EXPIRY_MARGIN_MS };
    return cached.token;
  }

  const post = (token: string, device: string, message: PushMessage) =>
    config.fetch(`${FCM_API}/projects/${encodeURIComponent(account.projectId)}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token: device, notification: { title: message.title, body: message.body }, data: { path: message.path } } }),
    });

  return {
    async send(device, message): Promise<PushOutcome> {
      try {
        let response = await post(await accessToken(), device.token, message);
        if (response.status === 401) response = await post(await accessToken(true), device.token, message);
        if (response.ok) return { ok: true };
        const { code, message: text } = await fcmErrorOf(response);
        const detail = `${code}${text ? `: ${text}` : ""}`;
        if (code === "UNREGISTERED") return { ok: false, reason: "device_token_invalid", tokenInvalid: true, status: response.status, message: detail };
        return { ok: false, reason: reasonOfStatus(response.status), tokenInvalid: false, status: response.status, message: detail };
      } catch (error) {
        if (error instanceof GoogleRefusal) return { ok: false, reason: reasonOfStatus(error.status), tokenInvalid: false, status: error.status, message: error.message };
        throw error;
      }
    },
  };
}

/**
 * The worker's Push notification providers (#698): APNs and FCM built from their Provider Secrets (ADR-0020) as they
 * stand at each send, each call recorded in AI Usage's external APIs under its Tool (never the device's token). A provider
 * is kept while its keys stay the same, so its provider token (APNs) or access token (FCM) is reused, and built again
 * once they change; it is null while its keys are not entered or cannot be read.
 */
import { APP_IDENTIFIER, recordingFetch, type ExternalApiLog } from "@jobhub/shared";
import { createApnsSender } from "./apns";
import { createFcmSender } from "./fcm";
import { createHttp2Fetch, type Http2Fetch } from "./http2-fetch";
import type { PushPlatform, PushSender } from "./senders";

type Env = Record<string, string | undefined>;

export interface PushSendersDeps {
  /** The env with the Provider Secrets over it, as it stands now. */
  env: () => Env;
  externalApis?: ExternalApiLog;
  /** APNs' HTTP/2 connection. Default: one of its own. */
  http2?: Http2Fetch;
  /** FCM's and Google's. Default: the global fetch. */
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;
  log?: (line: string) => void;
}

/** Each platform's provider, as `send` asks for it. */
export function pushSendersFromEnv(deps: PushSendersDeps): () => Record<PushPlatform, PushSender | null> {
  const log = deps.log ?? ((line) => console.warn(line));
  const http2 = deps.http2 ?? createHttp2Fetch();
  const fetch = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const noLog: ExternalApiLog = { record: () => {} };
  const apnsFetch = recordingFetch(http2.fetch, deps.externalApis ?? noLog, { provider: "apns", operation: (method) => `${method} /3/device` });
  const fcmFetch = recordingFetch(fetch, deps.externalApis ?? noLog, {
    provider: "fcm",
    operation: (method, url) => (url.hostname === "fcm.googleapis.com" ? `${method} /v1/projects/messages:send` : `${method} /token`),
  });

  /** A provider built from `values`, kept while they stay the same. */
  function cached(build: (values: string[]) => PushSender, names: string[], what: string): () => PushSender | null {
    let built: { key: string; sender: PushSender | null } | undefined;
    return () => {
      const env = deps.env();
      const values = names.map((name) => env[name]?.trim() ?? "");
      const key = JSON.stringify(values);
      if (built?.key === key) return built.sender;
      let sender: PushSender | null = null;
      if (values.every(Boolean)) {
        try {
          sender = build(values);
        } catch (error) {
          log(`[push-notifications] ${what} is off: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      built = { key, sender };
      return sender;
    };
  }

  const ios = cached(([key, keyId, teamId]) => createApnsSender({ key: key!, keyId: keyId!, teamId: teamId!, topic: APP_IDENTIFIER, fetch: apnsFetch }), ["APNS_AUTH_KEY", "APNS_KEY_ID", "APPLE_TEAM_ID"], "APNs");
  const android = cached(([serviceAccount]) => createFcmSender({ serviceAccount: serviceAccount!, fetch: fcmFetch }), ["FCM_SERVICE_ACCOUNT"], "FCM");
  return () => ({ ios: ios(), android: android() });
}

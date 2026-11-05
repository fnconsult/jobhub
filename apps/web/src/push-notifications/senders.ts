/**
 * The seam between Push notifications and the two providers they go through, directly from the worker (ADR-0076):
 * APNs for iOS and iPadOS (apns.ts), FCM for Android (fcm.ts). Each sends one message to one device and says how it went,
 * in the Failure Reason's terms (ADR-0030), and whether the device's token is no longer valid (the device is then removed).
 */
import type { PushFailureReason } from "@jobhub/shared";
import type { PushMessage } from "./messages";

export const PUSH_PLATFORMS = ["ios", "android"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** The Tool each platform's notifications go through (packages/shared/src/tools.ts). */
const TOOL_OF_PLATFORM = { ios: "apns", android: "fcm" } as const satisfies Record<PushPlatform, string>;

/** The platform a Push notification Tool sends to, or null for any other Tool (its page in the Back Office's Outils). */
export function pushPlatformOfTool(toolId: string): PushPlatform | null {
  return PUSH_PLATFORMS.find((platform) => TOOL_OF_PLATFORM[platform] === toolId) ?? null;
}

/**
 * The APNs environment an iOS token belongs to: a development build's token is the sandbox's, and the other one answers it
 * BadDeviceToken. Android's are always "production".
 */
export const PUSH_ENVIRONMENTS = ["production", "development"] as const;
export type PushEnvironment = (typeof PUSH_ENVIRONMENTS)[number];

/** One device, as a provider is sent to it. */
export interface PushDevice {
  token: string;
  environment: PushEnvironment;
}

/**
 * How sending to one device went. A failure carries its Failure Reason, whether the token is to be deleted (only when the
 * provider says the token is unknown to it: a wrong topic or environment is a configuration error, not the device's),
 * the provider's HTTP status (null: no answer) and its technical message, for the worker's log only.
 */
export type PushOutcome = { ok: true } | { ok: false; reason: PushFailureReason; tokenInvalid: boolean; status: number | null; message: string };

export interface PushSender {
  /** Never throws for a provider's answer; a network error may throw, which counts as provider_unavailable. */
  send(device: PushDevice, message: PushMessage): Promise<PushOutcome>;
}

/** The Failure Reason of a provider's HTTP status, for an answer that said nothing more precise. */
export function reasonOfStatus(status: number | null): PushFailureReason {
  if (status === null || status >= 500) return "provider_unavailable";
  if (status === 429) return "rate_limited";
  return "provider_rejected";
}

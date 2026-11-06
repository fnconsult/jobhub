/**
 * This device's Push notifications (#699, ADR-0076): whether it may notify, asked in context and never at first launch,
 * and its registration on the platform (#698's `/api/account/push-devices`).
 *
 * One module over the system's notifications, the API and the device's storage. `createPushDevice(deps)` answers:
 *  - `permission()`: `allowed`; `notAsked` (the app may ask, after its explanation screen); `declined` (« Pas maintenant »
 *    on that screen: not asked again in context); `refused` (the system's prompt answered no, or notifications turned
 *    off in the device's settings: only the settings can turn them back on, Rappels says how).
 *  - `allow()`: the system's prompt, then the registration once allowed. A prompt swiped away (Android) is no answer.
 *  - `decline()`: « Pas maintenant », kept on the device.
 *  - `sync()`: at each start and return to the foreground, signed in: registers the device's token while allowed (a new
 *    one, as the system rotates it, replacing the old), forgets it once notifications are turned off.
 *  - `forget()`: at sign-out, the device's token is forgotten by the platform.
 * The token last registered is kept on the device to forget it later. Nothing here throws for want of network: what
 * failed is done at the next start.
 */
import type { ApiFetch } from "../api/api";
import type { DeviceStorage } from "../offline/read-cache";

/** What the system says of the app's notifications: `canAskAgain` false once only its settings can allow them. */
export interface SystemPermission {
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
}

/** The system's side (device.ts, expo-notifications): its permission, its prompt, and the device's token for APNs or FCM. */
export interface DeviceNotifications {
  permission(): Promise<SystemPermission>;
  request(): Promise<SystemPermission>;
  token(): Promise<string>;
}

export type PushPermission = "allowed" | "notAsked" | "declined" | "refused";

export interface PushDeviceDeps {
  notifications: DeviceNotifications;
  api: ApiFetch;
  storage: DeviceStorage;
  platform: "ios" | "android";
  /** An iOS development build's token is APNs' sandbox's. */
  environment: "production" | "development";
  /** The app's language, the notifications'. */
  language: () => string;
}

export interface PushDevice {
  permission(): Promise<PushPermission>;
  allow(): Promise<PushPermission>;
  decline(): Promise<void>;
  sync(): Promise<void>;
  forget(): Promise<void>;
}

const DEVICES = "/api/account/push-devices";
/** The token the platform last registered for this device. */
const TOKEN = "push-device.token";
/** « Pas maintenant » on the explanation screen. */
const DECLINED = "push-device.declined";

const permissionOf = (system: SystemPermission, declined: boolean): PushPermission =>
  system.status === "granted" ? "allowed" : system.status === "denied" ? "refused" : declined ? "declined" : "notAsked";

export function createPushDevice({ notifications, api, storage, platform, environment, language }: PushDeviceDeps): PushDevice {
  const send = async (method: "POST" | "DELETE", body: object): Promise<boolean> => {
    try {
      return (await api(DEVICES, { method, body: JSON.stringify(body) })).ok;
    } catch {
      return false;
    }
  };

  /** Forgets the token last registered, if any; whether nothing is left to forget. */
  const forgetToken = async (): Promise<boolean> => {
    const token = await storage.getItem(TOKEN);
    if (!token) return true;
    if (!(await send("DELETE", { token }))) return false;
    await storage.removeItem(TOKEN);
    return true;
  };

  async function sync(): Promise<void> {
    try {
      const system = await notifications.permission();
      if (system.status !== "granted") {
        await forgetToken();
        return;
      }
      const token = await notifications.token();
      const registered = await storage.getItem(TOKEN);
      // A token the system rotated: the old one goes first.
      if (registered && registered !== token && !(await forgetToken())) return;
      if (await send("POST", { platform, token, language: language(), environment })) await storage.setItem(TOKEN, token);
    } catch {
      // The system or the storage failed: the next start tries again.
    }
  }

  return {
    async permission() {
      return permissionOf(await notifications.permission(), (await storage.getItem(DECLINED)) !== null);
    },

    async allow() {
      const system = await notifications.request();
      if (system.status !== "undetermined") await storage.removeItem(DECLINED);
      if (system.status === "granted") await sync();
      return permissionOf(system, false);
    },

    async decline() {
      await storage.setItem(DECLINED, "1");
    },

    sync,

    async forget() {
      try {
        // Signing out removes the session, and the platform the devices tied to it: this only makes sure.
        await forgetToken();
        await storage.removeItem(TOKEN);
      } catch {
        // Nothing more to do: the session's end forgets the device on the platform.
      }
    },
  };
}

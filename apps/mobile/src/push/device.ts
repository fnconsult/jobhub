// Push notifications' side on the device (#699), the only place they reach the system: its permission and prompt, the
// device's token for APNs (iOS) or FCM (Android), the notification tapped, and how one arriving while the app is open
// shows. The token is the platform's own, never an Expo push token: the worker sends to APNs and FCM directly (ADR-0076).
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import type { DeviceNotifications, SystemPermission } from "./push-device";

/** The one Android channel the notifications go to; Android 13+ shows no prompt before a channel exists. */
const CHANNEL = "default";

const IOS_ALLOWED: readonly Notifications.IosAuthorizationStatus[] = [
  Notifications.IosAuthorizationStatus.AUTHORIZED,
  Notifications.IosAuthorizationStatus.PROVISIONAL,
  Notifications.IosAuthorizationStatus.EPHEMERAL,
];

/** The system's answer, read on iOS from its own status, as Expo advises. */
function systemPermission(response: Notifications.NotificationPermissionsStatus): SystemPermission {
  const ios = response.ios?.status;
  if (Platform.OS === "ios" && ios !== undefined) {
    const status = IOS_ALLOWED.includes(ios) ? "granted" : ios === Notifications.IosAuthorizationStatus.DENIED ? "denied" : "undetermined";
    return { status, canAskAgain: status === "undetermined" };
  }
  return { status: response.status as SystemPermission["status"], canAskAgain: response.canAskAgain };
}

/** The channel the notifications go to, named `name` in the device's settings (Android only). */
async function channel(name: string): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL, { name, importance: Notifications.AndroidImportance.DEFAULT });
}

/** The system's notifications, the Android channel named `channelName` (in the app's language). */
export function deviceNotifications(channelName: () => string): DeviceNotifications {
  return {
    permission: async () => systemPermission(await Notifications.getPermissionsAsync()),
    request: async () => {
      await channel(channelName());
      return systemPermission(await Notifications.requestPermissionsAsync());
    },
    token: async () => {
      await channel(channelName());
      return String((await Notifications.getDevicePushTokenAsync()).data);
    },
  };
}

/** A notification arriving while the app is open shows as a banner, without sound or badge. */
export function showNotificationsInForeground(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/**
 * Calls `onTap` with each notification the person taps: the one that opened the app (cold start) once, then each as
 * it is tapped. Returns how to stop.
 */
export function onNotificationTapped(onTap: (response: unknown) => void): () => void {
  const opening = Notifications.getLastNotificationResponse();
  if (opening) {
    Notifications.clearLastNotificationResponse();
    onTap(opening);
  }
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    Notifications.clearLastNotificationResponse();
    onTap(response);
  });
  return () => subscription.remove();
}

/** Calls `onRotate` when the system gives the device a new token. Returns how to stop. */
export function onTokenRotated(onRotate: () => void): () => void {
  const subscription = Notifications.addPushTokenListener(() => onRotate());
  return () => subscription.remove();
}

/** Opens the app's page in the device's settings, where notifications refused can be turned on. */
export function openDeviceSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

/** The badge last set on the app icon while the app runs: null until one is. */
let badgeSet: number | null = null;

/**
 * Sets the app icon's badge to `count`, the Offer box's offers à traiter (#818). iOS shows it only once the person allowed
 * notifications (the permission asks for the badge too). On Android, where a launcher may show none, taking it to 0 also
 * takes the app's notifications out of the tray (expo-notifications' BadgeHelper, docs/research/issue-818.md): done only
 * once a badge was set while the app runs. Never throws.
 */
export async function setIconBadge(count: number): Promise<void> {
  if (count === 0 && badgeSet === null && Platform.OS === "android") return;
  if (await Notifications.setBadgeCountAsync(count).catch(() => false)) badgeSet = count;
}

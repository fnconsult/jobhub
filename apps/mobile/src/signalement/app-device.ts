import type { AppDevice } from "@jobhub/shared";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * The app's version and the system it runs on (#690), what a Signalement says it attaches and states in
 * APP_DEVICE_HEADER: the version built into the app (app.json's, else package.json's) and iOS (iPadOS too) or Android
 * with its version (Android's API level). Null on any other platform.
 */
export function appDevice(): AppDevice | null {
  const system = Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : null;
  if (!system) return null;
  return { version: Constants.expoConfig?.version ?? null, system, systemVersion: String(Platform.Version) };
}

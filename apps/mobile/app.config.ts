// The app's config as EAS resolves it (#704): app.json's, plus what is derived from the repository.
// - The Version is the platform's, the root package.json's (ADR-0063): the Promotion raises it for the web app, the
//   worker and the app at once. The build numbers are EAS's (eas.json, `appVersionSource: remote`).
// - EAS Update: a build takes JavaScript updates only on its channel (eas.json) and only for the same native code
//   (`fingerprint`); a native change makes a new runtime, which reaches people through a store build and its review.
//   Updates come from the app's EAS project, whose id `eas init` gives (docs/ops/mobile.md).
//   EAS Update stays off (app.json's `updates.enabled: false`) until a privacy policy version names Expo, which serves it
//   from the United States: a new recipient outside the EU (ADR-0064, docs/privacy/register.md). Switching it on is a
//   native change, so a store build.
// - Push notifications (#699): the development profile's builds get their tokens from APNs' sandbox, every other build
//   (TestFlight, the stores) from its production; the `aps-environment` entitlement says which.
import type { ConfigContext, ExpoConfig } from "expo/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const platformVersion = (JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string }).version;

/** expo-notifications' plugin with APNs' environment for the build EAS makes (EAS_BUILD_PROFILE). */
function withApnsEnvironment(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  const mode = process.env.EAS_BUILD_PROFILE === "development" ? "development" : "production";
  return plugins?.map((plugin) => (Array.isArray(plugin) && plugin[0] === "expo-notifications" ? [plugin[0], { ...(plugin[1] as object), mode }] : plugin));
}

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const projectId = (config.extra?.eas as { projectId?: string } | undefined)?.projectId;
  return {
    ...(config as ExpoConfig),
    plugins: withApnsEnvironment(config.plugins),
    version: platformVersion,
    runtimeVersion: { policy: "fingerprint" },
    ...(projectId ? { updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` } } : {}),
  };
}

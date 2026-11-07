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
// - The Maestro e2e build (#705, JOBHUB_E2E_BUILD=1, made in CI outside EAS): it talks to the seeded stack on the CI
//   machine, over plain HTTP, so it alone allows it (iOS's local networking, Android's cleartext), and points nowhere else.
import type { ConfigContext, ExpoConfig } from "expo/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const platformVersion = (JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string }).version;

/** expo-notifications' plugin with APNs' environment for the build EAS makes (EAS_BUILD_PROFILE). */
function withApnsEnvironment(plugins: ExpoConfig["plugins"]): ExpoConfig["plugins"] {
  const mode = process.env.EAS_BUILD_PROFILE === "development" ? "development" : "production";
  return plugins?.map((plugin) => (Array.isArray(plugin) && plugin[0] === "expo-notifications" ? [plugin[0], { ...(plugin[1] as object), mode }] : plugin));
}

/** The e2e build's exceptions to HTTPS, for the seeded stack at `EXPO_PUBLIC_WEB_APP_URL` on the CI machine. */
function withLocalStack(config: ExpoConfig): ExpoConfig {
  const url = process.env.EXPO_PUBLIC_WEB_APP_URL ?? "";
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) {
    throw new Error(`An e2e build (JOBHUB_E2E_BUILD) talks only to the stack on localhost, not to ${url || "no address"}`);
  }
  return {
    ...config,
    ios: { ...config.ios, infoPlist: { ...config.ios?.infoPlist, NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } },
    plugins: config.plugins?.map((plugin) =>
      Array.isArray(plugin) && plugin[0] === "expo-build-properties"
        ? [plugin[0], { ...(plugin[1] as { android?: object }), android: { ...(plugin[1] as { android?: object }).android, usesCleartextTraffic: true } }]
        : plugin,
    ),
  };
}

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const projectId = (config.extra?.eas as { projectId?: string } | undefined)?.projectId;
  const resolved: ExpoConfig = {
    ...(config as ExpoConfig),
    plugins: withApnsEnvironment(config.plugins),
    version: platformVersion,
    runtimeVersion: { policy: "fingerprint" },
    ...(projectId ? { updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` } } : {}),
  };
  return process.env.JOBHUB_E2E_BUILD === "1" ? withLocalStack(resolved) : resolved;
}

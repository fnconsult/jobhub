// The app's config as EAS resolves it (#704): app.json's, plus what is derived from the repository.
// - The Version is the platform's, the root package.json's (ADR-0063): the Promotion raises it for the web app, the
//   worker and the app at once. The build numbers are EAS's (eas.json, `appVersionSource: remote`).
// - EAS Update: a build takes JavaScript updates only on its channel (eas.json) and only for the same native code
//   (`fingerprint`); a native change makes a new runtime, which reaches people through a store build and its review.
//   Updates come from the app's EAS project, whose id `eas init` gives (docs/ops/mobile.md).
//   EAS Update stays off (app.json's `updates.enabled: false`) until a privacy policy version names Expo, which serves it
//   from the United States: a new recipient outside the EU (ADR-0064, docs/privacy/register.md). Switching it on is a
//   native change, so a store build.
import type { ConfigContext, ExpoConfig } from "expo/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const platformVersion = (JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version: string }).version;

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const projectId = (config.extra?.eas as { projectId?: string } | undefined)?.projectId;
  return {
    ...(config as ExpoConfig),
    version: platformVersion,
    runtimeVersion: { policy: "fingerprint" },
    ...(projectId ? { updates: { ...config.updates, url: `https://u.expo.dev/${projectId}` } } : {}),
  };
}

// How the app is built, distributed and updated (#704, ADR-0076, ADR-0063), checked against what EAS reads: the app's
// resolved config (app.json through app.config.ts), eas.json, and the GitHub workflow that runs EAS.
import type { ExpoConfig } from "expo/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import appConfig from "../app.config";

const ROOT = join(__dirname, "..", "..", "..");
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8");
const json = (...path: string[]) => JSON.parse(read(...path)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The config EAS resolves: app.json's, then app.config.ts. */
const resolve = (extra: Record<string, unknown> = {}) => {
  const { expo } = json("apps", "mobile", "app.json") as { expo: ExpoConfig };
  return appConfig({ config: { ...expo, extra: { ...expo.extra, ...extra } } } as Parameters<typeof appConfig>[0]);
};
const eas = json("apps", "mobile", "eas.json");

describe("Version", () => {
  it("is the platform's Version, the root package.json's (ADR-0063)", () => {
    expect(resolve().version).toBe(json("package.json").version);
  });

  it("leaves the build numbers to EAS, which raises them at each store build", () => {
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.staging.autoIncrement).toBe(true);
    expect(eas.build.production.autoIncrement).toBe(true);
  });
});

describe("Push notifications' APNs environment (#699)", () => {
  const notifications = (config: ExpoConfig) =>
    (config.plugins ?? []).find((plugin): plugin is [string, { mode?: string }] => Array.isArray(plugin) && plugin[0] === "expo-notifications")?.[1];
  const profile = process.env.EAS_BUILD_PROFILE;
  afterEach(() => {
    if (profile === undefined) delete process.env.EAS_BUILD_PROFILE;
    else process.env.EAS_BUILD_PROFILE = profile;
  });

  it("is APNs' sandbox for the development profile's builds, its production for TestFlight and the stores", () => {
    process.env.EAS_BUILD_PROFILE = "development";
    expect(notifications(resolve())?.mode).toBe("development");
    for (const store of ["staging", "production"]) {
      process.env.EAS_BUILD_PROFILE = store;
      expect(notifications(resolve())?.mode).toBe("production");
    }
  });
});

describe("EAS Build profiles", () => {
  it("are development, staging and production", () => {
    expect(Object.keys(eas.build).sort()).toEqual(["development", "production", "staging"]);
  });

  it("builds a development client for the team's devices, pointing at the Beta", () => {
    expect(eas.build.development).toMatchObject({ developmentClient: true, distribution: "internal" });
    expect(eas.build.development.env.EXPO_PUBLIC_WEB_APP_URL).toBe("https://staging.jobbbox.ai");
    expect(json("apps", "mobile", "package.json").dependencies["expo-dev-client"]).toBeDefined();
  });

  it("points staging at staging.jobbbox.ai, for TestFlight and Play internal testing", () => {
    expect(eas.build.staging).toMatchObject({ distribution: "store", channel: "staging" });
    expect(eas.build.staging.env.EXPO_PUBLIC_WEB_APP_URL).toBe("https://staging.jobbbox.ai");
    expect(eas.submit.staging.android.track).toBe("internal");
    // EAS Submit uploads every iOS build to App Store Connect, where it reaches TestFlight; nothing goes to review.
    expect(eas.submit.staging.ios).toBeDefined();
  });

  it("set the build's whole address in one variable, which the app reads in one place (src/web-app-url.ts)", () => {
    for (const profile of Object.values(eas.build as Record<string, { env: Record<string, string> }>)) {
      expect(Object.keys(profile.env).filter((key) => key.startsWith("EXPO_PUBLIC_"))).toEqual(["EXPO_PUBLIC_WEB_APP_URL"]);
    }
    const src = join(ROOT, "apps", "mobile", "src");
    const readers = (readdirSync(src, { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => /process\.env\.EXPO_PUBLIC_|webOrigin/.test(readFileSync(join(src, file), "utf8")));
    // The crash reports DSN (#703) is the one other build-time variable: EAS secret or apps/mobile/.env, never a profile value.
    expect(readers.sort()).toEqual(["app/_layout.tsx", "web-app-url.ts"]);
    expect(json("apps", "mobile", "app.json").expo.extra?.webOrigin).toBeUndefined();
  });

  // The @sentry/react-native config plugin (#703) uploads a release build's source maps and debug files to Sentry from
  // Xcode (scripts/sentry-xcode.sh, sentry-xcode-debug-files.sh) and Gradle (sentry.gradle.kts); without SENTRY_AUTH_TOKEN,
  // SENTRY_ORG and SENTRY_PROJECT the upload fails and fails the build. Debug builds (development) skip it on their own.
  it("build a store release without Sentry's credentials: the source maps upload stays off until the Sentry project exists (#703)", () => {
    for (const name of ["staging", "production"]) {
      // The scripts compare the value with the string `true`.
      expect({ name, upload: eas.build[name].env.SENTRY_DISABLE_AUTO_UPLOAD }).toEqual({ name, upload: "true" });
    }
    const doc = read("docs", "ops", "mobile.md");
    for (const words of ["SENTRY_DISABLE_AUTO_UPLOAD", "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"]) expect(doc).toContain(words);
  });

  it("points production at jobbbox.ai, on the stores' production track", () => {
    expect(eas.build.production).toMatchObject({ distribution: "store", channel: "production" });
    expect(eas.build.production.env.EXPO_PUBLIC_WEB_APP_URL).toBe("https://jobbbox.ai");
    expect(eas.submit.production.android.track).toBe("production");
  });
});

describe("The Maestro e2e build (#705)", () => {
  const saved = { flag: process.env.JOBHUB_E2E_BUILD, url: process.env.EXPO_PUBLIC_WEB_APP_URL };
  afterEach(() => {
    for (const [name, value] of [["JOBHUB_E2E_BUILD", saved.flag], ["EXPO_PUBLIC_WEB_APP_URL", saved.url]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const buildProperties = (config: ExpoConfig) =>
    (config.plugins ?? []).find((plugin): plugin is [string, { android?: Record<string, unknown> }] => Array.isArray(plugin) && plugin[0] === "expo-build-properties")?.[1];
  const e2eBuild = (url: string) => {
    process.env.JOBHUB_E2E_BUILD = "1";
    process.env.EXPO_PUBLIC_WEB_APP_URL = url;
    return resolve();
  };

  it("reaches the seeded stack on the CI machine over plain HTTP: iOS's local networking, Android's cleartext", () => {
    const config = e2eBuild("http://localhost:3705");
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({ NSAllowsLocalNetworking: true });
    expect(buildProperties(config)?.android).toEqual({ minSdkVersion: 24, usesCleartextTraffic: true });
    // The rest of the Info.plist stays app.json's.
    expect(config.ios?.infoPlist?.UISupportedInterfaceOrientations).toEqual(["UIInterfaceOrientationPortrait"]);
  });

  it("is never what a store build gets: no plain HTTP without JOBHUB_E2E_BUILD", () => {
    delete process.env.JOBHUB_E2E_BUILD;
    const config = resolve();
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toBeUndefined();
    expect(buildProperties(config)?.android).toEqual({ minSdkVersion: 24 });
    for (const profile of Object.values(eas.build as Record<string, { env: Record<string, string> }>)) expect(profile.env.JOBHUB_E2E_BUILD).toBeUndefined();
  });

  it("points only at the machine it runs on", () => {
    expect(() => e2eBuild("https://staging.jobbbox.ai")).toThrow(/localhost/);
    expect(() => e2eBuild("http://192.168.1.20:3000")).toThrow(/localhost/);
    expect(() => e2eBuild("http://127.0.0.1:3705")).not.toThrow();
  });
});

describe("EAS Update", () => {
  it("has a staging channel and a production channel, the only ones a build listens to", () => {
    const channels = Object.values(eas.build as Record<string, { channel?: string }>).flatMap((profile) => profile.channel ?? []);
    expect(channels.sort()).toEqual(["production", "staging"]);
    expect(json("apps", "mobile", "package.json").dependencies["expo-updates"]).toBeDefined();
  });

  it("reaches only a build with the same native code: a native change makes a new runtime, which goes through the stores' review", () => {
    expect(resolve().runtimeVersion).toEqual({ policy: "fingerprint" });
  });

  // EAS Update is served by Expo (650 Industries, United States): each launch sends Expo the install's EAS-Client-ID, its
  // IP address, platform and runtime version. A new recipient outside the EU comes after the privacy policy version that
  // names it (ADR-0064, docs/privacy/register.md « EAS Update in the Jobbbox app »).
  it("stays off in the builds until a privacy policy version names Expo, its recipient outside the EU (ADR-0064)", () => {
    const policies = join(ROOT, "packages", "help", "legal", "confidentialite");
    const namesExpo = readdirSync(policies)
      .filter((file) => file.endsWith(".fr.md"))
      .some((file) => /\bExpo\b/.test(readFileSync(join(policies, file), "utf8")));
    const updatesOn = resolve({ eas: { projectId: "0f7c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f" } }).updates?.enabled !== false;
    expect({ updatesOn, namesExpo }).not.toEqual({ updatesOn: true, namesExpo: false });
  });

  it("fetches its updates from the app's EAS project", () => {
    expect(resolve({ eas: { projectId: "0f7c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f" } }).updates?.url).toBe(
      "https://u.expo.dev/0f7c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
    );
  });
});

describe("The mobile.yml workflow, which runs EAS from GitHub", () => {
  const workflow = () => read(".github", "workflows", "mobile.yml");
  const triggers = () => workflow().split(/^jobs:/m)[0]!;

  it("runs by hand (workflow_dispatch), never on a push", () => {
    expect(triggers()).toMatch(/^\s+workflow_dispatch:/m);
    expect(triggers()).not.toMatch(/^\s+push:/m);
  });

  it("builds or publishes an update for a profile: staging, or production", () => {
    expect(workflow()).toMatch(/profile:[\s\S]*options: \[staging, production\]/);
    expect(workflow()).toMatch(/eas build --profile "\$PROFILE"/);
    expect(workflow()).toMatch(/--auto-submit-with-profile "\$PROFILE"/);
    expect(workflow()).toMatch(/eas update --channel "\$PROFILE"/);
  });

  it("builds production only from a Version's tag, which only the Promotion pushes (ADR-0063)", () => {
    expect(workflow()).toContain('[ "$PROFILE" = production ] && ! [[ "$GITHUB_REF" =~ ^refs/tags/v[0-9]+\\.[0-9]+\\.[0-9]+$ ]]');
  });

  it("publishes an update with its profile's address, as the profile's builds have it", () => {
    expect(workflow()).toContain(`EXPO_PUBLIC_WEB_APP_URL=$(jq -r --arg profile "$PROFILE" '.build[$profile].env.EXPO_PUBLIC_WEB_APP_URL' eas.json)`);
    expect(workflow()).toMatch(/export EXPO_PUBLIC_WEB_APP_URL\n\s+eas update/);
  });

  it("refuses to publish an update while EAS Update is off in the builds", () => {
    expect(workflow()).toContain(`if [ "$(jq -r '.expo.updates.enabled' app.json)" = false ]; then`);
  });

  it("reads EAS's token from the repository's secrets", () => {
    expect(workflow()).toContain("EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}");
  });

  it("writes the stores' « Nouveautés » from the Version's Release Note", () => {
    expect(workflow()).toContain("npm run store-whats-new -w @jobhub/help --");
  });

  it("is documented in docs/ops/mobile.md: builds, channels, the forced update", () => {
    const doc = read("docs", "ops", "mobile.md");
    for (const words of ["mobile.yml", "EXPO_TOKEN", "eas.json", "staging", "production", "fingerprint", "426", "Mettre à jour Jobbbox"]) expect(doc).toContain(words);
  });
});

describe("The deploy-staging skill", () => {
  it("mentions the app's staging build, and leaves launching it to the product owner", () => {
    const skill = read(".claude", "skills", "deploy-staging", "SKILL.md");
    expect(skill).toContain("mobile.yml");
    expect(skill).toMatch(/ne la lance(z)? pas/i);
  });
});

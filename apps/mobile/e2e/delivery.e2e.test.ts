// How the app is built, distributed and updated (#704, ADR-0076, ADR-0063), checked against what EAS reads: the app's
// resolved config (app.json through app.config.ts), eas.json, and the GitHub workflow that runs EAS.
import type { ExpoConfig } from "expo/config";
import { readFileSync } from "node:fs";
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

describe("EAS Build profiles", () => {
  it("are development, staging and production", () => {
    expect(Object.keys(eas.build).sort()).toEqual(["development", "production", "staging"]);
  });

  it("builds a development client for the team's devices, pointing at the Beta", () => {
    expect(eas.build.development).toMatchObject({ developmentClient: true, distribution: "internal" });
    expect(eas.build.development.env.EXPO_PUBLIC_API_URL).toBe("https://staging.jobbbox.ai");
    expect(json("apps", "mobile", "package.json").dependencies["expo-dev-client"]).toBeDefined();
  });

  it("points staging at staging.jobbbox.ai, for TestFlight and Play internal testing", () => {
    expect(eas.build.staging).toMatchObject({ distribution: "store", channel: "staging" });
    expect(eas.build.staging.env.EXPO_PUBLIC_API_URL).toBe("https://staging.jobbbox.ai");
    expect(eas.submit.staging.android.track).toBe("internal");
    // EAS Submit uploads every iOS build to App Store Connect, where it reaches TestFlight; nothing goes to review.
    expect(eas.submit.staging.ios).toBeDefined();
  });

  it("points production at jobbbox.ai, on the stores' production track", () => {
    expect(eas.build.production).toMatchObject({ distribution: "store", channel: "production" });
    expect(eas.build.production.env.EXPO_PUBLIC_API_URL).toBe("https://jobbbox.ai");
    expect(eas.submit.production.android.track).toBe("production");
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

  it("fetches its updates from the app's EAS project", () => {
    expect(resolve({ eas: { projectId: "0f7c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f" } }).updates?.url).toBe(
      "https://u.expo.dev/0f7c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
    );
  });
});

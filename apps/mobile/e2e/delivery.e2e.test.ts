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

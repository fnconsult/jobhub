// The app's project-level acceptance criteria (#683), checked against what the toolchain and the stores read:
// app.json, the npm workspaces, the lint and typecheck commands, the shared tokens and translations.
import { designTokens } from "@jobhub/shared/design/tokens";
import { createI18n } from "@jobhub/shared/i18n";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8");
const json = (...path: string[]) => JSON.parse(read(...path)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const expo = json("apps", "mobile", "app.json").expo;
const pkg = json("apps", "mobile", "package.json");

jest.setTimeout(120_000);

describe("Stack", () => {
  it("is Expo SDK 58 with Expo Router, in the npm workspaces", () => {
    expect(pkg.dependencies.expo).toMatch(/^~58\./);
    expect(pkg.dependencies["expo-router"]).toBeDefined();
    expect(pkg.main).toBe("expo-router/entry");
    expect(json("package.json").workspaces).toContain("apps/*");
    expect(pkg.name).toBe("@jobhub/mobile");
  });

  it("is TypeScript strict", () => {
    const tsconfig = json("apps", "mobile", "tsconfig.json");
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("is covered by the root typecheck, which runs every workspace's", () => {
    expect(json("package.json").scripts.typecheck).toContain("--workspaces");
    expect(pkg.scripts.typecheck).toBeDefined();
  });

  it("is covered by the root lint, whose no-literal-string rule rejects a hard-coded string in the app", () => {
    const probe = 'import { Text } from "react-native";\nexport const Probe = () => <Text>Bonjour tout le monde</Text>;\n';
    let output = "";
    try {
      execFileSync("npx", ["eslint", "--stdin", "--stdin-filename", "apps/mobile/src/probe.tsx", "--format", "json"], { cwd: ROOT, input: probe, encoding: "utf8" });
    } catch (error) {
      output = (error as { stdout: string }).stdout;
    }
    const rules = (JSON.parse(output)[0].messages as { ruleId: string }[]).map((message) => message.ruleId);
    expect(rules).toContain("i18next/no-literal-string");
  });
});

describe("Identity", () => {
  it("is named Jobbbox, ai.jobbbox.app on iOS and Android", () => {
    expect(expo.name).toBe("Jobbbox");
    expect(expo.ios.bundleIdentifier).toBe("ai.jobbbox.app");
    expect(expo.android.package).toBe("ai.jobbbox.app");
  });

  it("supports Android 7 (API 24)", () => {
    const buildProperties = expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-build-properties");
    expect(buildProperties[1].android.minSdkVersion).toBe(24);
  });

  // iOS/iPadOS 16.4+ on Expo SDK 58: the product owner's decision of 2026-11-04 (#683), recorded in ADR-0076.
  it("targets iOS and iPadOS 16.4", () => {
    expect(expo.ios.deploymentTarget).toBe("16.4");
  });

  it("targets the iOS floor ADR-0076 states, so the decision and the build cannot drift apart", () => {
    const adr = read("docs", "adr", "0076-native-app-a-companion-on-expo-same-api-and-session.md");
    const floors = [...adr.matchAll(/iOS and iPadOS (\d+(?:\.\d+)?)\+/g)].map((match) => match[1]);
    expect(floors.length).toBeGreaterThan(0);
    expect(new Set(floors)).toEqual(new Set([expo.ios.deploymentTarget]));
  });

  it("targets exactly the iOS floor of the installed Expo native core, below which the build fails", () => {
    const podspec = readFileSync(join(dirname(require.resolve("expo-modules-core/package.json")), "ExpoModulesCore.podspec"), "utf8");
    expect(podspec.match(/:ios\s*=>\s*'([\d.]+)'/)?.[1]).toBe(expo.ios.deploymentTarget);
  });

  it("supports tablets, which rotate freely, and locks iPhones to portrait", () => {
    expect(expo.ios.supportsTablet).toBe(true);
    expect(expo.orientation).toBe("default");
    expect(expo.ios.infoPlist.UISupportedInterfaceOrientations).toEqual(["UIInterfaceOrientationPortrait"]);
  });

  it("follows the system's light or dark theme", () => {
    expect(expo.userInterfaceStyle).toBe("automatic");
  });
});

describe("Crash reports, and nothing that follows anyone (#703)", () => {
  const layout = () => read("apps", "mobile", "src", "app", "_layout.tsx");

  it("reports crashes with Sentry, its config plugin in the build", () => {
    expect(pkg.dependencies["@sentry/react-native"]).toBeDefined();
    expect(expo.plugins).toContain("@sentry/react-native");
    expect(read("apps", "mobile", "metro.config.js")).toContain("getSentryExpoConfig");
  });

  it("starts them at launch from the build's configuration, not a DSN written in the code, and never in development", () => {
    expect(layout()).toMatch(/startCrashReports\(\{\s*dsn: process\.env\.EXPO_PUBLIC_SENTRY_DSN,\s*development: __DEV__\s*\}\)/);
    const files = execFileSync("git", ["ls-files", "apps/mobile"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
    const withDsn = files.filter((file) => !/\.test\.tsx?$/.test(file) && /@[\w.-]*ingest[\w.-]*sentry\.io\/\d/.test(read(file)));
    expect(withDsn).toEqual([]);
  });

  it("never asks for App Tracking Transparency: no tracking usage description, no tracking, ads or analytics package", () => {
    expect(JSON.stringify(expo)).not.toContain("NSUserTrackingUsageDescription");
    expect(JSON.stringify(expo)).not.toMatch(/tracking-transparency|AdSupport|advertising/i);
    const dependencies = Object.keys(pkg.dependencies);
    expect(dependencies.filter((name) => /tracking|analytics|ads|advertising|amplitude|mixpanel|segment|firebase|facebook|fbsdk|appsflyer|adjust|branch/i.test(name))).toEqual([]);
  });

  // Sentry receives data from the device, not from the server: the register's own test only knows the Tool catalog
  // (apps/web/src/tools/privacy-register.test.ts), so this one keeps the app's sub-processor from slipping past it.
  it("has its entry in the privacy register, Sentry named as processor, the crash data stored in the EU", () => {
    const entry = read("docs", "privacy", "register.md").split(/^## /m).find((section) => section.startsWith("Crash reports"));
    expect(entry).toBeDefined();
    const row = (name: string) => entry!.match(new RegExp(`^\\| ${name} \\| (.+) \\|$`, "m"))?.[1] ?? "";
    for (const name of ["Purpose", "Legal basis", "Data", "Processors", "Storage", "Retention", "Security"]) expect(row(name)).not.toBe("");
    expect(row("Legal basis")).toMatch(/6\(1\)\(f\)/);
    expect(row("Processors")).toMatch(/Sentry/);
    expect(row("Storage")).toMatch(/Frankfurt/);
  });

  it("builds an Info.plist, every config plugin applied, without the tracking usage description the prompt needs", () => {
    const config = JSON.parse(
      execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], { cwd: join(ROOT, "apps", "mobile"), encoding: "utf8" }),
    );
    expect(config.ios.infoPlist.CFBundleIdentifier).toBeDefined();
    expect(config.ios.infoPlist).not.toHaveProperty("NSUserTrackingUsageDescription");
    expect(config.android.permissions ?? []).not.toContain("com.google.android.gms.permission.AD_ID");
  });
});

describe("Design tokens, Inter, Lucide and translations", () => {
  it("reads its type scale from @jobhub/shared's Confort Density, body text at the 16 pt floor", () => {
    expect(designTokens.density.confort.fontSize.body).toBeGreaterThanOrEqual(16);
    expect(read("apps", "mobile", "src", "theme", "theme.tsx")).toContain("designTokens.density.confort");
  });

  it("bundles Inter's three weights and draws icons with Lucide", () => {
    expect(pkg.dependencies["@expo-google-fonts/inter"]).toBeDefined();
    expect(pkg.dependencies["lucide-react-native"]).toBeDefined();
    expect(read("apps", "mobile", "src", "app", "_layout.tsx")).toMatch(/Inter_400Regular[\s\S]*Inter_600SemiBold[\s\S]*Inter_700Bold/);
  });

  it("speaks French by default, and English", () => {
    expect(createI18n(undefined).t("account.humanCoaches")).toBe("Mes coachs humains");
    expect(createI18n("fr").t("conversationFirst.newConversation")).toBe("Nouvelle conversation");
    expect(createI18n("en").t("conversationFirst.newConversation")).not.toBe("Nouvelle conversation");
  });
});

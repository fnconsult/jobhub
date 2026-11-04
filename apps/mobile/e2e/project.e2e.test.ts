// The app's project-level acceptance criteria (#683), checked against what the toolchain and the stores read:
// app.json, the npm workspaces, the lint and typecheck commands, the shared tokens and translations.
import { designTokens } from "@jobhub/shared/design/tokens";
import { createI18n } from "@jobhub/shared/i18n";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  // The criterion says iOS/iPadOS 15.1+; Expo SDK 58 requires 16.4, so the target is 16.4 until the product owner decides.
  it("targets the oldest iOS the current Expo SDK supports (16.4), a deviation from 15.1 awaiting the product owner", () => {
    expect(expo.ios.deploymentTarget).toBe("16.4");
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

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

// « Ajouter au calendrier » (#693, ADR-0029): the app writes to the calendar through the system's sheets and never reads it.
describe("Calendar", () => {
  const introspected = () =>
    JSON.parse(execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], { cwd: join(ROOT, "apps", "mobile"), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));

  it("asks iOS for write-only calendar access, never full access, and Android for no calendar permission", () => {
    const config = introspected();
    const infoPlist = config.ios.infoPlist as Record<string, string>;
    expect(infoPlist.NSCalendarsWriteOnlyAccessUsageDescription).toMatch(/ne lit pas votre calendrier/);
    expect(infoPlist.NSCalendarsFullAccessUsageDescription).toBeUndefined();
    const permissions = (config._internal.modResults.android.manifest.manifest["uses-permission"] as { $: Record<string, string> }[]).filter((permission) =>
      /CALENDAR/.test(permission.$["android:name"]!),
    );
    expect(permissions.length).toBeGreaterThan(0);
    for (const permission of permissions) expect(permission.$["tools:node"]).toBe("remove");
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

describe("App lock (#702)", () => {
  const plugin = (name: string) => expo.plugins.find((entry: unknown) => entry === name || (Array.isArray(entry) && entry[0] === name));

  // Without NSFaceIDUsageDescription, an iPhone with Face ID would ask for the device's code instead.
  it("gives iOS its reason for Face ID, so the lock asks for Face ID and not only the code", () => {
    const localAuthentication = plugin("expo-local-authentication");
    expect(Array.isArray(localAuthentication)).toBe(true);
    expect(localAuthentication[1].faceIDPermission).toMatch(/Face ID/);
  });

  it("uses the SDK's own versions of the lock's native modules", () => {
    const bundled = json("node_modules", "expo", "bundledNativeModules.json");
    for (const name of ["expo-local-authentication", "expo-screen-capture", "expo-secure-store"]) expect(pkg.dependencies[name]).toBe(bundled[name]);
  });
});

describe("Multitasking and foldables (#700)", () => {
  type Manifest = ReturnType<typeof templateManifest>;
  const plugin = () =>
    jest.requireActual<{ setInfoPlist: (plist: Record<string, unknown>) => Record<string, unknown>; setAndroidManifest: (manifest: Manifest) => Manifest }>(
      join(ROOT, "apps", "mobile", "plugins", "with-multitasking.js"),
    );
  /** The main activity as Expo's Android template declares it before any plugin. */
  const templateManifest = () => ({
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      application: [
        {
          $: { "android:name": ".MainApplication" },
          activity: [{ $: { "android:name": ".MainActivity", "android:configChanges": "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode" } }],
        },
      ],
    },
  });
  const mainActivity = (manifest: Manifest) => manifest.manifest.application[0]!.activity[0]!.$ as Record<string, string>;

  it("is applied by the app's config", () => {
    expect(expo.plugins).toContain("./plugins/with-multitasking");
  });

  it("never requires the full screen on iPad, so Split View, Slide Over and Stage Manager can share it", () => {
    expect(expo.ios.requireFullScreen).toBe(false);
    expect(expo.ios.infoPlist.UIRequiresFullScreen).toBeUndefined();
    expect(plugin().setInfoPlist({ UIRequiresFullScreen: true }).UIRequiresFullScreen).toBe(false);
  });

  it("supports the iPad's four orientations, which iPad multitasking requires, iPhones staying in portrait", () => {
    const plist = plugin().setInfoPlist({ UISupportedInterfaceOrientations: ["UIInterfaceOrientationPortrait"] });
    expect(plist["UISupportedInterfaceOrientations~ipad"]).toEqual([
      "UIInterfaceOrientationPortrait",
      "UIInterfaceOrientationPortraitUpsideDown",
      "UIInterfaceOrientationLandscapeLeft",
      "UIInterfaceOrientationLandscapeRight",
    ]);
    expect(plist.UISupportedInterfaceOrientations).toEqual(["UIInterfaceOrientationPortrait"]);
  });

  it("lets Android resize the window, in split screen, a free-form window or on a foldable", () => {
    expect(mainActivity(plugin().setAndroidManifest(templateManifest()))["android:resizeableActivity"]).toBe("true");
  });

  it("keeps Android's activity, and so the conversation and its position, when a foldable opens or closes or the window resizes", () => {
    const changes = mainActivity(plugin().setAndroidManifest(templateManifest()))["android:configChanges"]!.split("|");
    for (const change of ["orientation", "screenSize", "smallestScreenSize", "screenLayout", "keyboard", "keyboardHidden", "uiMode"]) expect(changes).toContain(change);
    expect(new Set(changes).size).toBe(changes.length);
  });
});

describe("The hardware keyboard's native module (#700)", () => {
  const moduleDir = ["apps", "mobile", "modules", "key-commands"];
  const config = () => json(...moduleDir, "expo-module.config.json");
  const nameIn = (...path: string[]) => read(...moduleDir, ...path).match(/Name\("([^"]+)"\)/)?.[1];

  it("is a local Expo module for iOS and Android, which Expo autolinks from modules/", () => {
    expect(config().platforms).toEqual(["apple", "android"]);
    expect(config().apple.modules).toEqual(["KeyCommandsModule"]);
    expect(config().android.modules).toEqual(["ai.jobbbox.keycommands.KeyCommandsModule"]);
  });

  it("goes by the name the app asks for, on both platforms", () => {
    const asked = read(...moduleDir, "index.ts").match(/requireOptionalNativeModule<\w+>\("([^"]+)"\)/)?.[1];
    expect(asked).toBe("JobbboxKeyCommands");
    expect(nameIn("ios", "KeyCommandsModule.swift")).toBe(asked);
    expect(nameIn("android", "src", "main", "java", "ai", "jobbbox", "keycommands", "KeyCommandsModule.kt")).toBe(asked);
  });

  it("lists each shortcut under its title in the iPad's ⌘ panel and Android's Keyboard Shortcuts Helper", () => {
    expect(read(...moduleDir, "ios", "KeyCommandsModule.swift")).toContain("discoverabilityTitle = title");
    expect(read(...moduleDir, "android", "src", "main", "java", "ai", "jobbbox", "keycommands", "KeyCommandsModule.kt")).toContain("onProvideKeyboardShortcuts");
  });
});

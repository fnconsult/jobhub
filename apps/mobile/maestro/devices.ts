/**
 * The devices the app's Maestro flows run on in CI (#705), and what each run sets up and expects. One CI job boots one
 * simulator or emulator (`CI_HARDWARE`); on it, each of its devices (a window of that hardware: an orientation, Split
 * View, a fold) runs three times:
 *
 * - every flow (tag `flow`) and the key screens (tag `key-screens`), light theme, default text size;
 * - the key screens again in the dark theme;
 * - the key screens again at the system's largest text size, where the shell opens its columns full page.
 *
 * The key screens are compared with their reference captures (`captures/<device>/<theme>[-largest-text]/`), drawn and
 * compared on CI's simulators only (as ADR-0061 does for the web). The layout a run expects is the shell's own
 * (`disposition`), for the window the device gives the app: the flows check the app lays itself out that way.
 */
import { disposition } from "../src/shell/disposition";

export type Platform = "ios" | "android";
export type Theme = "light" | "dark";
export type TextSize = "default" | "largest";
export type HardwareId = "iphone-se" | "ipad" | "android-tablet" | "android-foldable";

/** A simulator or emulator one CI job boots: an iOS device type, or an Android AVD device profile. */
export type Hardware = { id: HardwareId; platform: Platform; model: string };

export const CI_HARDWARE: Record<HardwareId, Hardware> = {
  "iphone-se": { id: "iphone-se", platform: "ios", model: "iPhone SE (3rd generation)" },
  ipad: { id: "ipad", platform: "ios", model: "iPad Pro 13-inch (M4)" },
  "android-tablet": { id: "android-tablet", platform: "android", model: "pixel_tablet" },
  "android-foldable": { id: "android-foldable", platform: "android", model: "pixel_fold" },
};

/** The name the CI job gives the iOS simulator it creates (mobile-e2e.yml). */
export const SIMULATOR = "maestro";

/** How the app's window sits on the hardware: the whole screen, half of it in Split View, a foldable closed or open. */
export type Window = "full" | "split-half" | "folded" | "unfolded";

/** Maestro's `setOrientation`, or "" to leave the hardware's own (Android's tablets and foldables). */
export type Orientation = "PORTRAIT" | "LANDSCAPE_LEFT" | "";

export type Device = {
  id: string;
  hardware: HardwareId;
  window: Window;
  orientation: Orientation;
  /** The app's window, in points (dp on Android), at the default text size. */
  size: { width: number; height: number };
  /** The store screenshots its light captures stand for (#708), if any. */
  store?: string;
};

export const DEVICES: readonly Device[] = [
  { id: "iphone-se", hardware: "iphone-se", window: "full", orientation: "PORTRAIT", size: { width: 375, height: 667 }, store: "App Store, iPhone 4,7 pouces" },
  { id: "ipad-landscape", hardware: "ipad", window: "full", orientation: "LANDSCAPE_LEFT", size: { width: 1376, height: 1032 }, store: "App Store, iPad 13 pouces" },
  { id: "ipad-portrait", hardware: "ipad", window: "full", orientation: "PORTRAIT", size: { width: 1032, height: 1376 }, store: "App Store, iPad 13 pouces" },
  // Half of the landscape screen, less the divider between the two apps.
  { id: "ipad-split-half", hardware: "ipad", window: "split-half", orientation: "LANDSCAPE_LEFT", size: { width: 683, height: 1032 } },
  { id: "android-tablet", hardware: "android-tablet", window: "full", orientation: "", size: { width: 1280, height: 800 }, store: "Google Play, tablette 10 pouces" },
  { id: "foldable-unfolded", hardware: "android-foldable", window: "unfolded", orientation: "", size: { width: 841, height: 701 } },
  { id: "foldable-folded", hardware: "android-foldable", window: "folded", orientation: "", size: { width: 411, height: 797 }, store: "Google Play, téléphone" },
];

/**
 * The system's largest text size, as React Native's `fontScale` reads it: iOS's largest accessibility size
 * (AX5, « accessibility-extra-extra-extra-large ») and Android's 200 %.
 */
const LARGEST_FONT_SCALE: Record<Platform, number> = { ios: 3.571, android: 2 };

export type Run = {
  device: Device;
  platform: Platform;
  theme: Theme;
  textSize: TextSize;
  /** The Maestro tags this run includes. */
  tags: readonly ("flow" | "key-screens")[];
  /** The shell's layout the flows expect: columns beside the conversation, or each pane full page. */
  layout: "columns" | "fullPage";
  /** Commands that set the device up, run in order before the flows. */
  setup: string[][];
  /** What the flows read (`maestro test --env KEY=value`). */
  env: Record<string, string>;
};

const RUNS: readonly { theme: Theme; textSize: TextSize; tags: Run["tags"] }[] = [
  { theme: "light", textSize: "default", tags: ["flow", "key-screens"] },
  { theme: "dark", textSize: "default", tags: ["key-screens"] },
  { theme: "light", textSize: "largest", tags: ["key-screens"] },
];

/** The runs of one CI job, device after device. */
export function runsOn(hardwareId: HardwareId): Run[] {
  const { platform } = CI_HARDWARE[hardwareId];
  return DEVICES.filter((device) => device.hardware === hardwareId).flatMap((device) =>
    RUNS.map(({ theme, textSize, tags }) => {
      const fontScale = textSize === "largest" ? LARGEST_FONT_SCALE[platform] : 1;
      const layout = disposition({ width: device.size.width, fontScale }, { sidebar: true, pane: null, workPane: false }).panes;
      return {
        device,
        platform,
        theme,
        textSize,
        tags,
        layout,
        setup: platform === "ios" ? iosSetup(theme, textSize) : androidSetup(device, theme, textSize),
        env: {
          DEVICE: device.id,
          PLATFORM: platform,
          THEME: theme,
          TEXT_SIZE: textSize,
          LAYOUT: layout,
          ORIENTATION: device.orientation,
          WINDOW: device.window,
          CAPTURE_DIR: `${device.id}/${theme}${textSize === "largest" ? "-largest-text" : ""}`,
        },
      };
    }),
  );
}

/**
 * Once the hardware is booted, before its runs: French, the app's default language, whose labels the flows look for
 * (the app speaks the device's language, src/i18n.ts). An emulator's framework restarts to take its new locale.
 */
export function bootSetup(hardwareId: HardwareId): string[][] {
  if (CI_HARDWARE[hardwareId].platform === "ios") {
    return [
      ["xcrun", "simctl", "spawn", SIMULATOR, "defaults", "write", "-g", "AppleLanguages", "-array", "fr-FR"],
      ["xcrun", "simctl", "spawn", SIMULATOR, "defaults", "write", "-g", "AppleLocale", "-string", "fr_FR"],
      // The system reads them as it boots.
      ["xcrun", "simctl", "shutdown", SIMULATOR],
      ["xcrun", "simctl", "boot", SIMULATOR],
      ["xcrun", "simctl", "bootstatus", SIMULATOR, "-b"],
    ];
  }
  return [
    // adbd restarts as root and may drop the connection that asked: what follows waits for it.
    ["sh", "-c", "adb root || true"],
    ["adb", "wait-for-device"],
    ["adb", "shell", "setprop", "persist.sys.locale", "fr-FR"],
    ["adb", "shell", "setprop", "ctl.restart", "zygote"],
    ["adb", "wait-for-device"],
    ["adb", "shell", 'while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 1; done; sleep 5'],
  ];
}

/** The booted simulator's appearance, Dynamic Type size and a fixed status bar, so captures do not change with the clock. */
function iosSetup(theme: Theme, textSize: TextSize): string[][] {
  return [
    ["xcrun", "simctl", "ui", "booted", "appearance", theme],
    ["xcrun", "simctl", "ui", "booted", "content_size", textSize === "largest" ? "accessibility-extra-extra-extra-large" : "large"],
    ["xcrun", "simctl", "status_bar", "booted", "override", "--time", "09:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularBars", "4", "--wifiBars", "3"],
  ];
}

/** The emulator's night mode, font scale, fold, and the System UI demo mode's fixed status bar. */
function androidSetup(device: Device, theme: Theme, textSize: TextSize): string[][] {
  const demo = (...extras: string[]) => ["adb", "shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", ...extras];
  return [
    ["adb", "shell", "cmd", "uimode", "night", theme === "dark" ? "yes" : "no"],
    ["adb", "shell", "settings", "put", "system", "font_scale", textSize === "largest" ? "2.0" : "1.0"],
    // The System UI lays itself out again for the new scale, and would leave the demo mode set before it.
    ["adb", "shell", "sleep", "5"],
    ...(device.window === "folded" ? [["adb", "emu", "fold"]] : device.window === "unfolded" ? [["adb", "emu", "unfold"]] : []),
    ["adb", "shell", "settings", "put", "global", "sysui_demo_allowed", "1"],
    demo("enter"),
    demo("clock", "-e", "hhmm", "0941"),
    demo("battery", "-e", "level", "100", "-e", "plugged", "false"),
    demo("notifications", "-e", "visible", "false"),
  ];
}

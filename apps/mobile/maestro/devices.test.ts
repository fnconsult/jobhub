import { bootSetup, CI_HARDWARE, DEVICES, runsOn, type Run } from "./devices";

const ids = (runs: Run[]) => runs.map((run) => `${run.device.id} ${run.theme} ${run.textSize}`);
const run = (device: string, theme: Run["theme"], textSize: Run["textSize"]) => {
  const found = Object.values(CI_HARDWARE)
    .flatMap((hardware) => runsOn(hardware.id))
    .find((each) => each.device.id === device && each.theme === theme && each.textSize === textSize);
  if (!found) throw new Error(`no run ${device} ${theme} ${textSize}`);
  return found;
};

describe("the devices the Maestro flows run on (#705)", () => {
  it("covers a small phone, the iPad in landscape, portrait and Split View, an Android tablet and a foldable open and closed", () => {
    expect(DEVICES.map((device) => device.id)).toEqual([
      "iphone-se",
      "ipad-landscape",
      "ipad-portrait",
      "ipad-split-half",
      "android-tablet",
      "foldable-unfolded",
      "foldable-folded",
    ]);
  });

  it("boots one simulator or emulator per CI job, on its platform", () => {
    expect(Object.values(CI_HARDWARE).map(({ id, platform }) => `${platform} ${id}`)).toEqual([
      "ios iphone-se",
      "ios ipad",
      "android android-tablet",
      "android android-foldable",
    ]);
    expect(CI_HARDWARE.ipad.model).toBe("iPad Pro 13-inch (M4)");
    expect(CI_HARDWARE["android-foldable"].model).toBe("pixel_fold");
  });

  it("runs every flow once in the light theme, then the key screens again in the dark theme and at the largest system text", () => {
    expect(ids(runsOn("ipad"))).toEqual([
      "ipad-landscape light default",
      "ipad-landscape dark default",
      "ipad-landscape light largest",
      "ipad-portrait light default",
      "ipad-portrait dark default",
      "ipad-portrait light largest",
      "ipad-split-half light default",
      "ipad-split-half dark default",
      "ipad-split-half light largest",
    ]);
    expect(run("iphone-se", "light", "default").tags).toEqual(["flow", "key-screens"]);
    expect(run("iphone-se", "dark", "default").tags).toEqual(["key-screens"]);
    expect(run("iphone-se", "light", "largest").tags).toEqual(["key-screens"]);
  });

  describe("the layout each run expects, as the shell lays the window out (src/shell/disposition.ts)", () => {
    it.each([
      ["iphone-se", "fullPage"],
      ["ipad-landscape", "columns"],
      ["ipad-portrait", "columns"],
      ["ipad-split-half", "fullPage"],
      ["android-tablet", "columns"],
      ["foldable-unfolded", "fullPage"],
      ["foldable-folded", "fullPage"],
    ])("%s lays out in %s at the default text size", (device, layout) => {
      expect(run(device, "light", "default").layout).toBe(layout);
    });

    it.each(["ipad-landscape", "ipad-portrait", "android-tablet"])("%s opens its columns full page at the largest text size", (device) => {
      expect(run(device, "light", "largest").layout).toBe("fullPage");
    });
  });

  describe("speaks French once booted, as the flows read the app's French labels", () => {
    it("sets an iOS simulator's language and region", () => {
      expect(bootSetup("ipad")).toEqual([
        ["xcrun", "simctl", "spawn", "booted", "defaults", "write", "-g", "AppleLanguages", "-array", "fr-FR"],
        ["xcrun", "simctl", "spawn", "booted", "defaults", "write", "-g", "AppleLocale", "-string", "fr_FR"],
      ]);
    });

    it("sets an Android emulator's locale and restarts its framework, then waits for it", () => {
      expect(bootSetup("android-tablet")).toEqual([
        ["adb", "root"],
        ["adb", "wait-for-device"],
        ["adb", "shell", "setprop", "persist.sys.locale", "fr-FR"],
        ["adb", "shell", "setprop", "ctl.restart", "zygote"],
        ["adb", "wait-for-device"],
        ["adb", "shell", "while [ \"$(getprop sys.boot_completed)\" != 1 ]; do sleep 1; done; sleep 5"],
      ]);
    });
  });

  describe("sets the device up before the run", () => {
    it("sets an iOS simulator's theme, text size and status bar", () => {
      expect(run("ipad-landscape", "dark", "default").setup).toEqual([
        ["xcrun", "simctl", "ui", "booted", "appearance", "dark"],
        ["xcrun", "simctl", "ui", "booted", "content_size", "large"],
        ["xcrun", "simctl", "status_bar", "booted", "override", "--time", "09:41", "--batteryState", "charged", "--batteryLevel", "100", "--cellularBars", "4", "--wifiBars", "3"],
      ]);
      expect(run("iphone-se", "light", "largest").setup).toContainEqual(["xcrun", "simctl", "ui", "booted", "content_size", "accessibility-extra-extra-extra-large"]);
    });

    it("sets an Android emulator's theme, text size, status bar and fold", () => {
      const folded = run("foldable-folded", "dark", "default").setup;
      expect(folded).toContainEqual(["adb", "shell", "cmd", "uimode", "night", "yes"]);
      expect(folded).toContainEqual(["adb", "shell", "settings", "put", "system", "font_scale", "1.0"]);
      expect(folded).toContainEqual(["adb", "emu", "fold"]);
      expect(folded).toContainEqual(["adb", "shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "clock", "-e", "hhmm", "0941"]);
      expect(run("foldable-unfolded", "light", "largest").setup).toEqual(
        expect.arrayContaining([
          ["adb", "shell", "cmd", "uimode", "night", "no"],
          ["adb", "shell", "settings", "put", "system", "font_scale", "2.0"],
          ["adb", "emu", "unfold"],
        ]),
      );
      expect(run("android-tablet", "light", "default").setup).not.toContainEqual(["adb", "emu", "fold"]);
    });
  });

  describe("what the flows read of the run (maestro --env)", () => {
    it("names the device, its theme, the layout it expects and where its captures are", () => {
      expect(run("ipad-portrait", "dark", "default").env).toEqual({
        DEVICE: "ipad-portrait",
        PLATFORM: "ios",
        THEME: "dark",
        TEXT_SIZE: "default",
        LAYOUT: "columns",
        ORIENTATION: "PORTRAIT",
        WINDOW: "full",
        CAPTURE_DIR: "ipad-portrait/dark",
      });
      expect(run("iphone-se", "light", "largest").env).toMatchObject({ CAPTURE_DIR: "iphone-se/light-largest-text", ORIENTATION: "PORTRAIT" });
      expect(run("ipad-split-half", "light", "default").env).toMatchObject({ WINDOW: "split-half", ORIENTATION: "LANDSCAPE_LEFT" });
      expect(run("android-tablet", "light", "default").env).toMatchObject({ ORIENTATION: "" });
    });
  });

  it("says which store's screenshots each device's captures stand for", () => {
    expect(Object.fromEntries(DEVICES.filter((device) => device.store).map((device) => [device.id, device.store]))).toEqual({
      "iphone-se": "App Store, iPhone 4,7 pouces",
      "ipad-landscape": "App Store, iPad 13 pouces",
      "ipad-portrait": "App Store, iPad 13 pouces",
      "android-tablet": "Google Play, tablette 10 pouces",
      "foldable-folded": "Google Play, téléphone",
    });
  });
});

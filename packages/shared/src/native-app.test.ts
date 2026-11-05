import { describe, expect, it } from "vitest";
import { appDeviceHeader, appDeviceName, readAppDevice } from "./native-app";

describe("what the Jobbbox app says of itself with a Signalement (#690): its version and its system", () => {
  it("states them in one header the web app reads back", () => {
    const device = { version: "1.4.0", system: "iOS", systemVersion: "18.6" } as const;
    expect(appDeviceHeader(device)).toBe("1.4.0 (iOS 18.6)");
    expect(readAppDevice(appDeviceHeader(device))).toEqual(device);
    expect(readAppDevice("0.1.0 (Android 34)")).toEqual({ version: "0.1.0", system: "Android", systemVersion: "34" });
  });

  it("states the system alone when the app does not know its version", () => {
    expect(appDeviceHeader({ version: null, system: "Android", systemVersion: "34" })).toBe("(Android 34)");
    expect(readAppDevice("(Android 34)")).toEqual({ version: null, system: "Android", systemVersion: "34" });
  });

  it("is named for the team as the app, its version and its system", () => {
    expect(appDeviceName({ version: "1.4.0", system: "iOS", systemVersion: "18.6" })).toBe("App Jobbbox 1.4.0, iOS 18.6");
    expect(appDeviceName({ version: null, system: "Android", systemVersion: "34" })).toBe("App Jobbbox, Android 34");
  });

  it.each([[null], [""], ["1.4.0"], ["1.4.0 (Windows 11)"], ["1.4.0 (iOS undefined)"], ["marie@example.fr (iOS 18.6)"], [`${"1.".repeat(20)}0 (iOS 18.6)`]])(
    "reads nothing from %s: never a free text kept",
    (header) => {
      expect(readAppDevice(header)).toBeNull();
    },
  );
});

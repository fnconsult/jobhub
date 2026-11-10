import { describe, expect, it } from "vitest";
import {
  API_CLIENT_HEADER,
  API_VERSION,
  API_VERSION_HEADER,
  APP_OUTDATED,
  EXTENSION_OUTDATED,
  EXTENSION_VERSION_HEADER,
  isServedApiVersion,
  isServedExtensionVersion,
  MINIMUM_EXTENSION_VERSION,
  MOBILE_CLIENT,
  readExtensionVersion,
  servedApiVersions,
} from "./api-version";

describe("API Version (#564)", () => {
  it("starts at 1, stated in Jobbbox-Api-Version, refused with a stable code", () => {
    expect(API_VERSION).toBe(1);
    expect(API_VERSION_HEADER).toBe("Jobbbox-Api-Version");
    expect(EXTENSION_OUTDATED).toBe("extension_outdated");
  });

  it("knows the Jobbbox app by Jobbbox-Client: mobile, refused with its own stable code (#684)", () => {
    expect(API_CLIENT_HEADER).toBe("Jobbbox-Client");
    expect(MOBILE_CLIENT).toBe("mobile");
    expect(APP_OUTDATED).toBe("app_outdated");
  });

  it("serves the current version and the one before, none below 1", () => {
    expect(servedApiVersions(1)).toEqual([1]);
    expect(servedApiVersions(3)).toEqual([3, 2]);
  });

  it("accepts N and N−1, refuses N−2, nothing and anything not a whole number", () => {
    expect(isServedApiVersion("3", 3)).toBe(true);
    expect(isServedApiVersion("2", 3)).toBe(true);
    expect(isServedApiVersion(" 2 ", 3)).toBe(true);
    expect(isServedApiVersion("1", 3)).toBe(false);
    expect(isServedApiVersion("0", 1)).toBe(false);
    expect(isServedApiVersion(null, 3)).toBe(false);
    expect(isServedApiVersion("", 3)).toBe(false);
    expect(isServedApiVersion("2.0", 3)).toBe(false);
    expect(isServedApiVersion("v3", 3)).toBe(false);
    expect(isServedApiVersion(String(API_VERSION))).toBe(true);
  });

  it("lets a later one through: the web app ships first, a newer extension is never told to update", () => {
    expect(isServedApiVersion("4", 3)).toBe(true);
  });
});

describe("the Extension Version a call states (#924)", () => {
  it("is stated in Jobbbox-Extension-Version", () => {
    expect(EXTENSION_VERSION_HEADER).toBe("Jobbbox-Extension-Version");
  });

  it("reads X.Y.Z, digits only, as the stores require; anything else is none", () => {
    expect(readExtensionVersion("0.2.0")).toBe("0.2.0");
    expect(readExtensionVersion(" 1.12.3 ")).toBe("1.12.3");
    expect(readExtensionVersion("1.2")).toBeNull();
    expect(readExtensionVersion("1.2.3-beta")).toBeNull();
    expect(readExtensionVersion("v1.2.3")).toBeNull();
    expect(readExtensionVersion("1.2.3.4")).toBeNull();
    expect(readExtensionVersion("99999.0.0")).toBeNull();
    expect(readExtensionVersion("")).toBeNull();
    expect(readExtensionVersion(null)).toBeNull();
  });

  it("serves one at the minimum or later, compared part by part, never as text", () => {
    expect(isServedExtensionVersion("0.2.0", "0.2.0")).toBe(true);
    expect(isServedExtensionVersion("0.10.0", "0.2.0")).toBe(true);
    expect(isServedExtensionVersion("1.0.0", "0.2.0")).toBe(true);
    expect(isServedExtensionVersion("0.1.9", "0.2.0")).toBe(false);
    expect(isServedExtensionVersion(MINIMUM_EXTENSION_VERSION)).toBe(true);
  });

  it("serves a call that states none, or none it can read: the API Version alone decides then", () => {
    expect(isServedExtensionVersion(null, "0.2.0")).toBe(true);
    expect(isServedExtensionVersion("abc", "0.2.0")).toBe(true);
  });
});

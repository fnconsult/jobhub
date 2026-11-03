import { describe, expect, it } from "vitest";
import { API_VERSION, API_VERSION_HEADER, EXTENSION_OUTDATED, isServedApiVersion, servedApiVersions } from "./api-version";

describe("API Version (#564)", () => {
  it("starts at 1, stated in Jobbbox-Api-Version, refused with a stable code", () => {
    expect(API_VERSION).toBe(1);
    expect(API_VERSION_HEADER).toBe("Jobbbox-Api-Version");
    expect(EXTENSION_OUTDATED).toBe("extension_outdated");
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

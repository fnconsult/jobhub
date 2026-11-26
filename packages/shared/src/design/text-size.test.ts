import { describe, expect, it } from "vitest";
import { resolveTextSize, TEXT_SIZE_SETTINGS } from "./index";

describe("resolveTextSize", () => {
  it("offers four steps, smallest first: Small, Standard, Medium, Large", () => {
    expect(TEXT_SIZE_SETTINGS).toEqual(["small", "standard", "large", "xlarge"]);
  });

  it("maps each text-size setting to its root font size: 12, 16 (the default), 17 and 18px", () => {
    expect(resolveTextSize("small")).toEqual({ setting: "small", rootPx: 12 });
    expect(resolveTextSize("standard")).toEqual({ setting: "standard", rootPx: 16 });
    expect(resolveTextSize("large")).toEqual({ setting: "large", rootPx: 17 });
    expect(resolveTextSize("xlarge")).toEqual({ setting: "xlarge", rootPx: 18 });
  });

  it("falls back to the standard size for a missing or unknown stored value", () => {
    expect(resolveTextSize(null)).toEqual({ setting: "standard", rootPx: 16 });
    expect(resolveTextSize("tiny")).toEqual({ setting: "standard", rootPx: 16 });
  });
});

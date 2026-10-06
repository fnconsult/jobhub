import { describe, expect, it } from "vitest";
import { resolveTextSize } from "./index";

describe("resolveTextSize", () => {
  it("maps each text-size setting to a root font size of at least 16px", () => {
    expect(resolveTextSize("standard")).toEqual({ setting: "standard", rootPx: 16 });
    expect(resolveTextSize("large")).toEqual({ setting: "large", rootPx: 18 });
    expect(resolveTextSize("xlarge")).toEqual({ setting: "xlarge", rootPx: 20 });
  });

  it("falls back to the standard size for a missing or unknown stored value", () => {
    expect(resolveTextSize(null)).toEqual({ setting: "standard", rootPx: 16 });
    expect(resolveTextSize("tiny")).toEqual({ setting: "standard", rootPx: 16 });
  });
});

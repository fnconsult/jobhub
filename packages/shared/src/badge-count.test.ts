import { describe, expect, it } from "vitest";
import { badgeCount } from "./badge-count";

describe("badgeCount", () => {
  it("shows a count up to 99 as it is", () => {
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(9)).toBe("9");
    expect(badgeCount(99)).toBe("99");
  });

  it("caps a count over 99 at « 99+ »", () => {
    expect(badgeCount(100)).toBe("99+");
    expect(badgeCount(4321)).toBe("99+");
  });
});

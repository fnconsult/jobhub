import { describe, expect, it } from "vitest";
import { auditDesignTokens, contrastRatio, designTokens } from "./index";

describe("contrastRatio", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #767676 on white is the well-known lightest AA-passing grey (4.54:1).
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});

describe("auditDesignTokens (ADR-0009 accessibility floor)", () => {
  it("finds no violation in the shipped design tokens", () => {
    expect(auditDesignTokens(designTokens)).toEqual([]);
  });

  it("flags a light grey used as body text", () => {
    const greyed = {
      ...designTokens,
      color: { ...designTokens.color, text: "#b0b0b0" },
    };
    expect(auditDesignTokens(greyed)).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "text" }),
    );
  });

  it("flags body text below 16px", () => {
    const shrunk = {
      ...designTokens,
      fontSize: { ...designTokens.fontSize, body: 14 },
    };
    expect(auditDesignTokens(shrunk)).toContainEqual(
      expect.objectContaining({ rule: "min-body-size", token: "body" }),
    );
  });

  it("flags a text-size setting that would shrink body text below 16px", () => {
    const shrunk = {
      ...designTokens,
      textSize: { ...designTokens.textSize, small: 0.8 },
    };
    expect(auditDesignTokens(shrunk)).toContainEqual(
      expect.objectContaining({ rule: "min-body-size", token: "textSize.small" }),
    );
  });
});

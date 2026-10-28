import { describe, expect, it } from "vitest";
import { auditDesignTokens, contrastRatio, designTokens, type DesignTokens } from "./index";

describe("contrastRatio", () => {
  it("matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #767676 on white is the well-known lightest AA-passing grey (4.54:1).
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});

/** The shipped tokens with one colour's value replaced in one theme. */
function withColor(token: keyof DesignTokens["color"], theme: "light" | "dark", value: string): DesignTokens {
  return { ...designTokens, color: { ...designTokens.color, [token]: { ...designTokens.color[token], [theme]: value } } };
}

/** The shipped tokens with one Density's values changed. */
function withDensity(density: "confort" | "compact", change: Partial<DesignTokens["density"]["confort"]>): DesignTokens {
  return { ...designTokens, density: { ...designTokens.density, [density]: { ...designTokens.density[density], ...change } } };
}

describe("auditDesignTokens (ADR-0009 accessibility floor, ADR-0053)", () => {
  it("finds no violation in the shipped design tokens, in both themes and both Densities", () => {
    expect(auditDesignTokens(designTokens)).toEqual([]);
  });

  it("holds every text token to 4.5:1 on every surface in the light theme", () => {
    expect(auditDesignTokens(withColor("text", "light", "#b0b0b0"))).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "text", theme: "light" }),
    );
  });

  it("holds every text token to 4.5:1 on every surface in the dark theme too", () => {
    // #575866 is the light theme's secondary text: on the dark surfaces it is far under AA.
    expect(auditDesignTokens(withColor("secondary", "dark", "#575866"))).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "secondary", theme: "dark" }),
    );
    expect(auditDesignTokens(withColor("meta", "dark", "#5a5b6a"))).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "meta", theme: "dark" }),
    );
  });

  it("holds a status colour to 4.5:1 on its own soft surface", () => {
    expect(auditDesignTokens(withColor("warnSoft", "dark", "#8a6a20"))).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "warn", theme: "dark" }),
    );
  });

  it("holds the text on the accent to 4.5:1, at rest and on hover", () => {
    expect(auditDesignTokens(withColor("accentHover", "light", "#9aa5f0"))).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "onAccent", theme: "light" }),
    );
  });

  it("holds the text on a solid danger button to 4.5:1 (#462)", () => {
    expect(auditDesignTokens(withColor("danger", "light", "#f08080"))).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "onAccent", detail: expect.stringContaining("onAccent on danger") }),
    );
  });

  it("holds the text of a Toast, on the inverse surface, to 4.5:1 in both themes (#462)", () => {
    expect(auditDesignTokens(withColor("inverse", "light", "#9a9aa6"))).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "onInverse", theme: "light" }),
    );
    expect(auditDesignTokens(withColor("onInverse", "dark", "#a0a0aa"))).toContainEqual(
      expect.objectContaining({ rule: "contrast", token: "onInverse", theme: "dark" }),
    );
  });

  it("flags Confort body text below 16px", () => {
    const shrunk = withDensity("confort", { fontSize: { ...designTokens.density.confort.fontSize, body: 14 } });
    expect(auditDesignTokens(shrunk)).toContainEqual(expect.objectContaining({ rule: "min-body-size", token: "body", density: "confort" }));
  });

  it("lets Compact body text go to 14px, never below (ADR-0009 Compact amendment)", () => {
    expect(designTokens.density.compact.fontSize.body).toBe(14);
    const shrunk = withDensity("compact", { fontSize: { ...designTokens.density.compact.fontSize, body: 13 } });
    expect(auditDesignTokens(shrunk)).toContainEqual(expect.objectContaining({ rule: "min-body-size", token: "body", density: "compact" }));
  });

  it("holds metadata to 13px in Confort and 12.5px in Compact (ADR-0009 amendments, #317)", () => {
    expect(designTokens.density.confort.metaFontSize).toBe(13);
    expect(designTokens.density.compact.metaFontSize).toBe(12.5);
    expect(auditDesignTokens(withDensity("confort", { metaFontSize: 12.5 }))).toContainEqual(
      expect.objectContaining({ rule: "min-body-size", token: "metaFontSize", density: "confort" }),
    );
    expect(auditDesignTokens(withDensity("compact", { metaFontSize: 12 }))).toContainEqual(
      expect.objectContaining({ rule: "min-body-size", token: "metaFontSize", density: "compact" }),
    );
  });

  it("flags a text-size setting that would shrink Confort body text below 16px", () => {
    const shrunk = { ...designTokens, textSize: { ...designTokens.textSize, small: 0.8 } };
    expect(auditDesignTokens(shrunk)).toContainEqual(expect.objectContaining({ rule: "min-body-size", token: "textSize.small" }));
  });
});

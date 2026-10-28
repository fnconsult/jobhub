import type { Density, DesignTokens, Theme } from "./tokens";

/** The smallest body and metadata text of each Density, in px at the « small » text size (ADR-0009 and its amendments). */
export const DENSITY_FLOORS: Record<Density, { body: number; meta: number }> = {
  confort: { body: 16, meta: 13 },
  compact: { body: 14, meta: 12.5 },
};
export const MIN_BODY_TEXT_PX = DENSITY_FLOORS.confort.body;
/** Metadata text may be smaller than body text, never below this (ADR-0009 amendment, #317). */
export const MIN_META_TEXT_PX = DENSITY_FLOORS.confort.meta;
export const AA_TEXT_CONTRAST = 4.5;
export const AA_NON_TEXT_CONTRAST = 3;

export type AccessibilityViolation = {
  rule: "contrast" | "min-body-size";
  token: string;
  detail: string;
  theme?: Theme;
  density?: Density;
};

type ColorToken = keyof DesignTokens["color"];

/** Colours text may take: each is audited at AA on every surface, in both themes (onAccent on the accent). */
export const TEXT_COLORS: ColorToken[] = ["text", "secondary", "meta", "accent", "success", "warn", "danger"];
const SURFACES: ColorToken[] = ["background", "canvas", "nav", "surface", "hover", "accentSoft", "successSoft", "warnSoft", "dangerSoft"];
/** Graphics that carry meaning (the focus ring, chart series): 3:1 against the background (WCAG 1.4.11). */
const GRAPHICS: ColorToken[] = ["accent", "chart1", "chart2"];
const THEMES: Theme[] = ["light", "dark"];

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Unsupported colour: ${color}`);
  return 0.2126 * channel(full, 0) + 0.7152 * channel(full, 2) + 0.0722 * channel(full, 4);
}

/** WCAG 2.1 contrast ratio between two hex colours (1 to 21). */
export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Checks design tokens against ADR-0009 and ADR-0053, in the light and the dark theme: AA contrast for every text
 * colour on every surface, onAccent on the accent at rest and on hover and on danger, onInverse on the inverse surface (a
 * Toast), 3:1 for the graphics; and in each Density,
 * no type size below its body floor nor metadata below its metadata floor (Confort 16 / 13px, Compact 14 / 12.5px),
 * and no text-size setting that takes Confort body text under 16px. Returns an empty list when the tokens comply.
 */
export function auditDesignTokens(tokens: DesignTokens): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  for (const theme of THEMES) {
    const color = (token: ColorToken) => tokens.color[token][theme];
    const requireContrast = (token: ColorToken, on: ColorToken, minimum: number) => {
      const ratio = contrastRatio(color(token), color(on));
      if (ratio < minimum) {
        violations.push({ rule: "contrast", token, theme, detail: `${token} on ${on} (${theme}) is ${ratio.toFixed(2)}:1, needs ${minimum}:1` });
      }
    };
    for (const text of TEXT_COLORS) {
      for (const surface of SURFACES) requireContrast(text, surface, AA_TEXT_CONTRAST);
    }
    requireContrast("onAccent", "accent", AA_TEXT_CONTRAST);
    requireContrast("onAccent", "accentHover", AA_TEXT_CONTRAST);
    // A solid danger button's label, and a Toast's text on the inverse surface (#462).
    requireContrast("onAccent", "danger", AA_TEXT_CONTRAST);
    requireContrast("onInverse", "inverse", AA_TEXT_CONTRAST);
    for (const graphic of GRAPHICS) requireContrast(graphic, "background", AA_NON_TEXT_CONTRAST);
  }

  for (const [density, floor] of Object.entries(DENSITY_FLOORS) as [Density, (typeof DENSITY_FLOORS)[Density]][]) {
    const { fontSize, metaFontSize } = tokens.density[density];
    for (const [name, px] of Object.entries(fontSize)) {
      if (px < floor.body) {
        violations.push({ rule: "min-body-size", token: name, density, detail: `${name} is ${px}px in ${density}, needs ${floor.body}px` });
      }
    }
    if (metaFontSize < floor.meta) {
      violations.push({ rule: "min-body-size", token: "metaFontSize", density, detail: `metadata is ${metaFontSize}px in ${density}, needs ${floor.meta}px` });
    }
  }

  for (const [setting, factor] of Object.entries(tokens.textSize)) {
    const px = tokens.density.confort.fontSize.body * factor;
    if (px < MIN_BODY_TEXT_PX) {
      violations.push({
        rule: "min-body-size",
        token: `textSize.${setting}`,
        density: "confort",
        detail: `body text at "${setting}" is ${px}px, needs ${MIN_BODY_TEXT_PX}px`,
      });
    }
  }

  return violations;
}

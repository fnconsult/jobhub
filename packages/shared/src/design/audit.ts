import type { DesignTokens } from "./tokens";

export const MIN_BODY_TEXT_PX = 16;
export const AA_TEXT_CONTRAST = 4.5;
export const AA_NON_TEXT_CONTRAST = 3;

export type AccessibilityViolation = {
  rule: "contrast" | "min-body-size";
  token: string;
  detail: string;
};

type ColorToken = keyof DesignTokens["color"];

const TEXT_COLORS: ColorToken[] = ["text", "textSecondary", "accent", "danger", "success"];
const SURFACES: ColorToken[] = ["background", "surface", "surfaceHover"];

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
 * Checks design tokens against ADR-0009: AA contrast for every text colour on
 * every surface, 3:1 for the focus ring, and no type size (at any text-size
 * setting) below 16px. Returns an empty list when the tokens comply.
 */
export function auditDesignTokens(tokens: DesignTokens): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];
  const { color } = tokens;

  const requireContrast = (token: ColorToken, on: ColorToken, minimum: number) => {
    const ratio = contrastRatio(color[token], color[on]);
    if (ratio < minimum) {
      violations.push({
        rule: "contrast",
        token,
        detail: `${token} on ${on} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
      });
    }
  };

  for (const text of TEXT_COLORS) {
    for (const surface of SURFACES) requireContrast(text, surface, AA_TEXT_CONTRAST);
  }
  requireContrast("onAccent", "accent", AA_TEXT_CONTRAST);
  requireContrast("focusRing", "background", AA_NON_TEXT_CONTRAST);

  for (const [name, px] of Object.entries(tokens.fontSize)) {
    if (px < MIN_BODY_TEXT_PX) {
      violations.push({ rule: "min-body-size", token: name, detail: `${name} is ${px}px, needs ${MIN_BODY_TEXT_PX}px` });
    }
  }
  for (const [setting, factor] of Object.entries(tokens.textSize)) {
    const px = tokens.fontSize.body * factor;
    if (px < MIN_BODY_TEXT_PX) {
      violations.push({
        rule: "min-body-size",
        token: `textSize.${setting}`,
        detail: `body text at "${setting}" is ${px}px, needs ${MIN_BODY_TEXT_PX}px`,
      });
    }
  }

  return violations;
}

import { MIN_BODY_TEXT_PX, TEXT_COLORS } from "./audit";
import { kebab } from "./css";

export type StylesheetViolation = {
  rule: "min-body-size" | "text-colour" | "literal-colour";
  selector: string;
  declaration: string;
};

type Declaration = { selector: string; property: string; value: string };

/** Innermost rule blocks only, so rules nested in `@media` are read as their own. */
function declarations(css: string): Declaration[] {
  const found: Declaration[] = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1]!.trim().replace(/\s+/g, " ");
    for (const part of block[2]!.split(";")) {
      const colon = part.indexOf(":");
      if (colon < 0) continue;
      found.push({ selector, property: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() });
    }
  }
  return found;
}

function sizeInPx(value: string): number | null {
  const match = /^(\d*\.?\d+)(px|rem|em)$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2]!.toLowerCase() === "px" ? amount : amount * MIN_BODY_TEXT_PX;
}

const TEXT_COLOR_VALUES = new Set([
  ...[...TEXT_COLORS, "onAccent"].map((token) => `var(--color-${kebab(token)})`),
  "inherit",
  "currentcolor",
]);

const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;

/**
 * Checks a stylesheet against the ADR-0009 floor: no type set below 16px, and
 * text coloured only with the text colours whose contrast the tokens audit
 * (so no grey body text). Colours are written only as custom properties, so
 * every one is a named, reviewable token. Returns an empty list when it complies.
 */
export function auditStylesheet(css: string): StylesheetViolation[] {
  const violations: StylesheetViolation[] = [];
  for (const { selector, property, value } of declarations(css)) {
    const declaration = `${property}: ${value}`;
    if (property === "font-size") {
      const px = sizeInPx(value);
      if (px !== null && px < MIN_BODY_TEXT_PX) violations.push({ rule: "min-body-size", selector, declaration });
    }
    if (property === "color" && !TEXT_COLOR_VALUES.has(value.toLowerCase())) {
      violations.push({ rule: "text-colour", selector, declaration });
    }
    if (!property.startsWith("--") && LITERAL_COLOR.test(value)) {
      violations.push({ rule: "literal-colour", selector, declaration });
    }
  }
  return violations;
}

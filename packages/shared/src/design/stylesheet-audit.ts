import { DENSITY_FLOORS, MIN_COMPACT_TEXT_PX, TEXT_COLORS, TEXT_SIZE_BELOW_FLOOR } from "./audit";
import { kebab } from "./css";
import { designTokens, legacyColorAliases, type Density } from "./tokens";

export type StylesheetViolation = {
  rule: "min-body-size" | "text-colour" | "literal-colour" | "font-size-token";
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

/** The smallest Text Size factor, « Petit »: what a size in rem or em is multiplied by on the smallest root. */
const SMALLEST_TEXT_SIZE = Math.min(...Object.values(designTokens.textSize));

/**
 * A font size at the smallest Text Size, in px: a px size as it is, a rem or em size scaled, and `max(…)` the largest of
 * its terms. Null when it cannot be read (a token, `inherit`).
 */
function sizeAtSmallestInPx(value: string): number | null {
  const terms = /^max\((.+)\)$/i.exec(value)?.[1]?.split(",").map((term) => term.trim()) ?? [value];
  const sizes = terms.map((term) => {
    const px = sizeInPx(term);
    return px === null ? null : /px$/i.test(term) ? px : px * SMALLEST_TEXT_SIZE;
  });
  return sizes.some((size) => size === null) ? null : Math.max(...(sizes as number[]));
}

function sizeInPx(value: string): number | null {
  const match = /^(\d*\.?\d+)(px|rem|em)$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2]!.toLowerCase() === "px" ? amount : amount * designTokens.rootFontSize;
}

/** The audited text colours, and the old names that alias one of them. */
const TEXT_COLOR_TOKENS: string[] = [
  ...TEXT_COLORS,
  "onAccent",
  "onInverse",
  ...Object.entries(legacyColorAliases)
    .filter(([, name]) => (TEXT_COLORS as string[]).includes(name))
    .map(([old]) => old),
];

const TEXT_COLOR_VALUES = new Set([...TEXT_COLOR_TOKENS.map((token) => `var(--color-${kebab(token)})`), "inherit", "currentcolor"]);

const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;

/**
 * Checks a stylesheet against the ADR-0009 floor of its Density: no type set below 16px in Confort (the default)
 * or 14px in Compact (the Back Office), and in Compact no type under 12px at the « Petit » Text Size either (a size in
 * rem is written `max(<rem>, 12px)`), but the root at « Petit », never below 12px, and text coloured only with the text colours whose contrast the tokens
 * audit (so no grey body text). Colours are written only as custom properties, so every one is a named,
 * reviewable token. Returns an empty list when it complies.
 */
export function auditStylesheet(css: string, { density = "confort" }: { density?: Density } = {}): StylesheetViolation[] {
  return audit(css, { floor: DENSITY_FLOORS[density].body, component: false, minAtSmallest: density === "compact" ? MIN_COMPACT_TEXT_PX : 0 });
}

/** A font size read from one token, `var(--font-size-…)`, or the parent's. */
const TOKEN_FONT_SIZE = /^(?:var\(--font-size-[a-z0-9-]+\)|inherit)$/i;

/**
 * Checks a stylesheet of the Design System's component layer (ADR-0053, #462), stricter than a page's: every font
 * size is a token (`var(--font-size-…)`, so it follows the Density and the Text Size), text takes an audited text
 * colour, and no colour is written as a literal, not even in a custom property the component defines. Returns an
 * empty list when it complies.
 */
export function auditComponentStylesheet(css: string): StylesheetViolation[] {
  return audit(css, { floor: 0, component: true });
}

/**
 * The root's font size at « Petit », the one Text Size step the Candidate may choose under the floor (ADR-0009,
 * 2026-11-26): held to its own minimum instead.
 */
const BELOW_FLOOR_SELECTOR = `html[data-text-size="${TEXT_SIZE_BELOW_FLOOR.setting}"]`;

function audit(css: string, { floor, component, minAtSmallest = 0 }: { floor: number; component: boolean; minAtSmallest?: number }): StylesheetViolation[] {
  const violations: StylesheetViolation[] = [];
  for (const { selector, property, value } of declarations(css)) {
    const declaration = `${property}: ${value}`;
    const flag = (rule: StylesheetViolation["rule"]) => violations.push({ rule, selector, declaration });
    if (property === "font-size") {
      const px = sizeInPx(value);
      const min = selector === BELOW_FLOOR_SELECTOR ? Math.min(floor, TEXT_SIZE_BELOW_FLOOR.minPx) : floor;
      if (px !== null && px < min) flag("min-body-size");
      // Compact (the Back Office): never under 12px, at « Petit » too; a size in rem is written `max(<rem>, 12px)`.
      const smallest = sizeAtSmallestInPx(value);
      if (smallest !== null && smallest < minAtSmallest && (px === null || px >= min)) flag("min-body-size");
    }
    if (component && ((property === "font-size" && !TOKEN_FONT_SIZE.test(value)) || (property === "font" && value.toLowerCase() !== "inherit"))) {
      flag("font-size-token");
    }
    if (property === "color" && !TEXT_COLOR_VALUES.has(value.toLowerCase())) flag("text-colour");
    if ((component || !property.startsWith("--")) && LITERAL_COLOR.test(value)) flag("literal-colour");
  }
  return violations;
}

/**
 * Jobbbox design tokens: the Design System's palette (ADR-0053, variant A « Mercury pur »: cool greys, an indigo
 * accent), as semantic tokens with a light and a dark value, and its two Densities, held to the ADR-0009
 * accessibility floor. `auditDesignTokens` enforces that floor in CI, in both themes and both Densities;
 * `renderDesignCss` turns these values into the one stylesheet the web app and the extension share.
 */

/** A colour (or shadow) with its value in each theme. The dark one applies under `[data-theme="dark"]`. */
export type Themed = { light: string; dark: string };
export type Theme = keyof Themed;

const themed = (light: string, dark: string): Themed => ({ light, dark });

export const designTokens = {
  color: {
    // Surfaces and borders: the only place light greys may appear.
    background: themed("#ffffff", "#121219"),
    canvas: themed("#ffffff", "#121219"),
    nav: themed("#f6f6f8", "#17171f"),
    surface: themed("#f8f8fa", "#1b1b24"),
    hover: themed("#efeff3", "#24242f"),
    border: themed("#e6e6ec", "#2a2a36"),
    borderStrong: themed("#d6d6de", "#383846"),
    // Text colours: every one must read at AA (4.5:1) on every surface, in both themes.
    text: themed("#1b1b26", "#ececf3"),
    secondary: themed("#575866", "#a9aab8"),
    // Metadata (a token count, a time, the line under a Coach reply): AA on every surface (ADR-0009 amendment).
    meta: themed("#686978", "#9a9bab"),
    accent: themed("#4f5fe0", "#8d9bff"),
    accentHover: themed("#4352cc", "#a3aeff"),
    accentSoft: themed("#eef0fd", "#242845"),
    accentLine: themed("#c9cff7", "#3b4277"),
    onAccent: themed("#ffffff", "#10101a"),
    success: themed("#1c7445", "#6fd29b"),
    successSoft: themed("#eaf6ef", "#16301f"),
    warn: themed("#855700", "#f2c25c"),
    warnSoft: themed("#fdf5e3", "#33290f"),
    danger: themed("#bb3030", "#ff8a8a"),
    dangerSoft: themed("#fdeeee", "#3a1b1b"),
    // Chart series and the area under a line: graphics, so 3:1 against the background (WCAG 1.4.11).
    chart1: themed("#6a78ee", "#8d9bff"),
    chart2: themed("#e46f8a", "#e46f8a"),
    chartFill: themed("rgb(106 120 238 / 18%)", "rgb(141 155 255 / 22%)"),
    // A Toast: the text colour as a surface, and the text on it (#462).
    inverse: themed("#1b1b26", "#ececf3"),
    onInverse: themed("#ffffff", "#121219"),
    // What dims the page behind a drawer or a dialog.
    scrim: themed("rgb(20 20 40 / 28%)", "rgb(0 0 0 / 50%)"),
  },
  shadow: {
    card: themed("0 1px 2px rgb(20 20 40 / 4%)", "none"),
    pop: themed("0 12px 32px rgb(20 20 40 / 14%)", "0 12px 32px rgb(0 0 0 / 50%)"),
  },
  /** One `rem` in px: the root font size at the « small » text size, which every type size below is relative to. */
  rootFontSize: 16,
  /**
   * The two Densities (ADR-0053): Confort on the Candidate side, the extension and the emails (ADR-0009's floor),
   * Compact in the Back Office (ADR-0009's Compact amendment). Sizes are in px at the « small » text size and
   * rendered in rem, so the Text Size scales both.
   */
  density: {
    confort: {
      fontSize: { body: 16, lead: 18, h3: 20, h2: 24, h1: 32 },
      /** Metadata, never body text: at least 13px (ADR-0009 amendment, #317). */
      metaFontSize: 13,
      lineHeight: 1.6,
      controlHeight: 40,
      rowPadding: 12,
    },
    compact: {
      fontSize: { body: 14, lead: 15, h3: 16, h2: 18, h1: 24 },
      metaFontSize: 12.5,
      lineHeight: 1.45,
      controlHeight: 32,
      rowPadding: 7,
    },
  },
  lineHeight: {
    heading: 1.25,
  },
  fontFamily: {
    // Inter, self-hosted (ADR-0053); the system stack until it loads, or if it cannot.
    sans: '"Inter Variable", "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  /**
   * Multipliers applied to every type size by the Candidate's text-size
   * setting, smallest first (the slider's order). "small" is the 16px floor;
   * "large" and "xlarge" keep their keys so a remembered setting reads the same.
   */
  textSize: {
    small: 1,
    standard: 1.0625,
    large: 1.125,
    xlarge: 1.25,
  },
  /** Corners in px: controls are pills, cards 10px. */
  radius: { sm: 4, md: 6, card: 10, control: 999 },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 },
  /** Short and functional (ADR-0053): drawers, dialogs, toasts and hovers. None under `prefers-reduced-motion`. */
  motion: {
    duration: { fast: 150, base: 180, slow: 220 },
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },
} as const;

/**
 * Old token names, kept as aliases of the new ones until the components ticket removes them (#461):
 * `--color-text-secondary` reads as `--color-secondary`, and so on.
 */
export const legacyColorAliases = {
  textSecondary: "secondary",
  textMeta: "meta",
  surfaceHover: "hover",
  dangerSurface: "dangerSoft",
  focusRing: "accent",
} as const satisfies Record<string, keyof typeof designTokens.color>;

type Widen<T> = T extends string ? string : T extends number ? number : { [K in keyof T]: Widen<T[K]> };

export type DesignTokens = Widen<typeof designTokens>;
export type Density = keyof typeof designTokens.density;
export type TextSizeSetting = keyof typeof designTokens.textSize;

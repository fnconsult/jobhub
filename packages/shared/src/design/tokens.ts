/**
 * Jobbbox design tokens: Notion-like whites and light greys, held to the
 * ADR-0009 accessibility floor. `auditDesignTokens` enforces that floor in CI;
 * `tokens.css` mirrors these values for the web app and the extension.
 */
export const designTokens = {
  color: {
    // Surfaces and borders: the only place light greys may appear.
    background: "#ffffff",
    surface: "#f7f7f5",
    surfaceHover: "#efeeec",
    border: "#e3e2e0",
    // Text colours: every one must read at AA (4.5:1) on every surface.
    text: "#37352f",
    textSecondary: "#5a5955",
    accent: "#1f5fbf",
    danger: "#b42318",
    success: "#1e6e3a",
    onAccent: "#ffffff",
    // Non-text UI: must reach 3:1 (WCAG 1.4.11).
    focusRing: "#1f5fbf",
  },
  /** Type sizes in px at the "standard" text-size setting. */
  fontSize: {
    body: 16,
    lead: 18,
    h3: 20,
    h2: 24,
    h1: 32,
  },
  lineHeight: {
    body: 1.6,
    heading: 1.25,
  },
  fontFamily: {
    sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  /** Multipliers applied to every type size by the Candidate's text-size setting. */
  textSize: {
    standard: 1,
    large: 1.125,
    xlarge: 1.25,
  },
  radius: { sm: 4, md: 6, lg: 10 },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48 },
} as const;

type Widen<T> = T extends string ? string : T extends number ? number : { [K in keyof T]: Widen<T[K]> };

export type DesignTokens = Widen<typeof designTokens>;
export type TextSizeSetting = keyof typeof designTokens.textSize;

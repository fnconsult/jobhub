import { SCROLLING_CLASS } from "./scrollbars";
import { legacyColorAliases, type Density, type DesignTokens, type Theme } from "./tokens";

/** `borderStrong` → `border-strong`, `chart1` → `chart-1`: a token's name as a CSS custom property. */
export const kebab = (name: string) => name.replace(/[A-Z]|\d+/g, (c) => `-${c.toLowerCase()}`);

const rule = (selector: string, declarations: string[]) => `${selector} {\n${declarations.map((d) => `  ${d}`).join("\n")}\n}`;

/** The colours and shadows of one theme, the old names included (they alias the new ones). */
function themeVars(tokens: DesignTokens, theme: Theme): string[] {
  const { color, shadow } = tokens;
  return [
    `color-scheme: ${theme};`,
    ...Object.entries(color).map(([name, value]) => `--color-${kebab(name)}: ${value[theme]};`),
    ...Object.entries(legacyColorAliases).map(([old, name]) => `--color-${kebab(old)}: ${color[name][theme]};`),
    ...Object.entries(shadow).map(([name, value]) => `--shadow-${name}: ${value[theme]};`),
  ];
}

/** The type sizes, line height, control height and row padding of one Density, in rem. */
function densityVars(tokens: DesignTokens, density: Density): string[] {
  const rem = (px: number) => `${px / tokens.rootFontSize}rem`;
  const { fontSize, metaFontSize, lineHeight, controlHeight, rowPadding } = tokens.density[density];
  return [
    ...Object.entries(fontSize).map(([name, px]) => `--font-size-${name}: ${rem(px)};`),
    `--font-size-meta: ${rem(metaFontSize)};`,
    `--line-height-body: ${lineHeight};`,
    `--size-control: ${rem(controlHeight)};`,
    `--space-row: ${rem(rowPadding)};`,
  ];
}

/**
 * Renders the design tokens as one stylesheet shared by the web app and the extension: CSS custom properties in
 * the light theme on the root and the dark ones under `[data-theme="dark"]`, the Confort Density on the root and
 * each Density under `[data-density]`, the text-size setting (via `html[data-text-size]`), motion tokens, thin
 * scrollbars and accessible base styles. Type sizes are in rem so the Candidate's text-size setting scales the
 * whole interface, in both Densities.
 */
export function renderDesignCss(tokens: DesignTokens): string {
  const rootPx = tokens.rootFontSize;
  const rem = (px: number) => `${px / rootPx}rem`;
  const { duration, easing } = tokens.motion;

  const root = rule(":root", [
    ...themeVars(tokens, "light"),
    ...densityVars(tokens, "confort"),
    ...Object.entries(tokens.lineHeight).map(([name, value]) => `--line-height-${name}: ${value};`),
    ...Object.entries(tokens.radius).map(([name, px]) => `--radius-${name}: ${px}px;`),
    // Old name, kept until the components ticket (#461).
    "--radius-lg: var(--radius-card);",
    ...Object.entries(tokens.space).map(([name, px]) => `--space-${name}: ${rem(px)};`),
    `--font-sans: ${tokens.fontFamily.sans};`,
    ...Object.entries(duration).map(([name, ms]) => `--motion-${name}: ${ms}ms;`),
    `--motion-easing: ${easing};`,
  ]);

  const textSizes = Object.entries(tokens.textSize).map(([setting, factor]) =>
    rule(`html[data-text-size="${setting}"]`, [`font-size: ${rootPx * factor}px;`]),
  );

  // Element styles, in the lowest layer: a component's class (layer `components`) wins over them, and a page's
  // unlayered rules (app.css) over both, until each screen migrates (ADR-0053, #462).
  const base = [
    rule("body", [
      "margin: 0;",
      "background: var(--color-canvas);",
      "color: var(--color-text);",
      "font-family: var(--font-sans);",
      "font-size: var(--font-size-body);",
      "line-height: var(--line-height-body);",
    ]),
    rule("h1, h2, h3", ["line-height: var(--line-height-heading);", "color: var(--color-text);"]),
    `h1 { font-size: var(--font-size-h1); }\nh2 { font-size: var(--font-size-h2); }\nh3 { font-size: var(--font-size-h3); }`,
    rule("a", ["color: var(--color-accent);"]),
    rule(":focus-visible", ["outline: 3px solid var(--color-accent);", "outline-offset: 2px;"]),
    rule("button, input, select, textarea", ["font: inherit;", "color: inherit;"]),
    // Inter's tabular figures, so numbers line up in columns and do not jump as they change.
    rule("table, time, data, .num", ["font-variant-numeric: tabular-nums;"]),
    // Scrollbars show only while their area scrolls (set by trackScrolling), thin (ADR-0053).
    rule("*", ["scrollbar-width: thin;", "scrollbar-color: transparent transparent;"]),
    rule(`.${SCROLLING_CLASS}`, ["scrollbar-color: var(--color-border-strong) transparent;"]),
    rule("::-webkit-scrollbar", ["width: 8px;", "height: 8px;", "background: transparent;"]),
    rule("::-webkit-scrollbar-thumb", ["background: transparent;", "border-radius: 999px;"]),
    rule(`.${SCROLLING_CLASS}::-webkit-scrollbar-thumb`, ["background: var(--color-border-strong);"]),
  ];

  return (
    [
      // The order of the layers, stated first: every component stylesheet states it again, whichever loads first.
      "@layer base, components;",
      root,
      rule('[data-theme="dark"]', themeVars(tokens, "dark")),
      ...(Object.keys(tokens.density) as Density[]).map((density) => rule(`[data-density="${density}"]`, densityVars(tokens, density))),
      // An element that sets a Density sets its own text to it; the root's size stays the Text Size's.
      rule("[data-density]:not(:root)", ["font-size: var(--font-size-body);", "line-height: var(--line-height-body);"]),
      rule("html", [`font-size: ${rootPx}px;`]),
      ...textSizes,
      `@layer base {\n${base.join("\n\n")}\n}`,
      `@media (prefers-reduced-motion: reduce) {\n${rule(":root", Object.keys(duration).map((name) => `--motion-${name}: 0ms;`))}\n}`,
    ].join("\n\n") + "\n"
  );
}

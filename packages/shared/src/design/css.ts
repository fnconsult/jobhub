import type { DesignTokens } from "./tokens";

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const rem = (px: number, base: number) => `${px / base}rem`;

/**
 * Renders the design tokens as one stylesheet shared by the web app and the
 * extension: CSS custom properties, the text-size setting (via
 * `html[data-text-size]`) and accessible base styles. Type sizes are in rem so
 * the Candidate's text-size setting scales the whole interface.
 */
export function renderDesignCss(tokens: DesignTokens): string {
  const base = tokens.fontSize.body;
  const vars = [
    ...Object.entries(tokens.color).map(([k, v]) => `--color-${kebab(k)}: ${v};`),
    ...Object.entries(tokens.fontSize).map(([k, v]) => `--font-size-${k}: ${rem(v, base)};`),
    ...Object.entries(tokens.lineHeight).map(([k, v]) => `--line-height-${k}: ${v};`),
    ...Object.entries(tokens.radius).map(([k, v]) => `--radius-${k}: ${v}px;`),
    ...Object.entries(tokens.space).map(([k, v]) => `--space-${k}: ${rem(v, base)};`),
    `--font-sans: ${tokens.fontFamily.sans};`,
  ];

  const textSizes = Object.entries(tokens.textSize).map(
    ([setting, factor]) => `html[data-text-size="${setting}"] {\n  font-size: ${base * factor}px;\n}`,
  );

  return [
    `:root {\n${vars.map((v) => `  ${v}`).join("\n")}\n}`,
    `html {\n  font-size: ${base}px;\n}`,
    ...textSizes,
    `body {
  margin: 0;
  background: var(--color-background);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}`,
    `h1, h2, h3 {\n  line-height: var(--line-height-heading);\n  color: var(--color-text);\n}`,
    `h1 { font-size: var(--font-size-h1); }\nh2 { font-size: var(--font-size-h2); }\nh3 { font-size: var(--font-size-h3); }`,
    `a {\n  color: var(--color-accent);\n}`,
    `:focus-visible {\n  outline: 3px solid var(--color-focus-ring);\n  outline-offset: 2px;\n}`,
    `button, input, select, textarea {\n  font: inherit;\n  color: inherit;\n}`,
  ].join("\n\n") + "\n";
}

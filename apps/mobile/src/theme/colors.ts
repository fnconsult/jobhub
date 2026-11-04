import { designTokens, type Theme } from "@jobhub/shared/design/tokens";

export type ColorName = keyof typeof designTokens.color;
export type Colors = Record<ColorName, string>;

/** `rgb(r g b / a%)`, the web's notation, which React Native does not read. */
const CSS_RGB = /^rgb\((\d+) (\d+) (\d+) \/ (\d+(?:\.\d+)?)%\)$/;

function nativeColor(value: string): string {
  const match = CSS_RGB.exec(value);
  if (!match) return value;
  const [, r, g, b, alpha] = match;
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha) / 100})`;
}

/** The Design System's colours (ADR-0053, `@jobhub/shared`) in the light or the dark theme. */
export function colorsFor(theme: Theme): Colors {
  const entries = Object.entries(designTokens.color).map(([name, themed]) => [name, nativeColor(themed[theme])]);
  return Object.fromEntries(entries) as Colors;
}

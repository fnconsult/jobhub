// PROTOTYPE (throwaway, branch prototype/mobile-shell). The real Mercury tokens, read from packages/shared.
import { createContext, useContext } from "react";
import { designTokens } from "../../../../packages/shared/src/design/tokens";

type ColorKey = keyof typeof designTokens.color;
export type Colors = Record<ColorKey, string>;
export type Scheme = "light" | "dark";

export function colorsFor(scheme: Scheme): Colors {
  const out = {} as Colors;
  for (const key of Object.keys(designTokens.color) as ColorKey[]) out[key] = designTokens.color[key][scheme];
  // React Native does not read `rgb(r g b / a%)` everywhere: the two translucent tokens, in rgba.
  out.scrim = scheme === "light" ? "rgba(20,20,40,0.28)" : "rgba(0,0,0,0.5)";
  out.chartFill = scheme === "light" ? "rgba(106,120,238,0.18)" : "rgba(141,155,255,0.22)";
  return out;
}

export const tokens = designTokens;
export const type = designTokens.density.confort;

export const ThemeContext = createContext<{ c: Colors; scheme: Scheme }>({ c: colorsFor("light"), scheme: "light" });
export const useTheme = () => useContext(ThemeContext);

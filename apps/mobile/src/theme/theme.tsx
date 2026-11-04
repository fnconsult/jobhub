import { designTokens, type Theme } from "@jobhub/shared/design/tokens";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { colorsFor, type Colors } from "./colors";

/** Inter, bundled with the app (`@expo-google-fonts/inter`, loaded in the root layout), by weight. */
export const INTER = { regular: "Inter_400Regular", semiBold: "Inter_600SemiBold", bold: "Inter_700Bold" } as const;

/** The Confort Density (ADR-0053): the Candidate's, held to ADR-0009's 16 pt floor. Sizes in points, before the system scale. */
export const type = designTokens.density.confort;
export const space = designTokens.space;
export const radius = designTokens.radius;
/** ADR-0009: every target at least 44 pt. */
export const TARGET = 44;

type ThemeValue = { theme: Theme; colors: Colors };

const LIGHT: ThemeValue = { theme: "light", colors: colorsFor("light") };
const DARK: ThemeValue = { theme: "dark", colors: colorsFor("dark") };
const ThemeContext = createContext<ThemeValue>(LIGHT);

/** Light or dark as the system is, and again whenever it changes (ADR-0076): the app has no setting of its own. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const value = useMemo(() => (scheme === "dark" ? DARK : LIGHT), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

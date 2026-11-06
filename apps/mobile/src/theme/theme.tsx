import { designTokens, type Theme } from "@jobhub/shared/design/tokens";
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from "expo-router";
import { createContext, useContext, type ReactNode } from "react";
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

/**
 * Expo Router's theme in the Design System's colours: a Stack's screen (the conversation's column) is drawn on the
 * theme's background, not React Navigation's own light grey, which stays light in the dark theme (#836).
 */
function navigationTheme(theme: Theme, colors: Colors) {
  const base = theme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: { primary: colors.accent, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, notification: colors.danger },
  };
}

const themeValue = (theme: Theme) => {
  const colors = colorsFor(theme);
  return { value: { theme, colors } satisfies ThemeValue, navigation: navigationTheme(theme, colors) };
};
const LIGHT = themeValue("light");
const DARK = themeValue("dark");
const ThemeContext = createContext<ThemeValue>(LIGHT.value);

/**
 * Light or dark as the system is, and again whenever it changes (ADR-0076): the app has no setting of its own. The
 * pages' navigation takes the same colours.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const { value, navigation } = scheme === "dark" ? DARK : LIGHT;
  return (
    <ThemeContext.Provider value={value}>
      <NavigationThemeProvider value={navigation}>{children}</NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

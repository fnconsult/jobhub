import { kebab, type Density, type DesignTokens, type Theme } from "@jobhub/shared/design";
import { routes } from "@/routes";
import { densityOfTestPage } from "./component-test-page";

/** One colour token as the Design System page shows it: its name, the CSS variable that carries it, and its value in each theme. */
export type ColorEntry = { token: string; variable: string; light: string; dark: string };
/** One step of the type scale: its style, the CSS variable that sets it, and its size in px (at the « small » Text Size) in each Density. */
export type TypeStep = { style: string; variable: string } & Record<Density, number>;

/** The type scale's styles, largest first; metadata last, the smallest text there is. */
const TYPE_STYLES = ["h1", "h2", "h3", "lead", "body", "meta"] as const;

/**
 * What the Design System page lists of the tokens (#463): every colour, with both themes' values, and the type scale
 * in both Densities. Read from the tokens themselves, so the page can never disagree with the stylesheet.
 */
export function tokenCatalogue(tokens: DesignTokens): { colors: ColorEntry[]; typeScale: TypeStep[] } {
  const colors = Object.entries(tokens.color).map(([token, value]) => ({ token, variable: `--color-${kebab(token)}`, ...value }));
  const sizeOf = (density: Density, style: (typeof TYPE_STYLES)[number]) =>
    style === "meta" ? tokens.density[density].metaFontSize : tokens.density[density].fontSize[style];
  const typeScale = TYPE_STYLES.map((style) => ({ style, variable: `--font-size-${style}`, confort: sizeOf("confort", style), compact: sizeOf("compact", style) }));
  return { colors, typeScale };
}

type Param = string | string[] | undefined;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

/** The theme and Density the Design System page shows: what its address asks (`?theme=sombre`, `?densite=compact`), light and Confort otherwise. */
export function designSystemView(params: { theme?: Param; densite?: Param }): { theme: Theme; density: Density } {
  return { theme: first(params.theme) === "sombre" ? "dark" : "light", density: densityOfTestPage(params.densite) };
}

/** The Design System page's address for a theme and a Density, naming only what differs from light and Confort. */
export function designSystemHref({ theme, density }: { theme: Theme; density: Density }): string {
  const query = new URLSearchParams();
  if (theme === "dark") query.set("theme", "sombre");
  if (density === "compact") query.set("densite", "compact");
  const search = query.toString();
  return search ? `${routes.adminDesignSystem}?${search}` : routes.adminDesignSystem;
}

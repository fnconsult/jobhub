import type { Theme } from "./tokens";

/** The Candidate's theme choice in Préférences (#473): Clair, Sombre, or Système, the default, which follows the device. */
export const THEME_SETTINGS = ["light", "dark", "system"] as const;
export type ThemeSetting = (typeof THEME_SETTINGS)[number];
export const THEME_STORAGE_KEY = "jobbbox.theme";
/** The media query the Système choice follows. */
export const PREFERS_DARK = "(prefers-color-scheme: dark)";

function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === "string" && (THEME_SETTINGS as readonly string[]).includes(value);
}

/**
 * Turns a stored theme choice (possibly missing or stale) and whether the device prefers dark into the theme to draw,
 * set on `<html data-theme>`.
 */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): { setting: ThemeSetting; theme: Theme } {
  const setting = isThemeSetting(stored) ? stored : "system";
  const theme = setting === "system" ? (prefersDark ? "dark" : "light") : setting;
  return { setting, theme };
}

/** What followTheme needs of the device's preference: a `matchMedia(PREFERS_DARK)` list. */
export type ColorSchemeMedia = {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};

/**
 * Sets `root`'s theme from the stored choice and keeps it on the device's preference while the choice is Système, the
 * choice read again at each change. Returns a function that stops following. The extension's Side Panel uses it;
 * the web app's pages use `themeScript`, which does the same before first paint.
 */
export function followTheme(
  root: { dataset: Record<string, string | undefined> },
  media: ColorSchemeMedia,
  readStored: () => string | null,
): () => void {
  const apply = () => {
    root.dataset.theme = resolveTheme(readStored(), media.matches).theme;
  };
  apply();
  media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}

/**
 * The inline script a page's `<head>` runs before first paint (#473), so a dark page never flashes light: it sets
 * `<html data-theme>` from the stored choice, or from the device's preference under Système (the default, and when
 * storage cannot be read), and follows that preference while the page is open. It puts the theme back when the
 * attribute is cleared: React clears `<html>`'s attributes when it renders the whole page again on the client.
 * Plain ES5, no dependency.
 */
export function themeScript(): string {
  return `(function(){var m;try{m=matchMedia(${JSON.stringify(PREFERS_DARK)})}catch(e){}function a(){var v=null;try{v=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )})}catch(e){}if(${JSON.stringify(THEME_SETTINGS)}.indexOf(v)<0)v="system";document.documentElement.dataset.theme=v==="system"?(m&&m.matches?"dark":"light"):v}a();if(m&&m.addEventListener)m.addEventListener("change",a);var r=document.documentElement;try{new MutationObserver(function(){if(!r.dataset.theme)a()}).observe(r,{attributes:true,attributeFilter:["data-theme"]})}catch(e){}})();`;
}

import { expect, type Page } from "@playwright/test";
import { renderedTexts } from "./accessibility";

/**
 * The two themes every key screen's baselines are drawn in (ADR-0053, #473). Light's keep the names they had; dark's
 * add `-dark` (`themedName`).
 */
export const THEMES = ["light", "dark"] as const;
export type ScreenshotTheme = (typeof THEMES)[number];

/** A baseline's name in `theme`: `candidatures-desktop` in light, `candidatures-desktop-dark` in dark. */
export const themedName = (name: string, theme: ScreenshotTheme) => (theme === "light" ? name : `${name}-dark`);

/**
 * Shows the page in `theme` as a device set to it shows it: under the default choice, Système, the page follows the
 * device's preference at once, without a reload (#473).
 */
export async function showInTheme(page: Page, theme: ScreenshotTheme) {
  await page.emulateMedia({ colorScheme: theme });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/**
 * The token audit on the page as drawn (ADR-0009, #473): every visible text, as the browser computed its colour and the
 * background behind it, reads at AA (4.5:1). Run in dark, where no screen was drawn before.
 */
export async function expectTextContrast(page: Page, label: string) {
  for (const t of await renderedTexts(page)) {
    expect.soft(t.contrast, `${label}: contrast of "${t.text}" (${t.color} on ${t.background})`).toBeGreaterThanOrEqual(4.5);
  }
}

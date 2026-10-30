type Env = Record<string, string | undefined>;

/** The three widths every screenshot baseline is drawn at (#463): a phone, a tablet and a laptop. */
export const SCREENSHOT_WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

/**
 * Whether this run compares screenshots with their baselines (#463). The baselines are drawn in the Playwright image
 * (scripts/update-screenshot-baselines.sh), and CI's `screenshots` job compares in it: elsewhere fonts render
 * otherwise, so a developer's run checks axe and skips the comparison. E2E_SCREENSHOTS=1 or 0 decides; unset, CI
 * compares, so a missing or different baseline fails there.
 */
export function comparesScreenshots(env: Env = process.env): boolean {
  if (env.E2E_SCREENSHOTS) return env.E2E_SCREENSHOTS === "1";
  return Boolean(env.CI);
}

/**
 * Leaves « Version de Jobbbox » (#559) out of the page before a spec makes the window as tall as the page: it changes
 * with every Version and commit. Every screenshot leaves it out too (screenshots.css, playwright.config.ts).
 */
export async function leaveOutRelease(page: { addStyleTag: (options: { path: string }) => Promise<unknown> }): Promise<void> {
  await page.addStyleTag({ path: "e2e/support/screenshots.css" });
}

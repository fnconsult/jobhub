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
 * otherwise, so a developer's run checks axe and skips the comparison. That holds on Linux too: a Chromium outside the
 * image draws text otherwise (grayscale where the baselines have colour fringes). E2E_SCREENSHOTS=1 or 0 decides; unset,
 * CI compares, so a missing or different baseline fails there, and so does a run whose browser is the Playwright
 * container's (PW_TEST_CONNECT_WS_ENDPOINT, see e2e/shell-screenshots.spec.ts).
 */
export function comparesScreenshots(env: Env = process.env): boolean {
  if (env.E2E_SCREENSHOTS) return env.E2E_SCREENSHOTS === "1";
  return Boolean(env.CI) || Boolean(env.PW_TEST_CONNECT_WS_ENDPOINT);
}

/**
 * Whether e2e/email-html.spec.ts compares the emails with their baselines (#472). They are kept per platform: the
 * `-linux` ones are drawn in the Playwright image, so Linux compares as {@link comparesScreenshots} says; macOS has
 * baselines of its own and compares unless E2E_SCREENSHOTS=0.
 */
export function comparesEmailScreenshots(env: Env = process.env, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "darwin" && !env.E2E_SCREENSHOTS) return true;
  return comparesScreenshots(env);
}

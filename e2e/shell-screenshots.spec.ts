import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { comparesScreenshots } from "./support/screenshots";
import { expectTextContrast, themedName, THEMES } from "./support/theme";

// Issue #464: the shell in the Design System (ADR-0053), shared by both sides (SidebarShell): the Sidebar on the nav
// surface with the Usage Meter at its foot and the Signalement icon on « Mon compte »'s row, the Top Bar with AI
// Activity and « Aide et coach ». Screenshot baselines of the shell on a Candidate page (Confort) and a Back Office
// page (Compact), light and dark (#473), at three widths, and on a phone its drawer too. Only the shell is compared: the page in
// `<main>` is masked, each page's ticket brings its own baseline (#465 to #469).
//
// Baselines are drawn in the Playwright image CI's `screenshots` job compares in (`{arg}.png`, no platform suffix, see
// playwright.config.ts): anywhere else, a Linux machine included, fonts render otherwise, so the comparison runs only
// where comparesScreenshots() says (e2e/support/screenshots.ts); elsewhere the shell is still opened, contrasted and
// checked with axe. To redraw them: scripts/update-screenshot-baselines.sh e2e/shell-screenshots.spec.ts
// (docs/agents/screenshot-baselines.md). On a Mac, the browser can also run in the Playwright container:
//   docker run --rm --init -p 3464:3464 mcr.microsoft.com/playwright:v1.63.0-noble \
//     npx -y playwright@1.63.0 run-server --port 3464 --host 0.0.0.0
//   E2E_SCREENSHOTS=1 PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3464/ PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' \
//     npx playwright test e2e/shell-screenshots.spec.ts --update-snapshots
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own permanent super-admin (ADMIN_EMAILS): two sign-ins of one address at once can pick up each other's link.
const BACK_OFFICE = "shell-office@e2e.jobbbox.test";

const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  // The narrowest width with the Sidebar beside the page (64rem).
  { name: "laptop", width: 1024, height: 768 },
  // Below 64rem the Sidebar is a drawer, shot open too.
  { name: "phone", width: 390, height: 844 },
] as const;

const masterCv = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

/**
 * The shell as the person sees it, the page itself masked. On a phone, then its Sidebar: the drawer, opened, shot on its
 * own (a mask is drawn over everything, so the page under the drawer cannot be masked behind it).
 */
async function shellScreenshot(page: Page, name: string, phone: boolean) {
  // Inter, self-hosted, drawn before the shot.
  await page.evaluate(() => document.fonts.ready);
  const options = {
    animations: "disabled" as const,
    caret: "hide" as const,
    mask: [page.locator(".sidebar-count")],
    maxDiffPixelRatio: 0.01,
    // A loaded machine takes a while to draw two stable shots in a row.
    timeout: 20_000,
  };
  const compares = comparesScreenshots();
  if (compares) await expect(page).toHaveScreenshot(`${name}.png`, { ...options, mask: [...options.mask, page.locator("#main")] });
  if (!phone) return;
  await page.getByRole("button", { name: fr.sidebar.menu, exact: true }).click();
  const drawer = page.getByRole("dialog", { name: fr.sidebar.menu });
  await expect(drawer).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  if (compares) await expect(drawer).toHaveScreenshot(`${name}-menu.png`, options);
}

/** axe on the shell, the page left out (its own ticket checks it). */
async function axeOnShell(page: Page) {
  const results = await new AxeBuilder({ page }).exclude("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
}

for (const theme of THEMES) for (const viewport of WIDTHS) {
  // Dark is the device's preference, which the default choice, Système, follows (#473).
  test.describe(`the shell in the Design System (${viewport.name}${theme === "dark" ? ", dark" : ""})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: theme });

    test("on a Candidate page: the Sidebar with the Profile switcher and the Usage Meter, the Top Bar", async ({ page }) => {
      await signInWithMagicLink(page, newAddress(`shell-${viewport.name}-${theme}`));
      const response = await page.request.post("/api/profiles", {
        headers: { origin },
        data: { masterCv, searchCriteria: { targetRole: masterCv.headline, locations: ["Lyon"], contractTypes: ["cdi"] } },
      });
      expect(response.status()).toBe(201);
      await page.goto("/candidatures");
      await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("progressbar", { name: fr.usageMeter.title })).toHaveCount(viewport.name === "phone" ? 0 : 1);

      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (theme === "dark") await expectTextContrast(page, `candidate-${viewport.name}`);
      await shellScreenshot(page, themedName(`candidate-${viewport.name}`, theme), viewport.name === "phone");
      await axeOnShell(page);
    });

    test("on a Back Office page: the Sidebar's groups, in the Compact Density", async ({ page }) => {
      await signInWithMagicLink(page, BACK_OFFICE);
      // Quotas: a light page, so the shot is quick to settle (the Dashboard draws charts).
      await page.goto("/admin/quotas");
      await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toBeVisible();

      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (theme === "dark") await expectTextContrast(page, `back-office-${viewport.name}`);
      await shellScreenshot(page, themedName(`back-office-${viewport.name}`, theme), viewport.name === "phone");
      await axeOnShell(page);
    });
  });
}

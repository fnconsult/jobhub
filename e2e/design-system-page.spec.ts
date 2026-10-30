import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { comparesScreenshots, SCREENSHOT_WIDTHS } from "./support/screenshots";

// Issue #463 (ADR-0053): the Design System page, under Plateforme. Every Back Office Role reads it, no Candidate does;
// its toggles set the theme and Density of its content only. Its screenshot baselines, in light and dark, Confort and
// Compact, at three widths, live in e2e/__screenshots__ and fail CI on a visual difference; axe runs on each.
// How to update a baseline on purpose: docs/agents/screenshot-baselines.md.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const p = fr.designSystem.page;
const PAGE = "/admin/design-system";
// Its own permanent super-admin (playwright.config.ts): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "design-system-page-office@e2e.jobbbox.test";
const SCREENS_SUPER_ADMIN = "design-system-screens-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;

const THEMES = { light: { query: null, label: p.light }, dark: { query: "theme=sombre", label: p.dark } } as const;
const DENSITIES = { confort: { query: null, label: p.confort }, compact: { query: "densite=compact", label: p.compact } } as const;

const preview = (page: Page) => page.locator("[data-design-system-preview]");
const backOfficeNav = (page: Page) => page.getByRole("navigation", { name: admin.nav.label });

function pageFor(theme: keyof typeof THEMES, density: keyof typeof DENSITIES): string {
  const query = [THEMES[theme].query, DENSITIES[density].query].filter(Boolean).join("&");
  return query ? `${PAGE}?${query}` : PAGE;
}

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The super-admin grants `role` to the account with `email` on the Administrateurs page. */
async function grant(superAdmin: Page, email: string, role: string) {
  await superAdmin.goto("/admin/administrateurs");
  await superAdmin.getByLabel(admin.administrators.grantEmail).fill(email);
  await superAdmin.getByRole("checkbox", { name: admin.roles[role] }).check();
  await superAdmin.getByRole("button", { name: admin.administrators.grant }).click();
  await expect(superAdmin.getByRole("status")).toContainText(admin.roles[role]);
}

/** The page drawn and still: Inter loaded, every finite animation over. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("[data-design-system-preview]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("Design System page (#463)", () => {
  test("a Candidate gets a 404; a Help editor, whose role covers no platform section, reads it from Plateforme", async ({ page, browser }) => {
    const candidate = await personPage(browser, newAddress("design-system-candidate"));
    expect((await candidate.goto(PAGE))?.status()).toBe(404);
    await expect(candidate.getByRole("heading", { level: 1 })).toHaveText(fr.errorPage.notFound.title);

    await signInWithMagicLink(page, SUPER_ADMIN);
    const email = newAddress("design-system-help-editor");
    const helpEditor = await personPage(browser, email);
    await grant(page, email, "help-editor");

    await helpEditor.goto("/admin");
    await expect(backOfficeNav(helpEditor).getByRole("heading", { name: admin.nav.groups.platform })).toBeVisible();
    await backOfficeNav(helpEditor).getByRole("link", { name: admin.sections.designSystem }).click();
    // Its whole catalogue renders on the server: on a loaded machine, it may take a few seconds.
    await expect(helpEditor).toHaveURL(new RegExp(`${PAGE}$`), { timeout: 20_000 });
    await expect(helpEditor.getByRole("heading", { level: 1 })).toHaveText(admin.sections.designSystem);
    await expect(helpEditor).toHaveTitle(`${admin.sections.designSystem} · ${admin.title}`);
    await expect(helpEditor.getByRole("heading", { level: 2, name: p.foundations })).toBeVisible();
  });

  test("its toggles set the theme and Density of its content only, its overlays too, and its address follows them", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(PAGE);
    await expect(preview(page)).toHaveAttribute("data-theme", "light");
    await expect(preview(page)).toHaveAttribute("data-density", "confort");
    const navBackground = await backOfficeNav(page).evaluate((nav) => getComputedStyle(nav.closest("aside") ?? nav).backgroundColor);

    await page.getByRole("radiogroup", { name: p.theme }).getByRole("radio", { name: p.dark }).click();
    await page.getByRole("radiogroup", { name: p.density }).getByRole("radio", { name: p.compact }).click();
    await expect(preview(page)).toHaveAttribute("data-theme", "dark");
    await expect(preview(page)).toHaveAttribute("data-density", "compact");
    await expect(page).toHaveURL(new RegExp(`${PAGE}\\?theme=sombre&densite=compact$`));
    // The content is drawn dark, at the Compact body size; the Back Office around it is not.
    expect(await preview(page).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(18, 18, 25)");
    expect(await preview(page).evaluate((element) => getComputedStyle(element).fontSize)).toBe(
      await page.evaluate(() => `${parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.875}px`),
    );
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    expect(await backOfficeNav(page).evaluate((nav) => getComputedStyle(nav.closest("aside") ?? nav).backgroundColor)).toBe(navBackground);

    // The Drawer opens inside the content, in its theme.
    await preview(page).getByRole("button", { name: fr.designSystem.gallery.openDrawer }).click();
    const drawer = page.getByRole("dialog", { name: fr.designSystem.gallery.drawerTitle });
    await expect(drawer).toBeVisible();
    expect(await drawer.evaluate((element) => element.closest("[data-design-system-preview]")?.getAttribute("data-theme"))).toBe("dark");
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(preview(page)).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radiogroup", { name: p.density }).getByRole("radio", { name: p.compact })).toHaveAttribute("aria-checked", "true");
  });

});

test.describe("Design System page's screenshots (#463)", () => {
  // One super-admin's session, their own, for every theme and Density: one sign-in, not four in a row.
  let session: BrowserContext;
  test.beforeAll(async ({ browser }) => {
    session = await browser.newContext({ baseURL: origin, locale: "en-US" });
    await signInWithMagicLink(await session.newPage(), SCREENS_SUPER_ADMIN);
  });
  test.afterAll(async () => {
    await session.close();
  });

  for (const theme of Object.keys(THEMES) as (keyof typeof THEMES)[]) {
    for (const density of Object.keys(DENSITIES) as (keyof typeof DENSITIES)[]) {
      test(`matches its baseline in ${theme} and ${density} at every width, and axe passes`, async () => {
        const page = await session.newPage();
        for (const { name, width, height } of SCREENSHOT_WIDTHS) {
          await page.setViewportSize({ width, height });
          await page.goto(pageFor(theme, density));
          // Its whole catalogue renders on the server: on a loaded machine, it may take a few seconds.
          await expect(preview(page)).toHaveAttribute("data-theme", theme, { timeout: 20_000 });
          await expect(preview(page)).toHaveAttribute("data-density", density);
          await settled(page);
          // Nothing runs off the side: a wide table scrolls in its own frame.
          expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: the page's width`).toBeLessThanOrEqual(width);
          await expectNoAxeViolations(page);
          if (comparesScreenshots()) {
            // The window as tall as the page, so the whole content is drawn at once, with nothing to scroll into view.
            await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
            await settled(page);
            await expect(preview(page)).toHaveScreenshot(`design-system-${theme}-${density}-${name}.png`);
          }
        }
        await page.close();
      });
    }
  }
});

import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { comparesScreenshots, SCREENSHOT_WIDTHS } from "./support/screenshots";
import { expectTextContrast, showInTheme, themedName, THEMES } from "./support/theme";

// ADR-0105: the landing page a Visitor reads at `/` (and `/en`) before signing in, in the public shell with the logo:
// one action, the method as a story read by scrolling, the Plans and store links as the Back Office sets them.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const STEPS = ["cv", "offers", "application", "followUp"] as const;

async function expectNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), label).toEqual([]);
}

test.describe("the landing page (ADR-0105)", () => {
  test("says what Jobbbox does, offers one action, and shows the logo in the public shell", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(fr.landing.meta.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", fr.landing.meta.description);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(fr.landing.hero.title);
    await expect(main.getByText(fr.landing.hero.lead, { exact: true })).toBeVisible();
    // The same action opens and closes the page: the sign-in page, where an account is created.
    const actions = main.getByRole("link", { name: fr.landing.cta });
    await expect(actions).toHaveCount(2);
    for (const action of await actions.all()) await expect(action).toHaveAttribute("href", "/connexion");
    // The public shell: its header with the logo beside the name, its navigation, its footer.
    const brand = page.getByRole("banner").getByRole("link", { name: fr.app.name, exact: true });
    await expect(brand).toHaveAttribute("href", "/");
    await expect(brand.locator("svg.ds-logo")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("navigation", { name: fr.publicSite.nav })).toBeVisible();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: fr.publicFooter.legal.mentionsLegales })).toBeVisible();
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
  });

  test("tells the method in four steps, each with the product's screen, read out in order", async ({ page }) => {
    await page.goto("/");
    const steps = page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3 }) });
    await expect(steps).toHaveCount(STEPS.length);
    for (const [index, step] of STEPS.entries()) {
      await expect(steps.nth(index)).toContainText(fr.landing.method.steps[step].label);
      await expect(steps.nth(index).getByRole("heading", { level: 3 })).toHaveText(fr.landing.method.steps[step].title);
      await expect(steps.nth(index)).toContainText(fr.landing.method.steps[step].text);
    }
    // The screen that stays in view follows the step being read: one picture at a time, each one image with its description.
    const views = page.locator(".landing-story__view");
    await expect(views.first()).toHaveAttribute("data-reading", "");
    await expect(page.getByRole("img", { name: fr.landing.screens.conversation.alt })).toHaveCount(2);
    await page.evaluate(() => document.querySelectorAll(".landing-story__step")[1]!.scrollIntoView({ block: "center" }));
    await expect(views.nth(1)).toHaveAttribute("data-reading", "");
    await expect(page.getByRole("img", { name: fr.landing.screens.offers.alt })).toBeVisible();
    await expect(page.getByRole("img", { name: fr.landing.screens.conversation.alt })).toHaveCount(1);
    await expect(page.getByRole("main")).toContainText(fr.landing.coach.quote);
  });

  test("shows the Plans as the Back Office offers them, and no store link that Paramètres does not set", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: fr.landing.plans.title })).toBeVisible();
    for (const plan of [fr.billing.plans.free, fr.billing.plans.standard, fr.billing.plans.premium]) await expect(main.getByRole("heading", { level: 3, name: plan, exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: fr.landing.plans.detail })).toHaveAttribute("href", "/aide/decouvrir/faq-plans-and-quotas");
    // Nothing stands in for a link that is not set: no placeholder, no « coming soon ».
    for (const link of [fr.landing.tools.extension.install, fr.landing.tools.app.appStore, fr.landing.tools.app.playStore]) await expect(main.getByRole("link", { name: link })).toHaveCount(0);
  });

  test("answers the questions asked before starting, each one opened by the keyboard", async ({ page }) => {
    await page.goto("/");
    const question = page.getByText(fr.landing.questions.person.question, { exact: true });
    await expect(page.getByText(fr.landing.questions.person.answer, { exact: true })).toBeHidden();
    await question.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(fr.landing.questions.person.answer, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: fr.landing.questions.more })).toHaveAttribute("href", "/aide");
  });

  test("is in English at /en, its links staying in English", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(en.landing.meta.title);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(en.landing.hero.title);
    await expect(main.getByRole("link", { name: en.landing.cta }).first()).toHaveAttribute("href", "/en/connexion");
    await expect(main.getByRole("link", { name: en.landing.questions.more })).toHaveAttribute("href", "/en/aide");
    await expect(main.getByRole("link", { name: en.landing.plans.detail })).toHaveAttribute("href", "/en/aide/decouvrir/faq-plans-and-quotas");
  });

  test("moves nothing under reduced motion: the logo and the conversation are drawn as they rest", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test("keeps its look and the accessibility floor at every width, in both themes", async ({ page }) => {
    test.slow();
    // Still, as reduced motion draws it: the baselines do not depend on where an entrance is.
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const { name: width, ...viewport } of SCREENSHOT_WIDTHS) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      for (const theme of THEMES) {
        const label = `landing ${width} ${theme}`;
        await showInTheme(page, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} fits the width`).toBe(true);
        await expectNoAxeViolations(page, label);
        if (theme === "dark") await expectTextContrast(page, label);
        // Soft: one run then shows every width and theme that changed, not only the first.
        if (comparesScreenshots()) await expect.soft(page).toHaveScreenshot(`${themedName(`landing-${width}`, theme)}.png`, { fullPage: true });
      }
    }
  });
});

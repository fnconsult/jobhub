import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { comparesScreenshots, SCREENSHOT_WIDTHS } from "./support/screenshots";
import { expectTextContrast, showInTheme, themedName } from "./support/theme";

// Issue #466 (ADR-0053): every other Back Office section in the Compact Density, on the components, with Paramètres
// (#465) as the model. Their screenshot baselines, light and dark (#473), at the desktop width, live in e2e/__screenshots__ and fail CI on
// a visual difference; axe runs on each. Only the page (`<main>`) is compared: the shell has its own baselines
// (shell-screenshots.spec.ts). What other specs change runs alongside (the screenshot specs share one server): who holds a
// Back Office Role, and every count of calls or cost. So Administrateurs is shot by its form, with the Administrators
// table above it left out (its rows are not a whole number of pixels high: one more Administrator moved the form by a
// fraction of a pixel, and every line of its text was drawn otherwise), Consommation IA by its totals with their figures
// masked, and Outils with its figures masked.
// How to update a baseline on purpose: docs/agents/screenshot-baselines.md.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
// Its own permanent super-admin (playwright.config.ts): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "sections-office@e2e.jobbbox.test";
const origin = process.env.E2E_WEB_ORIGIN!;
const DESKTOP = SCREENSHOT_WIDTHS.find((width) => width.name === "desktop")!;

type Section = {
  name: string;
  path: string;
  /** Drawn: what shows the page has its data. */
  ready: (page: Page) => Locator;
  /** What is compared: the whole page, unless what is in it changes with the other specs. */
  target?: (page: Page) => Locator;
  /** What changes with the day or with the other specs, masked. */
  mask?: string[];
  /** What the other specs lengthen above the target, left out of the page before it is shot, so the target lands where it did. */
  leaveOut?: string[];
};

const SECTIONS: Section[] = [
  { name: "signalements", path: "/admin/signalements", ready: (page) => page.getByRole("navigation", { name: admin.signalements.statusFilter }) },
  { name: "offres", path: "/admin/offres", ready: (page) => page.getByRole("table", { name: admin.plans.caption }) },
  { name: "quotas", path: "/admin/quotas", ready: (page) => page.getByRole("heading", { name: admin.planQuotas.reset.title }) },
  { name: "codes-promo", path: "/admin/codes-promo", ready: (page) => page.getByRole("heading", { name: admin.coupons.createTitle }) },
  { name: "coachs", path: "/admin/coachs", ready: (page) => page.getByRole("heading", { name: admin.humanCoaches.addTitle }) },
  { name: "cout-coach", path: "/admin/cout-coach", ready: (page) => page.getByRole("heading", { name: admin.coachCost.agents.title }) },
  { name: "playbooks", path: "/admin/playbooks", ready: (page) => page.getByRole("table", { name: admin.coachingPlaybooks.caption }), mask: ["main tbody td:nth-child(2)"] },
  { name: "garde-fous", path: "/admin/garde-fous", ready: (page) => page.getByRole("table", { name: admin.guardrails.caption }) },
  {
    name: "questions-sans-reponse",
    path: "/admin/questions-sans-reponse",
    ready: (page) => page.getByRole("navigation", { name: admin.unansweredQuestions.languageFilter }),
  },
  { name: "outils", path: "/admin/outils", ready: (page) => page.getByRole("table", { name: admin.tools.categories.ai_model }), mask: ["main td[data-numeric]"] },
  {
    name: "administrateurs",
    path: "/admin/administrateurs",
    ready: (page) => page.getByRole("heading", { name: admin.administrators.grantTitle }),
    target: (page) => page.locator("main form").filter({ has: page.getByRole("heading", { name: admin.administrators.grantTitle }) }),
    leaveOut: ["main .ds-table-wrap"],
  },
  {
    name: "consommation-ia",
    path: "/admin/consommation-ia",
    ready: (page) => page.getByRole("heading", { name: admin.aiUsage.totalsTitle }),
    target: (page) => page.locator('section[aria-labelledby="totals-title"]'),
    mask: [".ds-stat__value", ".ds-stat__meta", ".ds-props dd"],
  },
];

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

/** Shot as toHaveScreenshot shoots it (playwright.config.ts): animations stopped, caret hidden. */
function shoot(target: Locator) {
  return target.screenshot({ animations: "disabled", caret: "hide" });
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("every other Back Office section in the Design System (#466)", () => {
  // One super-admin's session, their own, for every section: one sign-in, not twelve in a row.
  let session: BrowserContext;
  test.beforeAll(async ({ browser }) => {
    session = await browser.newContext({ baseURL: origin, locale: "en-US", colorScheme: "light" });
    await signInWithMagicLink(await session.newPage(), SUPER_ADMIN);
  });
  test.afterAll(async () => {
    await session.close();
  });

  for (const section of SECTIONS) {
    test(`${section.name}: in the Compact Density, drawn with the components, matches its baseline at the desktop width, and axe passes`, async () => {
      const page = await session.newPage();
      await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
      await page.goto(section.path);
      await expect(section.ready(page)).toBeVisible({ timeout: 20_000 });
      // In the Back Office's Density, drawn with the Design System's components (ADR-0053), its intro or its form on them.
      await expect(page.locator(".density-scope[data-density=compact] #main")).toBeAttached();
      await expect(page.locator("main :is(.page-intro, .ds-card, .ds-table)").first()).toBeAttached();
      await settled(page);
      // Nothing runs off the side: a wide table scrolls in its own frame.
      expect(await page.evaluate(() => document.documentElement.scrollWidth), "the page's width").toBeLessThanOrEqual(DESKTOP.width);
      await expectNoAxeViolations(page);
      if (section.leaveOut) await page.addStyleTag({ content: `${section.leaveOut.join(", ")} { display: none !important; }` });
      // The page whole, its column drawn at once with nothing to scroll into view.
      const fitPage = async () => {
        await page.setViewportSize({ width: DESKTOP.width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
        await settled(page);
      };
      await fitPage();
      const target = section.target?.(page) ?? page.locator("#main");
      if (section.leaveOut) {
        // What is left out could hold anything when the target is shot: twice as long, the target is drawn the same, on any machine.
        const before = await shoot(target);
        for (const selector of section.leaveOut) {
          await page.locator(selector).evaluateAll((elements) => elements.forEach((element) => element.after(element.cloneNode(true))));
        }
        await fitPage();
        expect((await shoot(target)).equals(before), `the ${section.name} shot moves with ${section.leaveOut.join(", ")}`).toBe(true);
      }
      if (comparesScreenshots()) {
        await expect(target).toHaveScreenshot(`${section.name}-desktop.png`, { mask: (section.mask ?? []).map((selector) => page.locator(selector)) });
      }
      // The same section in dark (#473): axe and every text at AA, then its own baseline.
      await showInTheme(page, "dark");
      await settled(page);
      await expectNoAxeViolations(page);
      await expectTextContrast(page, section.name);
      if (comparesScreenshots()) {
        await expect(target).toHaveScreenshot(`${themedName(`${section.name}-desktop`, "dark")}.png`, { mask: (section.mask ?? []).map((selector) => page.locator(selector)) });
      }
      await page.close();
    });
  }
});

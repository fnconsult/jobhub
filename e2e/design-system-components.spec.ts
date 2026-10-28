import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fontFloorOf, renderedTexts } from "./support/accessibility";

// Issue #462 (ADR-0053): the Design System's components, every one on the components' test page, checked by axe in
// both Densities, with their overlays open, and driven from the keyboard in a real browser.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const g = fr.designSystem.gallery;
const PAGE = "/design-system/composants";
const DENSITIES = ["confort", "compact"] as const;

async function expectNoAxeViolations(page: Page, selector = "body") {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

async function openTestPage(page: Page, density: (typeof DENSITIES)[number]) {
  await page.goto(density === "compact" ? `${PAGE}?densite=compact` : PAGE);
  await expect(page.getByRole("heading", { level: 1, name: g.title })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("data-density", density);
}

test.describe("Design System components (#462)", () => {
  for (const density of DENSITIES) {
    test(`axe passes on every component in ${density}, the Drawer, the Dialog and the Toast open too`, async ({ page }) => {
      await openTestPage(page, density);
      await expectNoAxeViolations(page);
      for (const t of await renderedTexts(page)) {
        expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(fontFloorOf(t));
        expect.soft(t.contrast, `contrast of "${t.text}" (${t.color} on ${t.background})`).toBeGreaterThanOrEqual(4.5);
      }

      await page.getByRole("button", { name: g.openDrawer }).click();
      await expect(page.getByRole("dialog", { name: g.drawerTitle })).toBeVisible();
      await expectNoAxeViolations(page, "[role=dialog]");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: g.openDialog }).click();
      await expect(page.getByRole("alertdialog", { name: g.dialogTitle })).toBeVisible();
      await expectNoAxeViolations(page, "[role=alertdialog]");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: g.showToast }).click();
      await expect(page.getByRole("link", { name: g.toastLink })).toBeVisible();
      await expectNoAxeViolations(page, ".ds-toast-region");
    });
  }

  test("Tabs and the segmented control move with the arrow keys", async ({ page }) => {
    await openTestPage(page, "confort");
    await page.getByRole("tab", { name: g.webSearch }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: g.ai })).toBeFocused();
    await expect(page.getByRole("tabpanel")).toHaveText(g.aiPanel);
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: g.email })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: g.webSearch })).toBeFocused();

    const period = page.getByRole("radiogroup", { name: g.period });
    await period.getByRole("radio", { name: g.week }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(period.getByRole("radio", { name: g.month })).toBeFocused();
    await expect(period.getByRole("radio", { name: g.month })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(period.getByRole("radio", { name: g.year })).toHaveAttribute("aria-checked", "true");
    // One Tab stop: Tab leaves the group.
    await page.keyboard.press("Tab");
    await expect(period.locator(":focus")).toHaveCount(0);
  });

  test("the Drawer and the Dialog close on Escape, the focus back on what opened them; a clickable row opens with Enter", async ({ page }) => {
    await openTestPage(page, "compact");
    const openDrawer = page.getByRole("button", { name: g.openDrawer });
    await openDrawer.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: g.drawerTitle });
    await expect(drawer).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(openDrawer).toBeFocused();

    const openDialog = page.getByRole("button", { name: g.openDialog });
    await openDialog.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: fr.designSystem.cancel })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(openDialog).toBeFocused();

    const row = page.getByRole("row").filter({ hasText: "Tavily" });
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(g.openedRow.replace("{{name}}", "Tavily"))).toBeVisible();
  });
});

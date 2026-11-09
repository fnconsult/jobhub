import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #923 (variant A of #914): « Mon compte » in the Candidate's Sidebar foot shows the name they are called by (their
// Preferred Name, else their Given Name, else « Mon compte ») and their Plan, beside their initials, and is named
// « Mon compte, Mimi, Premium ». Its menu is headed by « Prénom Nom » and the email, and « Mon abonnement », the Plan at
// the end of its line, leads to /abonnement. On a phone, in the Sidebar's drawer.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

/** Where the Sidebar is: docked beside the page from 64rem, else in the drawer « Menu » opens. */
async function sidebar(page: Page, phone: boolean): Promise<Locator> {
  if (!phone) return page.locator(".sidebar-docked");
  await page.getByRole("button", { name: fr.sidebar.menu, exact: true }).click();
  const drawer = page.getByRole("dialog", { name: fr.sidebar.menu });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).exclude("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

for (const width of [1280, 390]) {
  const phone = width < 1024;
  test.describe(`« Mon compte » in the Sidebar's foot at ${width} px (#923)`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("shows the Preferred Name and the Plan; its menu leads to Mon abonnement; axe passes", async ({ page }) => {
      const email = newAddress(`sidebar-account-${width}`);
      await signInWithMagicLink(page, email);
      // No name yet: « Mon compte », and Free.
      await page.goto("/candidatures");
      let foot = await sidebar(page, phone);
      await expect(foot.getByRole("button", { name: `${fr.nav.account}, ${fr.billing.plans.free}`, exact: true })).toBeVisible();
      if (phone) await page.keyboard.press("Escape");

      const saved = await page.request.put("/api/account/identity", { headers: { origin }, data: { givenName: "Marie", familyName: "Dupont", preferredName: "Mimi" } });
      expect(saved.ok()).toBe(true);
      await subscribe(page, email, "premium");
      await page.goto("/candidatures");

      foot = await sidebar(page, phone);
      const account = foot.getByRole("button", { name: `${fr.nav.account}, Mimi, ${fr.billing.plans.premium}`, exact: true });
      await expect(account).toBeVisible();
      await expect(account.locator(".account-name")).toHaveText("Mimi");
      await expect(account.locator(".account-plan")).toHaveText(fr.billing.plans.premium);
      await expect(account.locator(".account-initials")).toHaveText("MD");
      // The Signalement icon stays on its row, to its right.
      const [accountBox, iconBox] = [(await account.boundingBox())!, (await foot.getByRole("button", { name: fr.signalement.open, exact: true }).boundingBox())!];
      expect(iconBox.x).toBeGreaterThan(accountBox.x + accountBox.width - 1);
      await expectNoAxeViolations(page);

      await account.click();
      const menu = page.getByRole("menu");
      await expect(menu.locator(".account-menu-head")).toContainText("Marie Dupont");
      await expect(menu.locator(".account-menu-head")).toContainText(email);
      await expect(menu.getByRole("menuitem")).toHaveText([
        fr.publicSite.help,
        fr.publicSite.legal,
        fr.publicSite.nouveautes,
        fr.nav.account,
        `${fr.account.plan}${fr.billing.plans.premium}`,
        fr.account.signOut,
      ]);
      await expectNoAxeViolations(page);

      await menu.getByRole("menuitem", { name: new RegExp(`^${fr.account.plan}`) }).click();
      await expect(page).toHaveURL(`${origin}/abonnement`);
      await expect(page.getByRole("menu")).toHaveCount(0);
      if (phone) await expect(page.getByRole("dialog", { name: fr.sidebar.menu })).toHaveCount(0);
    });
  });
}

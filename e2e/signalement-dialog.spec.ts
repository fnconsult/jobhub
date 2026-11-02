import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { SIGNALEMENT_GLYPHS } from "../apps/web/src/components/signalement-glyphs";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #375: the Signalement form, opened by the icon beside « Mon compte » in the Sidebar's foot. Bug / Idée, a
// message of 10 to 2,000 characters, its context attached automatically and stored through POST /api/signalements
// (#374); the title's icon follows the type, morphing with SMIL only when motion is allowed. Since #602 and #608 the
// form opens in the Work Pane beside the page, not in a dialog: the pane's title takes the focus as it opens, its ✕,
// Escape or « Annuler » closes it, the focus back on the icon. Driven in the browser.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const s = fr.signalement;
const databaseUrl = process.env.E2E_DATABASE_URL!;

const iconOf = (page: Page) => page.getByRole("button", { name: s.open, exact: true });
/** The form, in the Work Pane, named by its title. */
const dialogOf = (page: Page) => page.getByRole("complementary", { name: s.title });
const titleOf = (page: Page) => dialogOf(page).getByRole("heading", { level: 2, name: s.title });
const messageOf = (page: Page) => dialogOf(page).getByRole("textbox");
const sendOf = (page: Page) => dialogOf(page).getByRole("button", { name: s.send, exact: true });
const titlePathOf = (page: Page) => dialogOf(page).locator(".signalement-title svg path");

async function storedSignalements(email: string) {
  const db = new pg.Pool({ connectionString: databaseUrl });
  try {
    const { rows } = await db.query(
      `SELECT type, message, path, version, browser, interface_language, text_size FROM signalement
        WHERE candidate_id = (SELECT id FROM candidate WHERE lower(email) = lower($1)) ORDER BY created_at`,
      [email],
    );
    return rows;
  } finally {
    await db.end();
  }
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

/** Counts every `<animate>` added under the dialog's title from now on, even one removed once played. */
async function countAnimatesAdded(page: Page) {
  await page.evaluate(() => {
    const title = document.querySelector(".work-pane .signalement-title")!;
    const w = window as unknown as { animatesAdded: number };
    w.animatesAdded = 0;
    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) if (node.nodeName.toLowerCase() === "animate") w.animatesAdded++;
    }).observe(title, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as unknown as { animatesAdded: number }).animatesAdded);
}

test.describe("the Signalement form (#375, #608)", () => {
  test("the icon beside Mon compte opens the form in the Work Pane; a Bug and an Idée are stored with their context, and the form thanks", async ({ page }) => {
    const email = newAddress("signalement-dialog-send");
    await signInWithMagicLink(page, email);
    await page.goto("/candidatures");

    // An icon alone, on Mon compte's row, to its right, a 44 px target.
    const account = page.locator(".sidebar-docked").getByRole("button", { name: fr.nav.account, exact: true });
    const icon = page.locator(".sidebar-docked").getByRole("button", { name: s.open, exact: true });
    await expect(icon).toBeVisible();
    // No words beside it: its name shows only as the tooltip.
    await expect(page.locator(".sidebar-docked .signalement-tip")).toBeHidden();
    const [accountBox, iconBox] = [(await account.boundingBox())!, (await icon.boundingBox())!];
    expect(iconBox.x).toBeGreaterThan(accountBox.x + accountBox.width - 1);
    expect(Math.abs(iconBox.y + iconBox.height / 2 - (accountBox.y + accountBox.height / 2))).toBeLessThan(4);
    expect(iconBox.width).toBeGreaterThanOrEqual(44);
    expect(iconBox.height).toBeGreaterThanOrEqual(44);
    // Its tooltip, on hover.
    await icon.hover();
    await expect(page.locator(".sidebar-docked .signalement-tip")).toBeVisible();
    // Nothing in the Top Bar.
    await expect(page.locator(".topbar").getByRole("button", { name: s.open, exact: true })).toHaveCount(0);

    await icon.click();
    await expect(dialogOf(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(dialogOf(page).getByRole("radio", { name: s.types.bug })).toBeChecked();
    await expect(titleOf(page)).toBeFocused();
    await expect(dialogOf(page).getByLabel(s.label.bug)).toBeVisible();
    await expect(messageOf(page)).toHaveAttribute("placeholder", s.placeholder.bug);
    await expect(dialogOf(page)).toContainText(s.notice);
    await expect(dialogOf(page)).toContainText(s.readBy);
    await dialogOf(page).getByRole("button", { name: s.showDetail }).click();
    const detail = dialogOf(page).locator(".signalement-detail");
    await expect(detail).toContainText("/candidatures");
    await expect(detail).toContainText(/Chrome \d+/);
    await expect(detail).toContainText(fr.languages.fr);
    await expect(detail).toContainText(fr.textSize.standard);

    const bugMessage = "Le bouton Enregistrer ne répond plus.";
    await messageOf(page).fill(bugMessage);
    await expect(dialogOf(page)).toContainText(`${bugMessage.length} / 2000`);
    await sendOf(page).click();
    await expect(dialogOf(page).getByRole("status")).toContainText(s.thanks);
    await dialogOf(page).locator(".signalement-actions").getByRole("button", { name: s.close, exact: true }).click();
    await expect(dialogOf(page)).toBeHidden();
    await expect(icon).toBeFocused();

    // Again, an Idée, sent with Cmd/Ctrl+Enter; the draft starts empty after a send.
    await icon.click();
    await expect(messageOf(page)).toHaveValue("");
    await dialogOf(page).getByRole("radio", { name: s.types.idee }).check();
    await expect(dialogOf(page).getByLabel(s.label.idee)).toBeVisible();
    await expect(messageOf(page)).toHaveAttribute("placeholder", s.placeholder.idee);
    await messageOf(page).fill("Pouvoir trier les candidatures par date.");
    await messageOf(page).press("ControlOrMeta+Enter");
    await expect(dialogOf(page).getByRole("status")).toContainText(s.thanks);

    const stored = await storedSignalements(email);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ type: "bug", message: "Le bouton Enregistrer ne répond plus.", path: "/candidatures", text_size: "standard" });
    expect(stored[1]).toMatchObject({ type: "idee", message: "Pouvoir trier les candidatures par date.", path: "/candidatures" });
    for (const row of stored) {
      expect(row.browser).toMatch(/^Chrome \d+, /);
      expect(row.interface_language).toBe("fr");
      expect(row.version).toBeTruthy();
    }
  });

  test("under 10 characters sending is refused inline; Esc keeps the draft, and reopening shows it", async ({ page }) => {
    const email = newAddress("signalement-dialog-short");
    await signInWithMagicLink(page, email);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/signalements") posts.push(request.url());
    });

    await iconOf(page).click();
    await messageOf(page).fill("Trop court");
    await expect(dialogOf(page)).toContainText("10 / 2000");
    await messageOf(page).fill("Court");
    await sendOf(page).click();
    await expect(dialogOf(page).getByText(s.tooShort.replace("{{min}}", "10"))).toBeVisible();
    await expect(messageOf(page)).toHaveAttribute("aria-invalid", "true");
    await expect(messageOf(page)).toBeFocused();
    expect(posts).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toBeHidden();
    await expect(iconOf(page)).toBeFocused();
    await iconOf(page).click();
    await expect(messageOf(page)).toHaveValue("Court");
    // Annuler keeps it too, and so does the type.
    await dialogOf(page).getByRole("radio", { name: s.types.idee }).check();
    await dialogOf(page).getByRole("button", { name: s.cancel, exact: true }).click();
    await expect(iconOf(page)).toBeFocused();
    await iconOf(page).click();
    await expect(messageOf(page)).toHaveValue("Court");
    await expect(dialogOf(page).getByRole("radio", { name: s.types.idee })).toBeChecked();
    expect(await storedSignalements(email)).toEqual([]);
  });

  test("with reduced motion switching Bug ↔ Idée adds no <animate>; without, the title's path morphs and ends on the right glyph", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("signalement-dialog-morph"));

    await page.emulateMedia({ reducedMotion: "reduce" });
    await iconOf(page).click();
    await expect(titlePathOf(page)).toHaveAttribute("d", SIGNALEMENT_GLYPHS.bug);
    let added = await countAnimatesAdded(page);
    await dialogOf(page).getByRole("radio", { name: s.types.idee }).check();
    await expect(titlePathOf(page)).toHaveAttribute("d", SIGNALEMENT_GLYPHS.shapes);
    await dialogOf(page).getByRole("radio", { name: s.types.bug }).check();
    await expect(titlePathOf(page)).toHaveAttribute("d", SIGNALEMENT_GLYPHS.bug);
    await page.waitForTimeout(700);
    expect(await added()).toBe(0);
    await page.keyboard.press("Escape");

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await iconOf(page).click();
    added = await countAnimatesAdded(page);
    await dialogOf(page).getByRole("radio", { name: s.types.idee }).check();
    await expect.poll(added).toBe(1);
    const animate = titlePathOf(page).locator("animate");
    // It morphs from the bug to ○□△ in 0.5 s, once.
    await expect(animate).toHaveAttribute("attributeName", "d");
    await expect(animate).toHaveAttribute("dur", "0.5s");
    await expect(animate).not.toHaveAttribute("repeatCount", /.*/);
    await expect(animate).toHaveAttribute("values", `${SIGNALEMENT_GLYPHS.bug};${SIGNALEMENT_GLYPHS.shapes}`);
    // Then it is gone, and the path rests on ○□△.
    await expect(animate).toHaveCount(0, { timeout: 2_000 });
    await expect(titlePathOf(page)).toHaveAttribute("d", SIGNALEMENT_GLYPHS.shapes);
    await dialogOf(page).getByRole("radio", { name: s.types.bug }).check();
    await expect.poll(added).toBe(2);
    await expect(animate).toHaveCount(0, { timeout: 2_000 });
    await expect(titlePathOf(page)).toHaveAttribute("d", SIGNALEMENT_GLYPHS.bug);
    // The Sidebar's icon never moves.
    await expect(page.locator(".sidebar-docked .signalement-open path")).toHaveAttribute("d", SIGNALEMENT_GLYPHS.bug);
  });

  test("axe passes on the open form; the icon is named « Signalement » and focus returns to it on close; the phone drawer has it too", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("signalement-dialog-a11y"));

    await expect(iconOf(page)).toHaveAccessibleName(s.open);
    await iconOf(page).focus();
    await expect(page.locator(".sidebar-docked .signalement-tip")).toBeVisible();
    await iconOf(page).press("Enter");
    await expect(dialogOf(page)).toBeVisible();
    await expect(titleOf(page)).toBeFocused();
    await dialogOf(page).getByRole("button", { name: s.showDetail }).click();
    await expectNoAxeViolations(page, ".work-pane");
    // Beside the page, not over it: from its title, Tab goes on through the pane's own controls first (#608).
    await titleOf(page).focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".work-pane")))).toBe(true);
    await dialogOf(page).getByRole("button", { name: s.cancel, exact: true }).click();
    await expect(iconOf(page)).toBeFocused();

    // On a phone: the same icon in the drawer; the drawer closes and the form opens over the whole screen, the page behind
    // out of reach; closing it gives the focus to the Menu button, the drawer's icon being gone with it (#608).
    await page.setViewportSize({ width: 390, height: 800 });
    const menu = page.getByRole("button", { name: fr.sidebar.menu, exact: true });
    await menu.click();
    const drawerIcon = page.locator(".sidebar-drawer").getByRole("button", { name: s.open, exact: true });
    await drawerIcon.click();
    await expect(dialogOf(page)).toBeVisible();
    await expect(titleOf(page)).toBeFocused();
    const box = (await dialogOf(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(389);
    await expect(page.locator("main")).toHaveAttribute("inert", "");
    await expectNoAxeViolations(page, ".work-pane");
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(menu).toBeFocused();
  });
});

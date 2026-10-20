import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// The Text Size setting sits in Mon compte → Préférences as a four-step slider
// (Petit, Standard, Moyen, Grand), no longer in the sidebar. It stays on this
// device (localStorage) and never goes below the ADR-0009 16px floor.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

test.describe("the Text Size slider in Préférences", () => {
  test("steps through Petit, Standard, Moyen and Grand, is remembered and survives a reload", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("text-size-slider"));
    await page.goto("/compte/preferences");
    const html = page.locator("html");
    const bodyFontSize = () => page.evaluate(() => getComputedStyle(document.body).fontSize);
    const slider = page.getByRole("slider", { name: fr.textSize.label });

    // Every step is named on screen.
    await expect(page.locator(".text-size-steps li")).toHaveText(["Petit", "Standard", "Moyen", "Grand"]);
    await expect(slider).toHaveAttribute("aria-valuetext", "Standard");
    await expect(html).toHaveAttribute("data-text-size", "standard");
    expect(await bodyFontSize()).toBe("17px");

    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", "Moyen");
    await expect(html).toHaveAttribute("data-text-size", "large");
    expect(await bodyFontSize()).toBe("18px");

    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuetext", "Grand");
    expect(await bodyFontSize()).toBe("20px");
    expect(await page.evaluate(() => localStorage.getItem("jobbbox.textSize"))).toBe("xlarge");

    await page.reload();
    await expect(html).toHaveAttribute("data-text-size", "xlarge");
    await expect(slider).toHaveAttribute("aria-valuetext", "Grand");

    await slider.focus();
    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuetext", "Petit");
    expect(await bodyFontSize()).toBe("16px");
    for (const t of await renderedTexts(page)) expect.soft(t.fontSizePx, t.text).toBeGreaterThanOrEqual(16);
  });

  test("is no longer in the sidebar", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("text-size-not-in-sidebar"));
    await page.goto("/compte/profils");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel(fr.textSize.label)).toHaveCount(0);
  });
});

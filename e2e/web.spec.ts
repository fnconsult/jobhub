import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { catalogueStrings, renderedTexts } from "./support/accessibility";

const frCatalogue = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

test.describe("web app", () => {
  test("health endpoint reports ok", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("speaks French by default, even to an English-speaking browser", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page).toHaveTitle("Jobbbox");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bienvenue sur Jobbbox");
    await expect(page.getByLabel("Taille du texte")).toBeVisible();
    await expect(page.getByLabel("Taille du texte").locator("option")).toHaveText(["Standard", "Grande", "Très grande"]);
  });

  test("every visible string comes from the French catalogue (no hard-coded copy)", async ({ page }) => {
    await page.goto("/");
    const allowed = new Set(catalogueStrings(frCatalogue));
    const texts = await renderedTexts(page);
    expect(texts.length).toBeGreaterThan(3);
    const stray = texts.map((t) => t.text).filter((text) => !allowed.has(text));
    expect(stray).toEqual([]);
  });

  test("meets the ADR-0009 floor: text ≥16px and AA contrast, so never light grey", async ({ page }) => {
    await page.goto("/");
    const texts = await renderedTexts(page);
    for (const t of texts) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}" (${t.color} on ${t.background})`).toBeGreaterThanOrEqual(4.5);
    }
    // Notion-like look: white page.
    const pageBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(pageBackground).toBe("rgb(255, 255, 255)");
  });

  test("text-size setting scales the interface and is remembered", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const bodyFontSize = () => page.evaluate(() => getComputedStyle(document.body).fontSize);
    const select = page.getByLabel("Taille du texte");

    await expect(html).toHaveAttribute("data-text-size", "standard");
    expect(await bodyFontSize()).toBe("16px");

    await select.selectOption({ label: "Grande" });
    await expect(html).toHaveAttribute("data-text-size", "large");
    expect(await bodyFontSize()).toBe("18px");

    await select.selectOption({ label: "Très grande" });
    await expect(html).toHaveAttribute("data-text-size", "xlarge");
    expect(await bodyFontSize()).toBe("20px");
    expect(await page.evaluate(() => localStorage.getItem("jobbbox.textSize"))).toBe("xlarge");

    // Still applied after a reload, and every text stays within the floor.
    await page.reload();
    await expect(html).toHaveAttribute("data-text-size", "xlarge");
    await expect(select).toHaveValue("xlarge");
    expect(await bodyFontSize()).toBe("20px");
    for (const t of await renderedTexts(page)) expect.soft(t.fontSizePx).toBeGreaterThanOrEqual(20);
  });

  test("ignores a stale text-size value in storage", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("jobbbox.textSize", "gigantic"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "standard");
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("16px");
  });
});

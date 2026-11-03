import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The Exit Page: « Vous quittez Jobbbox », between a link and a site outside Jobbbox. It names the site, counts down
// for a person who came from a page of Jobbbox, waits for a click for anyone else, and is not found for a destination
// Jobbbox would not take anyone to. The destination here is a page of the app itself, by its absolute address: the
// e2e stack reaches no other site.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const host = new URL(origin).hostname.replace(/^www\./, "");
const destination = `${origin}/aide`;
const exitPage = (lang?: string) => `/sortie?url=${encodeURIComponent(destination)}${lang ? `&lang=${lang}` : ""}`;

test.describe("the Exit Page", () => {
  test("from a page of Jobbbox, it names the site, counts down, then goes there", async ({ page }) => {
    await page.goto(exitPage(), { referer: `${origin}/nouveautes` });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.errorPage.exit.title);
    await expect(page.getByText(destination, { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText(host);
    await expect(page.getByRole("link", { name: fr.errorPage.exit.continue.replace("{{site}}", host) })).toHaveAttribute("href", destination);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.waitForURL(destination, { timeout: 10_000 });
  });

  test("« Annuler » keeps the person on Jobbbox", async ({ page }) => {
    await page.goto(exitPage(), { referer: `${origin}/nouveautes` });
    await page.getByRole("button", { name: fr.errorPage.exit.cancel }).click();
    await expect(page.getByRole("status")).toHaveText(fr.errorPage.exit.cancelled);
    await page.waitForTimeout(6_000);
    expect(new URL(page.url()).pathname).toBe("/sortie");
  });

  test("reached from outside Jobbbox, it waits for a click", async ({ page }) => {
    await page.goto(exitPage());
    await expect(page.getByRole("status")).toHaveText(fr.errorPage.exit.check);
    await expect(page.getByRole("button", { name: fr.errorPage.exit.cancel })).toHaveCount(0);
    await page.waitForTimeout(6_000);
    expect(new URL(page.url()).pathname).toBe("/sortie");
    await page.getByRole("link", { name: fr.errorPage.exit.continue.replace("{{site}}", host) }).click();
    await page.waitForURL(destination);
  });

  test("speaks English to a Visitor reading the site in English", async ({ page }) => {
    await page.goto(exitPage("en"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.errorPage.exit.title);
  });

  test("fits a phone's width, even for a long site's name", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const longSite = "https://careers.a-very-long-company-name-for-a-job-board.example/offre/1";
    await page.goto(`/sortie?url=${encodeURIComponent(longSite)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.errorPage.exit.title);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await context.close();
  });

  test("is not found for a destination Jobbbox would not take anyone to", async ({ page }) => {
    for (const url of ["javascript:alert(1)", "/compte", `https://jobbbox.ai@${host}/`]) {
      const response = await page.goto(`/sortie?url=${encodeURIComponent(url)}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.errorPage.notFound.title);
    }
  });
});

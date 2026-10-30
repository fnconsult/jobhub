import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Issue #468: the Design System's PDF / DOCX Viewer, on its test page (/design-system/visionneuse) with its two-page
// specimen. Its toolbar says « Page x sur y » as the pages scroll or a thumbnail is chosen, zooms by 25 % steps, fits
// the page to the space, and « Télécharger » gives the very file shown.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const v = fr.designSystem.viewer;
const SPECIMEN = "/api/design-system/specimen-pdf";

test.use({ locale: "fr-FR" });

test.describe("the PDF / DOCX Viewer (#468)", () => {
  test("pages through a two-page PDF, by its thumbnails and by scrolling", async ({ page }) => {
    await page.goto("/design-system/visionneuse");
    const toolbar = page.getByRole("toolbar", { name: v.toolbar });
    await expect(toolbar).toContainText("Page 1 sur 2");
    await expect(page.getByRole("img", { name: "Page 1 sur 2" })).toBeVisible();

    const thumbs = page.getByRole("navigation", { name: v.pages });
    await expect(thumbs.getByRole("button")).toHaveCount(2);
    await expect(thumbs.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    await thumbs.getByRole("button", { name: "Page 2" }).click();
    await expect(toolbar).toContainText("Page 2 sur 2");
    await expect(thumbs.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("img", { name: "Page 2 sur 2" })).toBeInViewport();

    // Scrolling back to the top shows page 1 again.
    await page.getByRole("region", { name: v.pages }).evaluate((pages) => pages.scrollTo({ top: 0 }));
    await expect(toolbar).toContainText("Page 1 sur 2");
  });

  test("zooms in and out by 25 % steps, and fits the page to the space", async ({ page }) => {
    await page.goto("/design-system/visionneuse");
    const toolbar = page.getByRole("toolbar", { name: v.toolbar });
    const first = page.getByRole("img", { name: "Page 1 sur 2" });
    await expect(first).toBeVisible();
    const width = async () => (await first.boundingBox())!.width;
    const at100 = await width();
    await expect(toolbar).toContainText("100 %");

    await toolbar.getByRole("button", { name: v.zoomIn }).click();
    await expect(toolbar).toContainText("125 %");
    await expect.poll(width).toBeCloseTo(at100 * 1.25, 0);

    await toolbar.getByRole("button", { name: v.zoomOut }).click();
    await toolbar.getByRole("button", { name: v.zoomOut }).click();
    await expect(toolbar).toContainText("75 %");
    await expect.poll(width).toBeCloseTo(at100 * 0.75, 0);

    await toolbar.getByRole("button", { name: v.fit }).click();
    const pages = page.getByRole("region", { name: v.pages });
    const room = await pages.evaluate((element) => element.clientWidth - 48);
    await expect.poll(width).toBeGreaterThan(room - 8);
    expect(await width()).toBeLessThanOrEqual(room);
  });

  test("« Télécharger » gives the very file shown", async ({ page }) => {
    // The file the Viewer read and drew (an export is drawn afresh on each request, so another fetch would differ).
    const read = page.waitForResponse((response) => response.url().endsWith(SPECIMEN));
    await page.goto("/design-system/visionneuse");
    const shown = await (await read).body();
    await expect(page.getByRole("img", { name: "Page 1 sur 2" })).toBeVisible();

    const downloading = page.waitForEvent("download");
    await page.getByRole("toolbar", { name: v.toolbar }).getByRole("link", { name: v.download }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("CV-Marie-Dupont.pdf");
    const saved = readFileSync((await download.path())!);
    expect(saved.equals(shown)).toBe(true);
    expect(saved.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("passes axe", async ({ page }) => {
    await page.goto("/design-system/visionneuse");
    await expect(page.getByRole("img", { name: "Page 2 sur 2" })).toBeAttached();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});

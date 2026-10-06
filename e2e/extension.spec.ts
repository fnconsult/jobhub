import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { catalogueStrings, renderedTexts } from "./support/accessibility";

const extensionDir = path.resolve("apps/extension/.output/chrome-mv3");
const frCatalogue = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

/** Chromium derives an unpacked extension's id from the SHA-256 of its absolute path. */
function unpackedExtensionId(dir: string): string {
  const hex = createHash("sha256").update(realpathSync(dir)).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}

test.describe("browser extension", () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    test.skip(!existsSync(extensionDir), "Build the extension first: npm run build -w @jobhub/extension");
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      locale: "en-US",
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("is a Chrome MV3 extension whose default locale is French", () => {
    const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.default_locale).toBe("fr");
    expect(manifest.name).toBe("__MSG_extName__");
    const fr = JSON.parse(readFileSync(path.join(extensionDir, "_locales/fr/messages.json"), "utf8"));
    expect(fr.extName.message).toBe("Jobbbox");
    expect(fr.extDescription.message).toMatch(/offre d'emploi/);
  });

  test("loads in Chrome and its popup speaks French from the shared catalogue", async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${unpackedExtensionId(extensionDir)}/popup.html`);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page).toHaveTitle("Jobbbox");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jobbbox");
    await expect(page.getByText("Capturez une offre d'emploi depuis la page que vous consultez.")).toBeVisible();

    const allowed = new Set(catalogueStrings(frCatalogue));
    const texts = await renderedTexts(page);
    expect(texts.map((t) => t.text).filter((text) => !allowed.has(text))).toEqual([]);
  });

  test("popup uses the shared design tokens and meets the ADR-0009 floor", async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${unpackedExtensionId(extensionDir)}/popup.html`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("16px");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }

    // The shared stylesheet honours the text-size setting here too.
    await page.evaluate(() => (document.documentElement.dataset.textSize = "xlarge"));
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("20px");
  });
});

import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { unpackedExtensionId } from "./support/extension";

// Issue #988 (ADR-0105): the Chrome extension under the logo « La boîte qui répond »: the manifest's icons (16, 32, 48 and
// 128 px) and the Side Panel's header, in the light and the dark theme, « Jobbbox » its accessible name.
const extensionDir = path.resolve("apps/extension/.output/chrome-mv3");
const PNG = (file: string) => {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test.describe("the extension's logo", () => {
  let context: BrowserContext;

  test.beforeAll(async () => {
    test.skip(!existsSync(extensionDir), "Build the extension first: npm run build -w @jobhub/extension");
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      locale: "fr-FR",
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    await context.route("https://jobbbox.ai/**", (route) => route.abort());
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("the built manifest declares the icons at 16, 32, 48 and 128 px, and each file is drawn at its size", () => {
    const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
    for (const size of [16, 32, 48, 128]) {
      const file = manifest.icons[String(size)];
      expect(file, `icon ${size}`).toBeTruthy();
      expect(PNG(path.join(extensionDir, file)), file).toEqual({ width: size, height: size });
      expect(manifest.action?.default_icon?.[String(size)] ?? file, `toolbar icon ${size}`).toBeTruthy();
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the Side Panel's header leads with the symbol and « Jobbbox », in ${scheme}`, async () => {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`chrome-extension://${unpackedExtensionId(realpathSync(extensionDir))}/sidepanel.html`);
      const wordmark = page.locator(".panel-head .wordmark");
      await expect(wordmark).toHaveText("Jobbbox");
      const symbol = wordmark.locator("svg");
      await expect(symbol).toBeVisible();
      await expect(symbol).toHaveAttribute("aria-hidden", "true");
      const box = await symbol.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(16);
      // Still: nothing moves in the Side Panel.
      expect(await page.evaluate(() => document.getAnimations().filter((a) => a.effect && (a.effect as KeyframeEffect).target?.closest?.(".wordmark")).length)).toBe(0);
      await page.close();
    });
  }
});

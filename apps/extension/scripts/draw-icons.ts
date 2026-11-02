/**
 * Draws the extension's icons (#563) from their SVG sources, `icons/icon.svg` (public listing) and
 * `icons/icon-beta.svg` (beta listing), into `public/icon/<size>.png` and `public/icon-beta/<size>.png`.
 * Run after changing an SVG: `npx tsx apps/extension/scripts/draw-icons.ts`, then commit the PNGs.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ICON_SIZES } from "../src/build-target";

const root = fileURLToPath(new URL("..", import.meta.url));

const browser = await chromium.launch();
try {
  for (const name of ["icon", "icon-beta"]) {
    const svg = readFileSync(`${root}icons/${name}.svg`, "utf8");
    mkdirSync(`${root}public/${name}`, { recursive: true });
    for (const size of ICON_SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      await page.screenshot({ path: `${root}public/${name}/${size}.png`, omitBackground: true });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

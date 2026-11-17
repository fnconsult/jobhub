/**
 * Draws the extension's icons (#563) from the logo « La boîte qui répond » (#988, ADR-0105, `src/panel-logo.ts`):
 * `public/icon/<size>.png` (public listing) and `public/icon-beta/<size>.png` (beta listing, its orange β), and the
 * Chrome Web Store listing's visuals in `store/`: its 128 px icon (the artwork in 96 px, 16 px of transparent margin, as
 * the store asks) and its small promo tile (440 × 280). Run after changing the logo, then commit the PNGs:
 *
 *   npx tsx apps/extension/scripts/draw-icons.ts
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { designTokens } from "@jobhub/shared/design";
import { logoIconSvg, logoSvg } from "@jobhub/shared/logo";
import { chromium, type Browser } from "playwright";
import { ICON_SIZES } from "../src/build-target";
import { extensionIcon, type IconSet } from "../src/panel-logo";

const root = fileURLToPath(new URL("..", import.meta.url));
const inter = readFileSync(createRequire(import.meta.url).resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2")).toString("base64");

async function draw(browser: Browser, size: { width: number; height: number }, html: string, path: string) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>@font-face{font-family:Inter;font-weight:100 900;src:url(data:font/woff2;base64,${inter}) format("woff2")}html,body{margin:0;background:transparent}svg{display:block}</style>${html}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path, omitBackground: true });
  await page.close();
}

/** The small promo tile: the symbol and the name « Jobbbox », on the accent's soft tint. */
function promoTile(): string {
  const { accentSoft, text } = designTokens.color;
  return `<div style="width:440px;height:280px;display:flex;align-items:center;justify-content:center;gap:18px;background:${accentSoft.light};font-family:Inter;font-weight:700;font-size:54px;letter-spacing:-0.02em;color:${text.light}">
    <span style="width:96px;height:96px">${logoSvg("symbol").replace("<svg ", '<svg width="96" height="96" ')}</span>Jobbbox</div>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const set of ["icon", "icon-beta"] satisfies IconSet[]) {
    mkdirSync(`${root}public/${set}`, { recursive: true });
    for (const size of ICON_SIZES) await draw(browser, { width: size, height: size }, extensionIcon(set, size), `${root}public/${set}/${size}.png`);
  }
  await draw(browser, { width: 128, height: 128 }, logoIconSvg({ size: 128, inset: 16 / 128 }), `${root}store/icon-128.png`);
  await draw(browser, { width: 440, height: 280 }, promoTile(), `${root}store/promo-tile-440x280.png`);
} finally {
  await browser.close();
}
console.log(`✓ ${2 * ICON_SIZES.length + 2} files in apps/extension/public and apps/extension/store`);

// Draws the web app's files of the logo « La boîte qui répond » (#988, ADR-0105) from @jobhub/shared/logo: the web
// manifest's icons and the emails' logo into public/brand (src/brand/files.ts), the favicon (src/app/icon.svg, the
// small form) and the Apple touch icon (src/app/apple-icon.png). Run after changing the logo, then commit the files:
//
//   npx tsx apps/web/scripts/draw-logo-files.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { designTokens } from "@jobhub/shared/design";
import { logoIconSvg, logoSvg, type LogoIcon } from "@jobhub/shared/logo";
import { chromium, type Browser } from "playwright";
import { BRAND_FILES } from "../src/brand/files";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The PNG of `icon`, its background transparent where it has none. */
async function draw(browser: Browser, icon: LogoIcon, file: string) {
  const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${logoIconSvg(icon)}`);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const file of BRAND_FILES) await draw(browser, file.icon, path.join(web, "public", file.path));
  // iOS rounds the corners itself: a square tile, edge to edge.
  await draw(browser, { size: 180, background: designTokens.color.accentSoft.light, shape: "square", inset: 0.14 }, path.join(web, "src/app/apple-icon.png"));
} finally {
  await browser.close();
}
writeFileSync(path.join(web, "src/app/icon.svg"), `${logoSvg("small").replace(/ aria-hidden="true" focusable="false"/, "")}\n`);
console.log(`✓ ${BRAND_FILES.length + 2} logo files in apps/web`);

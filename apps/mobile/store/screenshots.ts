/**
 * Draws the stores' screenshots and the provisional icon of the Jobbbox app (#708) into `store/screenshots/` and
 * `assets/`. Run after the reference captures change (docs/ops/mobile.md « Les captures des stores »), then commit:
 *
 *   npx tsx apps/mobile/store/screenshots.ts
 *
 * The screenshots come from the light reference captures of the Maestro key screens (#705,
 * `maestro/captures/<device>/light/`, fictional data only: maestro/seed.ts), on the devices `devices.ts` marks `store`:
 *
 * - **App Store, iPhone 6.9"** (1290 × 2796): no reference capture has that size (the phone of the matrix is an iPhone
 *   SE, 750 × 1334, which App Store Connect no longer takes alone), so each capture is set, enlarged, under a caption.
 * - **App Store, iPad 13"** (2752 × 2064): the iPad's landscape capture, drawn upright (simctl saves the panel's portrait pixels).
 * - **Google Play, phone** (1080 × 2092) and **tablet** (2560 × 1600, for the 7" and the 10" slots): the capture as is.
 *
 * `screenshots/manifest.json` keeps each source capture's SHA-256: e2e/store-listings.e2e.test.ts fails when a
 * reference capture changed and this script was not run again. French only: the simulators speak French (devices.ts),
 * and both stores show the default language's screenshots on the English listing.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { STORE_ICON, STORE_SCREENS, STORE_SETS, type StoreSet } from "./screenshot-sets";

const root = join(__dirname, "..", "/");
const out = `${root}store/screenshots/`;
const inter = require.resolve("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf");
const font = `@font-face{font-family:Inter;font-weight:700;src:url(data:font/ttf;base64,${readFileSync(inter).toString("base64")})}`;
const dataUrl = (file: string) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

async function draw(browser: Browser, size: { width: number; height: number }, html: string, path: string) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.setContent(`<style>${font}html,body{margin:0;width:${size.width}px;height:${size.height}px;overflow:hidden}</style>${html}`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await page.screenshot({ path });
  await page.close();
}

/** A capture under its caption, on the accent's soft tint (the iPhone set). */
function framed(set: StoreSet, source: string, caption: string) {
  const { width, height } = set.size;
  const frame = set.frame!;
  const top = height - frame.height - frame.bottom;
  return `<div style="width:${width}px;height:${height}px;background:${STORE_ICON.soft};font-family:Inter;position:relative">
    <div style="position:absolute;inset:0 90px auto;height:${top}px;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;font-size:92px;line-height:1.15;letter-spacing:-0.02em;color:${STORE_ICON.ink}">${caption}</div>
    <img src="${dataUrl(source)}" style="position:absolute;left:${(width - frame.width) / 2}px;top:${top}px;width:${frame.width}px;height:${frame.height}px;border-radius:56px;box-shadow:0 0 0 3px ${STORE_ICON.line},0 40px 90px rgba(31,36,84,.18)">
  </div>`;
}

/**
 * The iPad's landscape capture: simctl saves the panel's pixels (portrait) with its orientation in the PNG's EXIF
 * chunk, which the browser applies; drawn here, the image is upright for consoles that ignore it.
 */
function upright(set: StoreSet, source: string) {
  return `<img src="${dataUrl(source)}" style="display:block;image-orientation:from-image;width:${set.size.width}px;height:${set.size.height}px">`;
}

/** The provisional icon (ADR-0053: no logo yet): the word « Jobbbox » on the accent. */
const wordmark = (size: { width: number; height: number }, fontSize: number, background: string) =>
  `<div style="width:${size.width}px;height:${size.height}px;background:${background};display:flex;align-items:center;justify-content:center;font-family:Inter;font-weight:700;font-size:${fontSize}px;letter-spacing:-0.03em;color:#fff">Jobbbox</div>`;

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${root}assets`, { recursive: true });
  const manifest: Record<string, { source: string; sha256: string }> = {};
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    for (const set of STORE_SETS) {
      mkdirSync(`${out}${set.id}`, { recursive: true });
      for (const [index, screen] of STORE_SCREENS.entries()) {
        const source = `maestro/captures/${set.device}/light/${screen.id}.png`;
        const name = `${set.id}/${index + 1}-${screen.id}.png`;
        if (set.transform === "copy") copyFileSync(`${root}${source}`, `${out}${name}`);
        else await draw(browser, set.size, set.transform === "frame" ? framed(set, `${root}${source}`, screen.caption) : upright(set, `${root}${source}`), `${out}${name}`);
        manifest[name] = { source, sha256: createHash("sha256").update(readFileSync(`${root}${source}`)).digest("hex") };
      }
    }
    // The app's icon (app.json): opaque for iOS; Android's adaptive foreground keeps the word inside its safe zone.
    await draw(browser, { width: 1024, height: 1024 }, wordmark({ width: 1024, height: 1024 }, 212, STORE_ICON.accent), `${root}assets/icon.png`);
    const foreground = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
    await foreground.setContent(`<style>${font}html,body{margin:0;background:transparent}</style>${wordmark({ width: 1024, height: 1024 }, 148, "transparent")}`);
    await foreground.evaluate(() => document.fonts.ready);
    await foreground.screenshot({ path: `${root}assets/adaptive-icon.png`, omitBackground: true });
    await foreground.close();
    // Google Play's own graphics: its 512 px icon and the 1024 × 500 feature graphic.
    await draw(browser, { width: 512, height: 512 }, wordmark({ width: 512, height: 512 }, 106, STORE_ICON.accent), `${out}google-play-icon.png`);
    await draw(browser, { width: 1024, height: 500 }, wordmark({ width: 1024, height: 500 }, 150, STORE_ICON.accent), `${out}google-play-feature-graphic.png`);
  } finally {
    await browser.close();
  }
  writeFileSync(`${out}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${Object.keys(manifest).length} captures des stores écrites dans apps/mobile/store/screenshots/`);
}

void main();

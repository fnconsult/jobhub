/**
 * Draws the stores' screenshots and the Jobbbox app's icons and splash screen (#708; the logo « La boîte qui répond »,
 * #988, ADR-0105, from @jobhub/shared/logo) into `store/screenshots/` and `assets/`. Run after the reference captures change (docs/ops/mobile.md « Les captures des stores »), then commit:
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
import { logoIconSvg, logoSvg, type LogoIcon } from "@jobhub/shared/logo";
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

/** An icon made of the logo (#988): its symbol, on the accent's soft tint unless it is a transparent layer. */
const icon = (logo: LogoIcon) => logoIconSvg(logo).replace("<svg ", '<svg style="display:block" ');

/**
 * The feature graphic: the symbol and the name « Jobbbox », on the accent's soft tint.
 */
const featureGraphic = (size: { width: number; height: number }) =>
  `<div style="width:${size.width}px;height:${size.height}px;background:${STORE_ICON.soft};display:flex;align-items:center;justify-content:center;gap:40px;font-family:Inter;font-weight:700;font-size:150px;letter-spacing:-0.03em;color:${STORE_ICON.ink}">${logoSvg("symbol").replace("<svg ", '<svg width="220" height="220" ')}Jobbbox</div>`;

/** A transparent PNG of `html`. */
async function layer(browser: Browser, size: number, html: string, path: string) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${html}`);
  await page.screenshot({ path, omitBackground: true });
  await page.close();
}

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
    // The app's icon (app.json): opaque for iOS, which rounds its corners itself.
    await draw(browser, { width: 1024, height: 1024 }, icon({ size: 1024, background: STORE_ICON.soft, shape: "square", inset: 0.16 }), `${root}assets/icon.png`);
    // Android's adaptive icon: the launcher masks it to its shape and shows the middle 66 % (of 108 dp) at most, so the
    // symbol stays inside the safe circle; its background layer is the soft tint, its monochrome one (Android 13's
    // themed icons) the symbol in one colour, the slot cut out.
    await layer(browser, 1024, icon({ size: 1024, inset: 0.29 }), `${root}assets/adaptive-icon.png`);
    await draw(browser, { width: 1024, height: 1024 }, `<div style="width:1024px;height:1024px;background:${STORE_ICON.soft}"></div>`, `${root}assets/adaptive-icon-background.png`);
    await layer(browser, 1024, icon({ size: 1024, inset: 0.29, monochrome: true }), `${root}assets/adaptive-icon-monochrome.png`);
    // The splash screen's symbol (expo-splash-screen in app.json), on the page's background in either theme.
    await layer(browser, 1024, icon({ size: 1024, inset: 0.02 }), `${root}assets/splash-icon.png`);
    // Google Play's own graphics: its 512 px icon and the 1024 × 500 feature graphic.
    await draw(browser, { width: 512, height: 512 }, icon({ size: 512, background: STORE_ICON.soft, shape: "square", inset: 0.16 }), `${out}google-play-icon.png`);
    await draw(browser, { width: 1024, height: 500 }, featureGraphic({ width: 1024, height: 500 }), `${out}google-play-feature-graphic.png`);
  } finally {
    await browser.close();
  }
  writeFileSync(`${out}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${Object.keys(manifest).length} captures des stores écrites dans apps/mobile/store/screenshots/`);
}

void main();

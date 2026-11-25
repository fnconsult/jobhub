import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { designTokens } from "@jobhub/shared/design";
import { LOGO, logoFormFor, logoSvg } from "@jobhub/shared/logo";
import { expect, test } from "@playwright/test";

// Issue #988 (ADR-0105): the logo « La boîte qui répond » in every file and every page that needs no web app: the web
// manifest's icons, the emails' header (hosted PNG @2x, alt « Jobbbox », light and dark clients), the extension's icons
// and the Chrome Web Store's visuals, the app's icons and splash screen, the stores' screenshots, the edge's error pages
// (#833), and a logo that reads at 16 px. Needs no web app: run it alone with
// E2E_NO_WEB_SERVER=1 npx playwright test --project=logo.
// The pages that do need the web app are in e2e/logo-web.spec.ts, the Side Panel's in e2e/logo-extension.spec.ts.

const read = (file: string) => readFileSync(path.resolve(file));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG's size and colour type, read from its header (colour type 2 is RGB: no alpha channel; 6 is RGBA). */
function png(file: string) {
  const bytes = read(file);
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${file} is a PNG`).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25]! };
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const toHex = (rgb: string) => "#" + (rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

test.describe("the web app's files (manifest, emails)", () => {
  test("the manifest's icons are drawn at 192 and 512 px, and one is maskable, edge to edge", () => {
    expect(png("apps/web/public/brand/icon-192.png")).toMatchObject({ width: 192, height: 192 });
    expect(png("apps/web/public/brand/icon-512.png")).toMatchObject({ width: 512, height: 512 });
    // Maskable: the launcher crops it to its own shape, so it is opaque (RGB), the logo inside the safe circle.
    expect(png("apps/web/public/brand/icon-maskable-512.png")).toMatchObject({ width: 512, height: 512, colorType: 2 });
  });

  test("the emails' logo is a PNG at twice the 28 px it is shown at", () => {
    expect(png("apps/web/public/brand/email-logo@2x.png")).toMatchObject({ width: 56, height: 56, colorType: 6 });
  });

  test("the manifest's theme colour and the splash screen's backgrounds are the Design System's", () => {
    const source = readFileSync("apps/web/src/app/manifest.ts", "utf8");
    expect(source).toContain("designTokens.color.accent.light");
    expect(designTokens.color.accent.light).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

test.describe("the nine emails (Brevo)", () => {
  const samples = (() => {
    const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/email-samples.ts", "fr"], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(run.stderr);
    return JSON.parse(run.stdout) as Record<string, string>;
  })();

  test("every email opens on the logo: an absolute, hosted PNG at 28 px, named « Jobbbox »", () => {
    expect(Object.keys(samples)).toHaveLength(9);
    for (const [name, html] of Object.entries(samples)) {
      const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
      expect(images, name).toHaveLength(1);
      const image = images[0]!;
      expect(image, name).toMatch(/src="https?:\/\/[^"]+\/brand\/email-logo@2x\.png"/);
      expect(image, name).toContain('alt="Jobbbox"');
      expect(image, name).toContain('width="28"');
      expect(image, name).toContain('height="28"');
      // The logo is the first thing in the body, before the heading.
      expect(html.indexOf("<img"), name).toBeLessThan(html.indexOf("<h1"));
    }
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the logo shows and reads against the email's ${scheme} background`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route("**/brand/email-logo@2x.png", (route) => route.fulfill({ path: "apps/web/public/brand/email-logo@2x.png", contentType: "image/png" }));
      for (const [name, html] of Object.entries(samples)) {
        await page.setContent(html);
        const image = page.getByRole("img", { name: "Jobbbox" });
        await expect(image, name).toBeVisible();
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { message: name }).toBe(56);
        // The image has no background of its own: what is behind it is the page's, as a client with that scheme draws it.
        const behind = await image.evaluate((img) => {
          for (let node: Element | null = img; node; node = node.parentElement) {
            const colour = getComputedStyle(node).backgroundColor;
            if (colour !== "rgba(0, 0, 0, 0)" && colour !== "transparent") return colour;
          }
          return "rgb(255, 255, 255)";
        });
        // The brand's blue against the background: 3:1, WCAG's bar for a graphic.
        expect(contrast(LOGO.colors.front[1], toHex(behind)), `${name}, ${scheme}: ${behind}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

test.describe("the Chrome extension's icons and the Chrome Web Store's visuals", () => {
  for (const folder of ["icon", "icon-beta"]) {
    test(`${folder}: 16, 32, 48 and 128 px`, () => {
      for (const size of [16, 32, 48, 128]) expect(png(`apps/extension/public/${folder}/${size}.png`), `${folder}/${size}`).toMatchObject({ width: size, height: size });
    });
  }

  test("the store listing's icon and promotional tile are redrawn at the sizes the store asks", () => {
    expect(png("apps/extension/store/icon-128.png")).toMatchObject({ width: 128, height: 128 });
    expect(png("apps/extension/store/promo-tile-440x280.png")).toMatchObject({ width: 440, height: 280 });
  });

  test("the 16 px icon is drawn: its bubble fills most of the square, in the brand's blue, on no background", async ({ page }) => {
    const data = `data:image/png;base64,${read("apps/extension/public/icon/16.png").toString("base64")}`;
    await page.setContent(`<canvas id="c" width="16" height="16"></canvas>`);
    const stats = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.getElementById("c") as HTMLCanvasElement;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data: pixels } = context.getImageData(0, 0, 16, 16);
      let opaque = 0;
      const corner = pixels[3]!;
      let blue = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! > 200) {
          opaque++;
          if (pixels[i + 2]! > pixels[i]! + 40) blue++;
        }
      }
      return { opaque, blue, corner };
    }, data);
    expect(stats.opaque).toBeGreaterThan(110); // of 256: a bubble, not a speck
    expect(stats.blue).toBeGreaterThan(60);
    expect(stats.corner).toBe(0); // the toolbar's own background shows around it, light or dark
  });
});

test.describe("the mobile app's icon, splash screen and store screenshots", () => {
  const { expo } = JSON.parse(readFileSync("apps/mobile/app.json", "utf8"));

  test("the iOS icon is 1024 px and opaque; the Android adaptive icon has its foreground, background and monochrome layers", () => {
    expect(png(`apps/mobile/${expo.icon}`)).toMatchObject({ width: 1024, height: 1024, colorType: 2 });
    const adaptive = expo.android.adaptiveIcon;
    for (const layer of ["foregroundImage", "backgroundImage", "monochromeImage"]) {
      expect(adaptive[layer], layer).toBeTruthy();
      expect(png(`apps/mobile/${adaptive[layer]}`), layer).toMatchObject({ width: 1024, height: 1024 });
    }
    expect(png(`apps/mobile/${adaptive.monochromeImage}`).colorType).toBe(6);
  });

  test("the splash screen shows the symbol on the page's background in light and dark", () => {
    const splash = expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen")[1];
    expect(png(`apps/mobile/${splash.image}`)).toMatchObject({ width: 1024, height: 1024 });
    expect(splash.backgroundColor).toBe(designTokens.color.background.light);
    expect(splash.dark.backgroundColor).toBe(designTokens.color.background.dark);
  });

  test("the provisional icon of ADR-0053 and #977 is gone: the old accent is no longer the adaptive background", () => {
    expect(expo.android.adaptiveIcon.backgroundColor).not.toBe("#4f5fe0");
  });

  test("the stores' screenshots are the ones regenerated: each file is what manifest.json recorded", () => {
    const dir = "apps/mobile/store/screenshots";
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Record<string, { source: string; sha256: string }>;
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
    // Each screenshot is drawn from a Maestro capture, whose hash the manifest keeps: a capture changed since means the
    // screenshots are stale, and so does a missing file.
    for (const [file, { source, sha256 }] of Object.entries(manifest)) {
      expect(png(path.join(dir, file)).width, file).toBeGreaterThan(0);
      expect(createHash("sha256").update(read(path.join("apps/mobile", source))).digest("hex"), `${file}'s source ${source}`).toBe(sha256);
    }
    // The store's icon is the logo's, at the size Google Play asks.
    expect(png(path.join(dir, "google-play-icon.png"))).toMatchObject({ width: 512, height: 512 });
    expect(png(path.join(dir, "google-play-feature-graphic.png"))).toMatchObject({ width: 1024, height: 500 });
    for (const folder of readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      expect(readdirSync(path.join(dir, folder.name)).length, folder.name).toBeGreaterThan(0);
    }
  });
});

test.describe("the edge's error pages (#833)", () => {
  const pages = readdirSync("deploy/edge/pages").filter((file) => file.endsWith(".html"));

  test("there is one per error and language", () => {
    expect(pages.sort()).toEqual(["502", "503", "504"].flatMap((code) => ["en", "fr"].map((lang) => `${code}.${lang}.html`)).sort());
  });

  for (const file of ["502.fr.html", "503.en.html", "504.fr.html"]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`${file} is headed by the symbol and the name, nothing loaded, in ${scheme}`, async ({ page }) => {
        const requests: string[] = [];
        page.on("request", (request) => {
          if (!request.url().startsWith("file:") && !request.url().startsWith("data:")) requests.push(request.url());
        });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`file://${path.resolve("deploy/edge/pages", file)}`);
        const wordmark = page.locator(".wordmark").first();
        await expect(wordmark).toHaveText("Jobbbox");
        await expect(wordmark.locator("svg")).toHaveAttribute("aria-hidden", "true");
        await expect(wordmark.locator("svg")).toBeVisible();
        expect(await page.locator("img, link[rel=stylesheet]").count()).toBe(0);
        expect(requests).toEqual([]);
      });
    }
  }
});

test.describe("a logo that reads at 16 px", () => {
  test("below 40 px the flat form is drawn: no dots, no gradient", () => {
    expect(logoFormFor(16)).toBe("small");
    expect(logoFormFor(39)).toBe("small");
    expect(logoFormFor(40)).toBe("symbol");
    const small = logoSvg("small", { title: "Jobbbox" });
    expect(small).not.toContain("<circle");
    expect(small).not.toContain("linearGradient");
    expect(small).toContain("<title");
    expect(small).toContain("Jobbbox");
  });

  for (const [scheme, background] of [["light", designTokens.color.background.light], ["dark", designTokens.color.background.dark]] as const) {
    test(`at 16 px on the ${scheme} background, the bubble stands out (3:1) and fills the square`, async ({ page }) => {
      expect(contrast(LOGO.colors.flat, background), `${LOGO.colors.flat} on ${background}`).toBeGreaterThanOrEqual(3);
      await page.setContent(`<body style="margin:0;background:${background}"><div id="logo" style="width:16px;height:16px">${logoSvg("small")}</div></body>`);
      await page.locator("#logo svg").evaluate((svg) => {
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
      });
      const box = await page.locator("#logo svg").boundingBox();
      expect(box).toMatchObject({ width: 16, height: 16 });
      const shot = await page.locator("#logo").screenshot();
      expect(shot.length).toBeGreaterThan(80); // not an empty square (a blank 16 px PNG is a few dozen bytes)
    });
  }
});

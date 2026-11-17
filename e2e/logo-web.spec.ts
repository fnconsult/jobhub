import { readFileSync } from "node:fs";
import { designTokens } from "@jobhub/shared/design";
import { LOGO } from "@jobhub/shared/logo";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fromNewAddress, requestSignInLink, setUpTwoStepVerificationIfAsked, signInWithMagicLink } from "./support/candidate";
import { emailsTo, linkIn, newAddress, waitForEmail } from "./support/mailbox";
import { forgetTwoStepVerification } from "./support/two-step";
import { THEMES, showInTheme } from "./support/theme";

// Issue #988 (ADR-0105): the logo « La boîte qui répond » on the web app, seen as a person sees it: the public header
// (animated once), « Se connecter à Jobbbox » and its second step, the error pages (#542), the legal shell, the Help
// Centre, the Candidate's Sidebar (and its symbol alone when it is collapsed), the Back Office's, the web manifest and
// its icons. « Jobbbox » stays the accessible name everywhere; the logo is the same in the light and the dark theme.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const PNG_SIGNATURE = "89504e470d0a1a0a";

// Its own super-admin (see ADMIN_EMAILS in playwright.config.ts): a second step to set up, and the Back Office.
const BACK_OFFICE = "logo-office@e2e.jobbbox.test";

/** The symbol in `scope`: drawn, decorative (hidden from assistive technology), and in the brand's colours. */
async function expectSymbol(scope: Locator, { animated = false } = {}) {
  const symbol = scope.locator("svg.ds-logo");
  await expect(symbol).toHaveCount(1);
  await expect(symbol).toBeVisible();
  await expect(symbol).toHaveAttribute("aria-hidden", "true");
  if (animated) await expect(symbol).toHaveAttribute("data-animated", "true");
  else await expect(symbol).not.toHaveAttribute("data-animated", /.*/);
  const box = await symbol.boundingBox();
  expect(box!.width).toBeGreaterThan(12);
  expect(box!.width).toBeCloseTo(box!.height, 0);
}

/** The animations running on the symbols of the page, with how many times each plays. */
const logoAnimations = (page: Page, selector = ".ds-logo") =>
  page.evaluate((css) => document.querySelectorAll(css).values().toArray().flatMap((logo) => [logo, ...logo.querySelectorAll("*")]).flatMap((node) => node.getAnimations()).map((animation) => ({ iterations: (animation.effect as KeyframeEffect).getTiming().iterations, name: (animation as CSSAnimation).animationName })), selector);

test.describe("the web manifest and its icons", () => {
  test("names the app, opens its home, in the Design System's colours, with the icons at 192 and 512 px and a maskable one", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBeTruthy();
    const response = await request.get(new URL(href!, origin).href);
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest).toMatchObject({ name: fr.app.name, short_name: fr.app.name, start_url: "/", display: "standalone" });
    expect(manifest.theme_color).toBe(designTokens.color.accent.light);
    expect(manifest.background_color).toBe(designTokens.color.background.light);
    const sizes = (purpose: string) => manifest.icons.filter((icon: { purpose: string; type: string }) => icon.purpose === purpose && icon.type === "image/png").map((icon: { sizes: string }) => icon.sizes);
    expect(sizes("any")).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(sizes("maskable")).toContain("512x512");
    // Every icon is served, to anyone, as the PNG it declares at the size it declares.
    for (const icon of manifest.icons.filter((i: { type: string }) => i.type === "image/png")) {
      const file = await request.get(new URL(icon.src, origin).href);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()["content-type"], icon.src).toContain("image/png");
      const bytes = await file.body();
      expect(bytes.subarray(0, 8).toString("hex"), icon.src).toBe(PNG_SIGNATURE);
      const [width, height] = icon.sizes.split("x").map(Number);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], icon.src).toEqual([width, height]);
    }
  });

  test("hosts the emails' logo, a 56 px PNG, for any mail client to fetch", async ({ request }) => {
    const response = await request.get("/brand/email-logo@2x.png");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    const bytes = await response.body();
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([56, 56]);
  });

  test("gives the browser the logo's favicon and the home screen's icon", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
    expect((await page.request.get("/icon.svg")).ok()).toBe(true);
    expect((await page.request.get("/apple-icon.png")).ok()).toBe(true);
  });
});

test.describe("the public header, the sign-in pages and the error pages", () => {
  test("the public header has the symbol and « Jobbbox »; it plays once, there and nowhere else", async ({ page }) => {
    await page.goto("/");
    const brand = page.getByRole("banner").getByRole("link", { name: fr.app.name, exact: true });
    await expect(brand).toHaveAttribute("href", "/");
    await expectSymbol(brand, { animated: true });
    // It plays once (#987): finite animations, none repeating, only on the header's symbol.
    const header = await logoAnimations(page, "header .ds-logo[data-animated]");
    expect(header.length).toBeGreaterThan(0);
    for (const animation of header) expect(animation.iterations, animation.name).toBe(1);
    expect(await page.locator(".ds-logo[data-animated]").count()).toBe(1);
    // Anywhere else the logo is still: the footer's, the landing's.
    expect(await page.locator(".ds-logo:not([data-animated])").count()).toBeGreaterThan(0);
    expect(await logoAnimations(page, ".ds-logo:not([data-animated])")).toEqual([]);
    // Once it is over it stays as drawn: every one of the logo's animations finishes, none loops.
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll("header .ds-logo[data-animated]").values().toArray().flatMap((logo) => [logo, ...logo.querySelectorAll("*")]).flatMap((node) => node.getAnimations()).every((a) => a.playState === "finished")), { timeout: 8_000 })
      .toBe(true);
  });

  test("nothing moves when « réduire les animations » is on", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    await expectSymbol(page.getByRole("banner").getByRole("link", { name: fr.app.name, exact: true }), { animated: true });
    expect(await logoAnimations(page)).toEqual([]);
    await context.close();
  });

  test("« Se connecter à Jobbbox » is headed by the logo, and the name stays the page's", async ({ page }) => {
    await page.goto("/connexion");
    const wordmark = page.locator(".ds-sign-in__wordmark");
    await expect(wordmark).toHaveText(fr.app.name);
    await expectSymbol(wordmark);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the second step's page is headed by the logo too", async ({ page }) => {
    await forgetTwoStepVerification(process.env.E2E_DATABASE_URL, BACK_OFFICE);
    const already = emailsTo(BACK_OFFICE).length;
    await fromNewAddress(page);
    await page.goto("/connexion");
    await requestSignInLink(page, BACK_OFFICE);
    const message = await waitForEmail(BACK_OFFICE, already);
    await page.goto(linkIn(message));
    await expect(page).toHaveURL(/deuxieme-etape|connexion|compte|admin/);
    const wordmark = page.locator(".ds-sign-in__wordmark");
    await expect(wordmark).toHaveText(fr.app.name);
    await expectSymbol(wordmark);
    await setUpTwoStepVerificationIfAsked(page);
  });

  test("a page that does not exist leads home under the public header's logo", async ({ page }) => {
    const response = await page.goto("/cette-page-n-existe-pas");
    expect(response?.status()).toBe(404);
    const brand = page.getByRole("banner").getByRole("link", { name: fr.app.name, exact: true });
    await expect(brand).toHaveAttribute("href", "/");
    await expectSymbol(brand, { animated: true });
  });

  test("the legal shell and the Help Centre carry the public header's logo", async ({ page }) => {
    for (const path of ["/legal/confidentialite", "/aide"]) {
      await page.goto(path);
      const brand = page.getByRole("banner").getByRole("link", { name: fr.app.name, exact: true });
      await expect(brand, path).toHaveAttribute("href", "/");
      await expectSymbol(brand, { animated: true });
    }
  });
});

test.describe("the Candidate's and the Back Office's Sidebars", () => {
  test("the Candidate's Sidebar leads with the logo; collapsed, the symbol alone leads home and is named « Jobbbox »", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInWithMagicLink(page, newAddress("logo-sidebar"));
    const brand = page.locator(".sidebar-docked .brand");
    await expect(brand).toHaveText(fr.app.name);
    await expect(brand).toHaveAttribute("href", "/");
    await expectSymbol(brand);
    expect(await logoAnimations(page)).toEqual([]);
    // Open: the Top Bar's symbol is not shown, the Sidebar has it.
    const alone = page.getByRole("banner").getByRole("link", { name: fr.app.name, exact: true });
    await expect(alone).toBeHidden();
    await page.getByRole("button", { name: fr.sidebar.collapse }).click();
    await expect(page.locator("html")).toHaveAttribute("data-sidebar", "closed");
    await expect(alone).toBeVisible();
    await expect(alone).toHaveAttribute("href", "/");
    await expect(alone).toHaveText("");
    await expectSymbol(alone);
    await alone.click();
    await expect(page).toHaveURL(`${origin}/`);
  });

  test("the Back Office's Sidebar leads with the logo and « Jobbbox · Back Office »", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInWithMagicLink(page, BACK_OFFICE);
    await page.goto("/admin");
    const brand = page.locator(".sidebar-docked .brand");
    await expect(brand).toContainText(fr.app.name);
    await expect(brand).toHaveText(/^Jobbbox · /);
    await expectSymbol(brand);
  });
});

test.describe("light and dark", () => {
  for (const theme of THEMES) {
    test(`the logo is the brand's own in ${theme}, and its name reads against the page`, async ({ page }) => {
      await page.goto("/connexion");
      await showInTheme(page, theme);
      const stops = await page.locator(".ds-sign-in__wordmark svg.ds-logo stop").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("stop-color")!.toLowerCase()));
      expect(stops).toEqual(expect.arrayContaining([...LOGO.colors.front, ...LOGO.colors.side, LOGO.colors.paper]));
      const name = await page.locator(".ds-sign-in__wordmark").evaluate((node) => {
        const colour = getComputedStyle(node).color;
        let background = "";
        for (let n: Element | null = node; n; n = n.parentElement) {
          background = getComputedStyle(n).backgroundColor;
          if (background !== "rgba(0, 0, 0, 0)") break;
        }
        return { colour, background };
      });
      const channels = (css: string) => css.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => 0.2126 * ((r! / 255) ** 2.2) + 0.7152 * ((g! / 255) ** 2.2) + 0.0722 * ((b! / 255) ** 2.2);
      const [hi, lo] = [lum(channels(name.colour)), lum(channels(name.background))].sort((a, b) => b - a);
      expect((hi! + 0.05) / (lo! + 0.05), `${name.colour} on ${name.background}`).toBeGreaterThanOrEqual(4.5);
      await expect(page.locator(".ds-sign-in__wordmark svg.ds-logo")).toBeVisible();
    });
  }
});

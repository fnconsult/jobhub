import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { fontFloorOf, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #461 (ADR-0053): the Design System's foundations. Inter is served from our own origin; the Candidate's pages
// are in the Confort Density (16px body, 13px metadata) and the Back Office in Compact (14 / 12.5); the Text Size
// scales both, the Back Office included.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own permanent super-admin (playwright.config.ts): two sign-ins of one address at once can pick up each other's link.
const SUPER_ADMIN = "design-system-office@e2e.jobbbox.test";
const FONT_CDN = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|rsms\.me|cdn\.jsdelivr\.net|unpkg\.com/;

/** Every request the page makes from now on. */
function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  return requests;
}

/** The computed body text and metadata sizes, in px, of the Density `selector` sits in. */
async function densitySizes(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.fontSize = "var(--font-size-meta)";
    probe.textContent = "·";
    element.append(probe);
    const sizes = { body: parseFloat(getComputedStyle(element).fontSize), meta: parseFloat(getComputedStyle(probe).fontSize) };
    probe.remove();
    return sizes;
  });
}

/** Sets the Text Size the way Préférences remembers it, then reloads. */
async function setTextSize(page: Page, setting: "small" | "standard" | "large" | "xlarge") {
  await page.evaluate((value) => localStorage.setItem("jobbbox.textSize", value), setting);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", setting);
}

/** Inter is drawn: its file came from our own origin, and no request left for a font CDN. */
async function expectInterFromOwnOrigin(page: Page, requests: Request[]) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"Inter Variable"/);
  const fonts = requests.filter((request) => request.resourceType() === "font");
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.map((request) => request.url()).filter((url) => !url.startsWith(`${origin}/`))).toEqual([]);
  expect(requests.map((request) => request.url()).filter((url) => FONT_CDN.test(url))).toEqual([]);
}

test.describe("Design System foundations (#461, ADR-0053)", () => {
  test("Inter is served from our own origin on the home page, with no request to a font CDN", async ({ page }) => {
    const requests = recordRequests(page);
    await page.goto("/");
    await expectInterFromOwnOrigin(page, requests);
  });

  test("a Candidate's page is in Confort: 16px body and 13px metadata at the smallest Text Size, each scaled by it", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("design-system-confort"));
    await page.goto("/compte/preferences");
    await expect(page.locator("[data-density=\"compact\"]")).toHaveCount(0);
    await setTextSize(page, "small");
    expect(await densitySizes(page, "main")).toEqual({ body: 16, meta: 13 });
    for (const t of await renderedTexts(page)) expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(fontFloorOf(t));

    await setTextSize(page, "xlarge");
    expect(await densitySizes(page, "main")).toEqual({ body: 20, meta: 16.25 });
  });

  test("the Back Office is in Compact: 14px body and 12.5px metadata at the smallest Text Size, scaled by the Text Size too", async ({ page }) => {
    const requests = recordRequests(page);
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: fr.admin.dashboard.title })).toBeVisible();
    await expectInterFromOwnOrigin(page, requests);
    expect(await page.locator("main").first().evaluate((element) => element.closest("[data-density]")?.getAttribute("data-density"))).toBe("compact");

    await setTextSize(page, "small");
    expect(await densitySizes(page, "main")).toEqual({ body: 14, meta: 12.5 });
    const texts = await renderedTexts(page);
    expect(texts.length).toBeGreaterThan(5);
    for (const t of texts) {
      expect.soft(t.density, `Density of "${t.text}"`).toBe("compact");
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(fontFloorOf(t));
      expect.soft(t.contrast, `contrast of "${t.text}" (${t.color} on ${t.background})`).toBeGreaterThanOrEqual(4.5);
    }

    await setTextSize(page, "xlarge");
    expect(await densitySizes(page, "main")).toEqual({ body: 17.5, meta: 15.625 });
  });
});

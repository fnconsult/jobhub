import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #1152 (ADR-0009, amendment of 2026-11-26): the Text Size moved one step down, and « Petit » sets 12px body
// text. The text shrinks, never the targets: at Petit, a control that reaches a target size of the Design System at
// the Standard Text Size still reaches it (44px, Confort's 40px control height, WCAG 2.5.8's 24 × 24px); a link inside
// a sentence is text and follows the text. Nothing runs off the side.

/** The target sizes a control keeps, largest first: the Candidate's 44px, Confort's control height, WCAG 2.5.8's. */
const TARGET_SIZES = [44, 40, 24];
const keptOf = (px: number) => TARGET_SIZES.find((size) => px >= size - 0.5) ?? 0;

type Target = { name: string; width: number; height: number };

/** Every visible control that is not a link inside a sentence (WCAG 2.5.8's inline exception), in document order. */
async function targets(page: Page): Promise<Target[]> {
  return page.evaluate(() => {
    const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="switch"]';
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") return false;
        if (element.closest("[inert], [aria-hidden='true']")) return false;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        // A link or a glossary term inside a sentence is exempt (WCAG 2.5.8): it is text, and follows the text.
        return style.display !== "inline";
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        const name = (element.getAttribute("aria-label") ?? element.textContent ?? element.tagName).trim().replace(/\s+/g, " ").slice(0, 60);
        return { name: `${element.tagName.toLowerCase()} « ${name} »`, width: box.width, height: box.height };
      });
  });
}

async function atTextSize(page: Page, path: string, size: string): Promise<Target[]> {
  await page.evaluate((value) => localStorage.setItem("jobbbox.textSize", value), size);
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-text-size", size);
  await page.waitForLoadState("networkidle");
  return targets(page);
}

async function checkPage(page: Page, path: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const standard = await atTextSize(page, path, "standard");
    const small = await atTextSize(page, path, "small");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("12px");
    expect(await page.evaluate(() => getComputedStyle(document.body).fontSize), "body text at Petit").toBe("12px");
    // Nothing runs off the side.
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} at ${width}px: the page's width`).toBeLessThanOrEqual(width);
    // The same controls, each keeping the target size it reached at Standard.
    expect(small.map((t) => t.name), `${path} at ${width}px: the same controls at Petit`).toEqual(standard.map((t) => t.name));
    small.forEach((target, i) => {
      const before = standard[i]!;
      const label = `${path} at ${width}px: ${target.name}`;
      expect.soft(target.height, `${label}, its height`).toBeGreaterThanOrEqual(keptOf(before.height) - 0.5);
      expect.soft(target.width, `${label}, its width`).toBeGreaterThanOrEqual(Math.min(keptOf(before.width), 24) - 0.5);
    });
  }
}

test.describe("At the « Petit » Text Size, 12px, controls keep their target size and nothing runs off the side", () => {
  test("the public pages", async ({ page }) => {
    await page.goto("/connexion");
    for (const path of ["/", "/connexion", "/aide"]) await checkPage(page, path);
  });

  test("the Candidate's pages", async ({ page }) => {
    test.setTimeout(180_000);
    await signInWithMagicLink(page, newAddress("text-size-small"));
    for (const path of ["/", "/compte", "/candidatures", "/recherches", "/agenda", "/abonnement"]) await checkPage(page, path);
  });
});

import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #569 (ADR-0066): « Voir comment » beside a Tutorial's step, after a FAQ's answer, or in an empty state. Nothing
// plays before the click; the click plays the Micro-animation once, then offers « Revoir ». Under
// prefers-reduced-motion: reduce, the click shows a still image of the final state, and nothing moves. The drawing is
// aria-hidden: the written step beside it is what a screen reader reads (axe, WCAG 2.2 AA, ADR-0009).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const TUTORIAL = "/aide/extension/tutorial-extension-save-job-offer";
const FAQ = "/aide/utiliser/faq-text-size";

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

/** The animations running in the page's « Voir comment » drawings. */
const running = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".ds-micro-animation")].flatMap((widget) => widget.getAnimations({ subtree: true })).filter((animation) => animation.playState === "running").length,
  );

test.describe("« Voir comment » (#569)", () => {
  test("beside a Tutorial's step: nothing plays before the click, it plays once, then « Revoir »", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(TUTORIAL);
    const step = page.locator(".help-centre__body ol > li").nth(1);
    const widget = step.locator("[data-micro-animation='extension-side-panel']");
    await expect(widget).toHaveAttribute("data-state", "idle");
    await expect(page.locator(".ds-micro-animation__stage")).toHaveCount(0);
    expect(await running(page)).toBe(0);

    await widget.getByRole("button", { name: fr.microAnimation.show }).click();
    await expect(widget).toHaveAttribute("data-state", "playing");
    await expect(widget.locator(".ds-micro-animation__stage")).toHaveAttribute("aria-hidden", "true");
    expect(await running(page)).toBeGreaterThan(0);

    await expect(widget.getByRole("button", { name: fr.microAnimation.replay })).toBeVisible({ timeout: 8000 });
    await expect(widget).toHaveAttribute("data-state", "played");
    expect(await running(page)).toBe(0);

    // The written step stays the content: a screen reader reads it whole, and nothing of the drawing.
    await expect(step).toContainText("l'épingle à côté de Jobbbox");
    expect(await step.locator(".ds-micro-animation__stage").evaluate((stage) => stage.closest("[aria-hidden='true']") === stage)).toBe(true);
    expect(await axeViolations(page)).toEqual([]);

    await widget.getByRole("button", { name: fr.microAnimation.replay }).click();
    await expect(widget).toHaveAttribute("data-state", "playing");
  });

  test("under prefers-reduced-motion, a FAQ's « Voir comment » shows the still final state, and nothing moves", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(FAQ);
    const widget = page.locator("[data-micro-animation='text-size']");
    await widget.getByRole("button", { name: fr.microAnimation.show }).click();
    await expect(widget).toHaveAttribute("data-state", "still");
    const stage = widget.locator(".ds-micro-animation__stage");
    await expect(stage).toBeVisible();
    expect(await running(page)).toBe(0);
    // The thumb rests on « Grand », the last notch: the final state, not the first frame.
    const thumb = () => stage.locator(".ma-size__thumb").evaluate((element) => getComputedStyle(element).transform);
    const still = await thumb();
    expect(still).toContain("199");
    await page.waitForTimeout(500);
    expect(await thumb()).toBe(still);
    expect(await axeViolations(page)).toEqual([]);

    await widget.getByRole("button", { name: fr.microAnimation.hide }).click();
    await expect(stage).toHaveCount(0);
  });

  test("in a Candidate's empty state: « Mes candidatures » with no application shows « Voir comment »", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("micro-animations"));
    await page.goto("/candidatures");
    await expect(page.getByText(fr.applications.none)).toBeVisible();
    const widget = page.locator("[data-micro-animation='extension-side-panel']");
    await expect(widget).toHaveAttribute("data-state", "idle");
    await widget.getByRole("button", { name: fr.microAnimation.show }).click();
    await expect(widget).toHaveAttribute("data-state", "playing");
  });
});

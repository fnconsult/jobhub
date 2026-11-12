import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { ficheOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// Issue #932: on a laptop the Fiche (20rem) cut its values at its right edge. A handle on its left edge widens it, from
// 20rem up to half the window, 44rem at most, never leaving the conversation under 28rem; by dragging, by the keyboard
// (← →, Home, End), or by a click (to its widest, WCAG 2.2 2.5.7); a double-click goes back to 20rem. This browser
// remembers the width, set before first paint on the next load. On a phone the Fiche takes the whole screen: no handle.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const LAPTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

/** A new Candidate with an Application, its page open. */
async function openApplication(page: Page) {
  await signInWithMagicLink(page, newAddress("fiche-resize"));
  const profile = await page.request.post("/api/profiles", {
    data: {
      masterCv: { fullName: "Hélène Garnier", headline: "Head of BU", email: "helene.garnier@example.fr", phone: "", location: "Paris", summary: "", experience: [], education: [], skills: [], languages: [] },
      searchCriteria: { targetRole: "Head of BU / Professional Services", locations: ["Paris"] },
    },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: `https://joinus.canalplus.com/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
      title: "Head of Business Unit Professional Services (H/F)",
      content: "Vous dirigez la Business Unit Professional Services.",
      employer: "Canal+",
      location: "Issy-les-Moulineaux",
    },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`/candidatures/${(await saved.json()).id}`);
}

const handleOf = (page: Page) => page.getByRole("separator", { name: fr.fiche.resize });
const widthOf = async (page: Page) => Math.round((await ficheOf(page).boundingBox())!.width);
/** The root font size, which the Density and the Text Size set (17px in Confort): the Fiche's limits are in rem. */
const remOf = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
const conversationWidth = async (page: Page) => Math.round((await page.locator("main").boundingBox())!.width);

test.describe("the Fiche's width (#932)", () => {
  test("widens by dragging its handle, up to its limit, and keeps its width on the next load", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await openApplication(page);
    const REM = await remOf(page);
    const handle = handleOf(page);
    await expect(handle).toBeVisible();
    expect(await widthOf(page)).toBe(20 * REM);
    await expect(handle).toHaveAttribute("aria-orientation", "vertical");
    await expect(handle).toHaveAttribute("aria-valuemin", String(20 * REM));
    // 1280px, the Sidebar open: the conversation keeps 28rem and 3rem of gutters, the rest is the Fiche's at most.
    const sidebar = (await page.locator(".sidebar-docked").boundingBox())!.width;
    const widest = Math.floor(Math.min(44 * REM, 1280 / 2, 1280 - sidebar - 31 * REM));
    await expect(handle).toHaveAttribute("aria-valuemax", String(widest));

    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await widthOf(page)).toBe(20 * REM + 80);
    await expect(handle).toHaveAttribute("aria-valuenow", String(20 * REM + 80));

    // Dragged far, it stops at its widest; the conversation keeps its 28rem.
    const after = (await handle.boundingBox())!;
    await page.mouse.move(after.x + after.width / 2, after.y + after.height / 2);
    await page.mouse.down();
    await page.mouse.move(after.x - 600, after.y + after.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(await widthOf(page)).toBe(widest);
    expect(await conversationWidth(page)).toBeGreaterThanOrEqual(30 * REM);

    // On the next load, as it was left, from the first paint.
    await page.reload();
    expect(await widthOf(page)).toBe(widest);
    await expect(handleOf(page)).toHaveAttribute("aria-valuenow", String(widest));

    const axe = await new AxeBuilder({ page }).include(".fiche").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);
  });

  test("is resized by the keyboard and by a click, and a double-click brings back its default width", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await openApplication(page);
    const REM = await remOf(page);
    const handle = handleOf(page);
    await handle.focus();
    await expect(handle).toBeFocused();

    await page.keyboard.press("ArrowLeft");
    expect(await widthOf(page)).toBe(22 * REM);
    await page.keyboard.press("ArrowRight");
    expect(await widthOf(page)).toBe(20 * REM);
    await page.keyboard.press("End");
    const widest = Number(await handle.getAttribute("aria-valuemax"));
    expect(await widthOf(page)).toBe(widest);
    await page.keyboard.press("Home");
    expect(await widthOf(page)).toBe(20 * REM);

    // A click alone: to its widest (WCAG 2.2, 2.5.7), once it is clear the click is not a double-click's.
    await handle.click();
    await expect.poll(() => widthOf(page)).toBe(widest);

    await handle.dblclick();
    expect(await widthOf(page)).toBe(20 * REM);
    expect(await page.evaluate(() => localStorage.getItem("jobbbox.fiche-width"))).toBeNull();
  });

  test("has no handle on a phone, where the Fiche takes the whole screen", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openApplication(page);
    await page.getByRole("banner").getByRole("button", { name: fr.fiche.label, exact: true }).click();
    await expect(ficheOf(page)).toBeVisible();
    expect(await widthOf(page)).toBe(PHONE.width);
    await expect(handleOf(page)).toHaveCount(0);

    const axe = await new AxeBuilder({ page }).include(".fiche").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map(({ id }) => id)).toEqual([]);
  });
});

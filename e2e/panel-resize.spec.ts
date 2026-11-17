import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { ficheOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// The columns beside the conversation resize from their left edge (#932): the side panel (« Fiche », « Documents »…) had
// a handle; the Work Pane, where an object's Sections (« Documents », « Correspondance »…), a Job Offer or the Agenda's
// week open, has the same one now. Each stops at a narrowest width where what it holds fits without a horizontal
// scrollbar, its tabs (« Message d'approche ») wrapping rather than cut. Their heads are a panel's, not a page's: the
// title at the lead size, the row slim, its ✕ on the title's line.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const LAPTOP = { width: 1280, height: 800 };
const DESKTOP = { width: 1440, height: 900 };
/** Room for the side panel and the Work Pane together (100rem, Fiche.tsx's ROOM_FOR_BOTH). */
const WIDE = { width: 1920, height: 1000 };
const WORK_PANE_KEY = "jobbbox.work-pane-width";

/** A new Candidate with an Application; its id. */
async function newApplication(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
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
      source: { url: `https://joinus.example.fr/offres/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
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
  return (await saved.json()).id as string;
}

const workPaneOf = (page: Page) => page.locator("aside.work-pane");
const workPaneHandleOf = (page: Page) => page.getByRole("separator", { name: fr.conversationFirst.resize });
const ficheHandleOf = (page: Page) => page.getByRole("separator", { name: fr.fiche.resize });
const widthOf = async (locator: Locator) => Math.round((await locator.boundingBox())!.width);
const remOf = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));

/**
 * What scrolls or is cut sideways in a column, or runs past its edge: nothing, at any width it may have. A row's hover
 * background may bleed half a rem past the text (the side panel's links), never more.
 */
async function horizontalOverflowIn(column: Locator): Promise<string[]> {
  return column.evaluate((root) => {
    const over: string[] = [];
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const edge = root.getBoundingClientRect().right;
    for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
      if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
      const style = getComputedStyle(el);
      const name = `${el.tagName.toLowerCase()}.${el.className}`;
      if (style.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1) over.push(`${name} ${style.overflowX === "auto" || style.overflowX === "scroll" ? "scrolls" : "is cut"}`);
      else if (el.getBoundingClientRect().right > edge + rem / 2 + 1) over.push(`${name} runs past`);
    }
    return over;
  });
}

/** A column's head: its height, and its title's font size against the root's. */
async function headOf(column: Locator) {
  return column.evaluate((root) => {
    const head = root.querySelector<HTMLElement>(":scope > .work-pane-head, :scope > .fiche-head")!;
    const title = head.querySelector("h2")!;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { height: head.getBoundingClientRect().height / rem, title: parseFloat(getComputedStyle(title).fontSize) / rem };
  });
}

async function drag(page: Page, handle: Locator, by: number) {
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + by, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}

test.describe("the columns beside the conversation resize, their heads slim (#932)", () => {
  test("« Documents » in the Work Pane: dragged and by the keyboard, never under 20rem, its tabs whole at its narrowest", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const id = await newApplication(page, "panel-resize-documents");
    await page.goto(`/candidatures/${id}/documents`);
    const pane = workPaneOf(page);
    await expect(pane.getByRole("heading", { level: 2, name: fr.fiche.views.documents })).toBeFocused();
    const REM = await remOf(page);
    const handle = workPaneHandleOf(page);
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute("aria-orientation", "vertical");
    await expect(handle).toHaveAttribute("aria-valuemin", String(20 * REM));
    // 32% of the window, between 20rem and 32rem, untouched.
    const initial = Math.round(Math.min(32 * REM, Math.max(20 * REM, DESKTOP.width * 0.32)));
    expect(await widthOf(pane)).toBe(initial);

    // The head is a panel's: the title at the lead size (18px in Confort, under h3's 20px), the row under 3rem.
    const head = await headOf(pane);
    expect(head.title).toBeLessThan(20 / 16);
    expect(head.height).toBeLessThan(3);

    // Dragged left, wider; remembered on release.
    await drag(page, handle, -80);
    expect(await widthOf(pane)).toBe(initial + 80);
    expect(await page.evaluate((key) => localStorage.getItem(key), WORK_PANE_KEY)).toBe(String(initial + 80));

    // By the keyboard: → narrower by 2rem, Home to its narrowest, ← back up by 2rem.
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    expect(await widthOf(pane)).toBe(initial + 80 - 2 * REM);
    await page.keyboard.press("Home");
    expect(await widthOf(pane)).toBe(20 * REM);
    await page.keyboard.press("ArrowRight");
    expect(await widthOf(pane)).toBe(20 * REM);

    // At its narrowest, nothing scrolls sideways nor runs past its edge: « Message d'approche » is whole.
    const tabs = pane.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(pane.getByRole("tab", { name: "Message d'approche" })).toBeVisible();
    expect(await horizontalOverflowIn(pane)).toEqual([]);
    for (const tab of await tabs.all()) expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    // Dragged past its narrowest, it stops there.
    await drag(page, handle, 400);
    expect(await widthOf(pane)).toBe(20 * REM);

    // On the next load, as it was left, from the first paint.
    await page.keyboard.press("End");
    const widest = Number(await handle.getAttribute("aria-valuemax"));
    expect(await widthOf(pane)).toBe(widest);
    expect(await horizontalOverflowIn(pane)).toEqual([]);
    await page.reload();
    expect(await widthOf(workPaneOf(page))).toBe(widest);

    // A double-click: its default width again, the one remembered forgotten.
    await workPaneHandleOf(page).dblclick();
    expect(await widthOf(workPaneOf(page))).toBe(initial);
    expect(await page.evaluate((key) => localStorage.getItem(key), WORK_PANE_KEY)).toBeNull();

    const axe = await new AxeBuilder({ page }).include("aside.work-pane").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map(({ id: rule }) => rule)).toEqual([]);
  });

  test("the « Fiche »: its head slim, nothing scrolling sideways at its narrowest, and resized beside the Work Pane", async ({ page }) => {
    await page.setViewportSize(WIDE);
    const id = await newApplication(page, "panel-resize-fiche");
    await page.goto(`/candidatures/${id}`);
    const fiche = ficheOf(page);
    await expect(fiche).toBeVisible();
    const REM = await remOf(page);
    expect(await widthOf(fiche)).toBe(20 * REM);

    const head = await headOf(fiche);
    expect(head.title).toBeLessThan(20 / 16);
    expect(head.height).toBeLessThan(3);
    expect(await horizontalOverflowIn(fiche)).toEqual([]);

    const handle = ficheHandleOf(page);
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    expect(await widthOf(fiche)).toBe(22 * REM);
    await page.keyboard.press("Home");
    expect(await widthOf(fiche)).toBe(20 * REM);
    await drag(page, handle, -64);
    expect(await widthOf(fiche)).toBe(20 * REM + 64);

    // A Section opened beside it: each column leaves room for the other and for the conversation's 28rem.
    await fiche.getByRole("link", { name: fr.fiche.views.documents }).first().click();
    await expect(workPaneOf(page)).toBeVisible();
    await workPaneHandleOf(page).focus();
    await page.keyboard.press("End");
    const conversation = (await page.locator("main").boundingBox())!.width;
    expect(conversation).toBeGreaterThanOrEqual(28 * REM);
    expect(await horizontalOverflowIn(fiche)).toEqual([]);
    expect(await horizontalOverflowIn(workPaneOf(page))).toEqual([]);
  });

  test("the Agenda's week in the Work Pane resizes the same way", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await signInWithMagicLink(page, newAddress("panel-resize-agenda"));
    await page.goto("/agenda?vue=semaine");
    const pane = workPaneOf(page);
    await expect(pane).toBeVisible();
    const REM = await remOf(page);
    const handle = workPaneHandleOf(page);
    // At its widest, the week's title on one line: the head a slim row. Narrower, the title wraps; nothing runs past.
    await handle.focus();
    await page.keyboard.press("End");
    expect((await headOf(pane)).height).toBeLessThan(3);
    await page.keyboard.press("Home");
    expect(await widthOf(pane)).toBe(20 * REM);
    expect(await horizontalOverflowIn(pane)).toEqual([]);
    await drag(page, handle, -96);
    expect(await widthOf(pane)).toBe(20 * REM + 96);
  });

  test("has no handle on a phone, where the Work Pane takes the whole screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const id = await newApplication(page, "panel-resize-phone");
    await page.goto(`/candidatures/${id}/documents`);
    await expect(workPaneOf(page)).toBeVisible();
    expect(await widthOf(workPaneOf(page))).toBe(390);
    await expect(workPaneHandleOf(page)).toHaveCount(0);
    expect(await horizontalOverflowIn(workPaneOf(page))).toEqual([]);
  });
});

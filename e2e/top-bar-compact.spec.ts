import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { chooseInTopBarMore, ficheOf, topBarMoreOf, workPaneOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// Issue #897: on a phone (below 40rem), the Candidate's Top Bar is one line: « Menu » as an icon, the page's title, its
// one action as an icon (the Fiche on an object's page, otherwise Activité) and « … », whose menu lists the others in
// words, each doing what its button does. Every icon is named, a 44 px target, and axe passes. At 1280 px nothing
// changes: the buttons keep their words.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };

const masterCv = {
  fullName: "Inès Garnier",
  headline: "Responsable des achats",
  email: "ines.garnier@example.fr",
  phone: "",
  location: "Nantes",
  summary: "",
  experience: [{ title: "Responsable des achats", employer: "Atlantique Agro", location: "Nantes", period: "2014 – 2026", description: "Achats indirects." }],
  education: [],
  skills: ["Négociation", "SAP Ariba"],
  languages: [],
};

/** Signs a new Candidate in with one Profile, whose id it returns. */
async function candidateWithProfile(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "Acheteuse", locations: ["Nantes"] } },
    headers: { origin },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id as string;
}

const topBarOf = (page: Page) => page.getByRole("banner");

/** The Top Bar's controls in reading order, by their names. */
async function topBarNames(page: Page): Promise<string[]> {
  return topBarOf(page)
    .locator("button:visible, a:visible")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") ?? (element as HTMLElement).innerText.trim()));
}

/** The Top Bar holds one line: every control and the title on the same row. */
async function expectOneLine(page: Page) {
  const bar = (await topBarOf(page).boundingBox())!;
  const boxes = await topBarOf(page)
    .locator("button:visible, h1:visible")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).map(({ top, bottom }) => ({ top, bottom })));
  expect(boxes.length).toBeGreaterThan(2);
  const middles = boxes.map(({ top, bottom }) => (top + bottom) / 2);
  expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(2);
  expect(bar.height).toBeLessThanOrEqual(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
}

/** Every icon in the Top Bar: named, its words in its tooltip, and at least 44 px both ways. */
async function expectNamedTargets(page: Page) {
  const buttons = await topBarOf(page)
    .locator("button:visible")
    .evaluateAll((elements) =>
      elements.map((element) => ({ name: element.getAttribute("aria-label"), text: (element as HTMLElement).innerText.trim(), box: element.getBoundingClientRect().toJSON() as DOMRect })),
    );
  for (const { name, text, box } of buttons) {
    expect(name, "an icon alone is named").toBeTruthy();
    expect(text).toBe("");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include(".topbar").analyze();
  expect(results.violations).toEqual([]);
}

test.describe("the compact Top Bar on a phone (#897)", () => {
  test("holds one line on each of the Candidate's pages: Menu, the title, one action as an icon and « … »", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const profile = await candidateWithProfile(page, "top-bar-pages");
    const pages: Array<{ path: string; shown: string; more: string[] }> = [
      { path: "/", shown: fr.fiche.activity, more: [fr.contextBar.clear] },
      { path: `/profils/${profile}`, shown: fr.fiche.label, more: [fr.fiche.activity, fr.contextBar.clear] },
      { path: "/candidatures", shown: fr.fiche.activity, more: [fr.contextBar.clear] },
      { path: "/recherches", shown: fr.fiche.activity, more: [fr.contextBar.clear] },
      { path: "/job-digests", shown: fr.fiche.activity, more: [fr.contextBar.clear] },
      { path: "/agenda", shown: fr.fiche.activity, more: [fr.contextBar.clear] },
      { path: "/compte", shown: fr.fiche.activity, more: [fr.conversationFirst.help] },
    ];
    for (const { path, shown, more } of pages) {
      await page.goto(path);
      await expect(topBarOf(page).getByRole("heading", { level: 1 })).toBeVisible();
      await expect(topBarMoreOf(page)).toBeVisible();
      expect(await topBarNames(page), path).toEqual([fr.sidebar.menu, shown, fr.sidebar.moreActions]);
      await expectOneLine(page);
      await expectNamedTargets(page);
      await expectNoAxeViolations(page);

      // The menu pattern: Enter opens it on its first item, Escape closes it, the focus back on « … ».
      await topBarMoreOf(page).focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem")).toHaveText(more);
      await expect(menu.getByRole("menuitem").first()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(topBarMoreOf(page)).toBeFocused();
    }
  });

  test("keeps a long title to its one line: cut short with an ellipsis, or a Profile's name scrolling in its field", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const profile = await candidateWithProfile(page, "top-bar-long-title");
    const long = "Responsable des achats indirects et de la sous-traitance industrielle";

    await page.goto("/candidatures");
    const title = topBarOf(page).getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    await title.evaluate((element, text) => (element.textContent = text), long);
    expect(await title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await title.evaluate((element) => getComputedStyle(element).textOverflow)).toBe("ellipsis");
    await expectOneLine(page);

    const renamed = await page.request.patch(`/api/profiles/${profile}`, { data: { name: long }, headers: { origin } });
    expect(renamed.ok(), await renamed.text()).toBe(true);
    await page.goto(`/profils/${profile}`);
    const name = topBarOf(page).getByRole("textbox", { name: fr.profileActions.name });
    await expect(name).toHaveValue(long);
    const lineHeight = await name.evaluate((element) => {
      const style = getComputedStyle(element);
      return parseFloat(style.lineHeight) || 1.5 * parseFloat(style.fontSize);
    });
    expect((await name.boundingBox())!.height).toBeLessThan(2 * lineHeight);
    await expectOneLine(page);
  });

  test("« … » does what each button did: « Activité » opens the Fiche on its Activity, the focus back on « … » when it closes", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const profile = await candidateWithProfile(page, "top-bar-activity");
    await page.goto(`/profils/${profile}`);

    // Through the keyboard: Enter opens the menu on its first item, the arrows move through it.
    await topBarMoreOf(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: fr.fiche.activity })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: fr.contextBar.clear })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("menuitem", { name: fr.fiche.activity })).toBeFocused();
    await page.keyboard.press("Enter");

    const fiche = ficheOf(page);
    await expect(fiche.getByRole("heading", { level: 2, name: fr.fiche.label })).toBeFocused();
    await expect(fiche.getByRole("button", { name: fr.fiche.groups.activity })).toHaveAttribute("aria-expanded", "true");
    await fiche.getByRole("button", { name: fr.conversationFirst.close }).click();
    await expect(fiche).toHaveCount(0);
    await expect(topBarMoreOf(page)).toBeFocused();

    // « Fiche », the icon shown, opens it too, and gets the focus back.
    const ficheButton = topBarOf(page).getByRole("button", { name: fr.fiche.label, exact: true });
    await ficheButton.click();
    await expect(fiche).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ficheButton).toBeFocused();
  });

  test("« Effacer la conversation » under « … » asks to confirm, then « Annuler » gives the focus back to « … »", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await candidateWithProfile(page, "top-bar-clear");
    await page.goto("/");

    await chooseInTopBarMore(page, fr.contextBar.clear);
    const dialog = page.getByRole("alertdialog", { name: fr.conversationFirst.clearTitle });
    await expect(dialog.getByRole("button", { name: fr.designSystem.cancel })).toBeFocused();
    await dialog.getByRole("button", { name: fr.designSystem.cancel }).click();
    await expect(dialog).toHaveCount(0);
    await expect(topBarMoreOf(page)).toBeFocused();
  });

  test("« Aide » under « … » on Mon compte opens its article over the page", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await candidateWithProfile(page, "top-bar-help");
    await page.goto("/compte");

    await chooseInTopBarMore(page, fr.conversationFirst.help);
    const pane = workPaneOf(page, "Mon compte");
    await expect(pane.getByRole("heading", { level: 2, name: "Mon compte" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(pane).toHaveCount(0);
  });
});

/** A page of the Candidate's, signed in as `page` is, that runs no script: what the server's HTML paints first. */
async function withoutJavaScript(browser: Browser, page: Page, viewport: typeof PHONE): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US", viewport, javaScriptEnabled: false, storageState: await page.context().storageState() });
  return context.newPage();
}

/** Where the Top Bar and its title sit. */
async function barAndTitle(page: Page) {
  const bar = (await topBarOf(page).boundingBox())!;
  const title = (await topBarOf(page).getByRole("heading", { level: 1 }).boundingBox())!;
  return { barHeight: bar.height, titleLeft: title.x, titleWidth: title.width };
}

test.describe("the Top Bar's first paint (#897)", () => {
  test("is the compact bar on a phone before and without JavaScript, and nothing moves when the page hydrates", async ({ page, browser }) => {
    await page.setViewportSize(PHONE);
    const profile = await candidateWithProfile(page, "top-bar-first-paint");
    const bare = await withoutJavaScript(browser, page, PHONE);
    try {
      for (const { path, shown } of [
        { path: "/", shown: fr.fiche.activity },
        { path: `/profils/${profile}`, shown: fr.fiche.label },
        { path: "/compte", shown: fr.fiche.activity },
      ]) {
        // The server's HTML alone: Menu, the title, one action and « … », icons alone; no button with its words.
        await bare.goto(path);
        await expect(topBarOf(bare).getByRole("heading", { level: 1 })).toBeVisible();
        expect(await topBarNames(bare), path).toEqual([fr.sidebar.menu, shown, fr.sidebar.moreActions]);
        await expect(topBarOf(bare).locator("button:visible").filter({ hasText: /\S/ })).toHaveCount(0);
        await expectOneLine(bare);
        const firstPaint = await barAndTitle(bare);

        // Hydrated: the same bar, at the same height, the title in the same place.
        await page.goto(path);
        await expect(topBarMoreOf(page)).toHaveAttribute("data-state", "closed");
        expect(await topBarNames(page), path).toEqual([fr.sidebar.menu, shown, fr.sidebar.moreActions]);
        expect(await barAndTitle(page), path).toEqual(firstPaint);
      }
    } finally {
      await bare.context().close();
    }
  });

  test("is the wide bar on a laptop without JavaScript: its buttons with their words, no icon alone, no « … »", async ({ page, browser }) => {
    await page.setViewportSize(LAPTOP);
    const profile = await candidateWithProfile(page, "top-bar-first-paint-laptop");
    const bare = await withoutJavaScript(browser, page, LAPTOP);
    try {
      await bare.goto(`/profils/${profile}`);
      await expect(topBarOf(bare).getByRole("heading", { level: 1 })).toBeVisible();
      expect(await topBarNames(bare)).toEqual([fr.fiche.label, fr.fiche.activity]);
      await expect(topBarMoreOf(bare)).toBeHidden();
    } finally {
      await bare.context().close();
    }
  });
});

test.describe("the Top Bar on a laptop (#897)", () => {
  test("is as before at 1280 px: its buttons with their words, no « … »", async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    const profile = await candidateWithProfile(page, "top-bar-laptop");

    await page.goto("/");
    await expect(topBarOf(page).getByRole("heading", { level: 1 })).toBeVisible();
    expect(await topBarNames(page)).toEqual([fr.fiche.activity, fr.conversationFirst.clear]);
    await page.goto(`/profils/${profile}`);
    await expect(topBarOf(page).getByRole("heading", { level: 1 })).toBeVisible();
    expect(await topBarNames(page)).toEqual([fr.fiche.label, fr.fiche.activity, fr.conversationFirst.clear]);
    await expect(topBarMoreOf(page)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #134: the Candidate's pages sit in the sidebar layout approved in the
// prototype (#132): a sidebar with the Profile switcher and labelled links,
// collapsible on wide screens and a drawer below 64rem, a skip link, and the
// Coach Panel docked on the right from 64rem (ADR-0024, which also puts each
// page's title in the Top Bar and signing out in the sidebar's foot).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Sorelis", location: "Lyon", period: "2012 – 2026", description: "" }],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

async function createProfile(page: Page, targetRole: string): Promise<string> {
  const response = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv: { ...masterCv, headline: targetRole }, searchCriteria: { targetRole, locations: ["Lyon"], contractTypes: ["cdi"] } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

const sidebarNav = (page: Page) => page.getByRole("navigation", { name: fr.sidebar.label });
const menuButton = (page: Page) => page.getByRole("button", { name: fr.sidebar.menu, exact: true });
const collapseButton = (page: Page) => page.getByRole("button", { name: fr.sidebar.collapse });
const coachButton = (page: Page) => page.getByRole("button", { name: fr.coachPanel.open, exact: true });
const coachPanel = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });
const drawer = (page: Page) => page.getByRole("dialog", { name: fr.sidebar.menu });

const NAV_LABELS = [fr.nav.applications, fr.sidebar.agenda, fr.sidebar.jobSearches, fr.sidebar.jobDigests, fr.account.humanCoaches];
/** Mon compte sits in the sidebar's foot, above signing out; the Subscription is one of its Sections. */
const accountLink = (page: Page) => page.getByRole("link", { name: fr.nav.account, exact: true });

/** What the focused element says: its accessible name as a screen reader would read it, roughly. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "";
    if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent?.trim() ?? "";
    return (el.getAttribute("aria-label") ?? el.innerText ?? "").replace(/\s+/g, " ").trim() || el.id || el.tagName.toLowerCase();
  });

test.describe("the sidebar layout of the Candidate's pages", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every Candidate page sits in it, with the Profile switcher, labelled links and signing out", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-pages"));
    const profileId = await createProfile(page, "Directrice administrative et financière");

    for (const path of [
      "/",
      "/compte",
      "/candidatures",
      `/profils/${profileId}`,
      "/profils/nouveau",
      "/coachs",
      "/abonnement",
      `/profils/${profileId}/versions`,
      `/profils/${profileId}/cv`,
      `/recherches?profil=${profileId}`,
      "/recherches?profil=tous",
    ]) {
      await page.goto(path);
      // The page's title is in the Top Bar.
      await expect(page.getByRole("banner").getByRole("heading", { level: 1 }), `heading on ${path}`).toBeVisible();
      await expect(sidebarNav(page), `sidebar on ${path}`).toBeVisible();
      await expect(page.getByRole("main"), `one main on ${path}`).toHaveCount(1);
      await expect(page.locator(".page-header"), `no old header on ${path}`).toHaveCount(0);
    }

    await page.goto("/compte");
    const links = sidebarNav(page).getByRole("link");
    await expect(links).toHaveText(NAV_LABELS);
    // Every icon comes with its label in words (ADR-0009): the icon is decoration.
    for (const link of await links.all()) {
      await expect(link.locator("svg")).toHaveAttribute("aria-hidden", "true");
      expect((await link.innerText()).trim().length).toBeGreaterThan(0);
    }
    await expect(accountLink(page)).toHaveAttribute("aria-current", "page");
    await page.goto("/abonnement");
    await expect(accountLink(page)).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: fr.account.sections.sectionsLabel }).getByRole("link", { name: fr.sidebar.subscription })).toHaveAttribute("aria-current", "page");
    await page.goto("/compte");
    await expect(sidebarNav(page).getByRole("link", { name: fr.sidebar.jobSearches })).toHaveAttribute("href", `/recherches?profil=${profileId}`);
    await expect(page.getByRole("navigation", { name: fr.profileSwitcher.label })).toBeVisible();
    // The Text Size setting moved to Mon compte → Préférences.
    await expect(page.getByLabel(fr.textSize.label)).toHaveCount(0);
    await expect(page.getByRole("button", { name: fr.account.signOut })).toBeVisible();

    // The links lead to their pages.
    await sidebarNav(page).getByRole("link", { name: fr.nav.applications }).click();
    await expect(page).toHaveURL(`${origin}/candidatures`);
    await expect(sidebarNav(page).getByRole("link", { name: fr.nav.applications })).toHaveAttribute("aria-current", "page");

    // Only catalogue strings, at the ADR-0009 floor.
    const allowed = new Set(catalogueStrings(fr));
    // The Usage Meter's percentage, a catalogue string with the week's number in it.
    allowed.add(fr.usageMeter.percent.replace("{{percent}}", "0"));
    for (const t of await renderedTexts(page)) {
      expect.soft(allowed.has(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the sidebar is collapsible, and stays as the Candidate left it", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-collapse"));
    await expect(sidebarNav(page)).toBeVisible();
    await expect(menuButton(page)).toBeHidden();

    await collapseButton(page).click();
    await expect(sidebarNav(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    // The page takes the room the sidebar left.
    expect((await page.getByRole("main").boundingBox())!.x).toBeLessThan(400);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(sidebarNav(page)).toBeHidden();

    await menuButton(page).click();
    await expect(sidebarNav(page)).toBeVisible();
    await expect(collapseButton(page)).toBeFocused();
    await page.reload();
    await expect(sidebarNav(page)).toBeVisible();
  });

  test("a skip link comes first, and focus moves through the sidebar, the top bar, then the page", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-focus"));
    await createProfile(page, "Directrice administrative et financière");
    await page.goto("/compte");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: fr.sidebar.skipToContent });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    const order: string[] = [];
    const stops = NAV_LABELS.length + 9;
    for (let i = 0; i < stops; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused(page));
    }
    expect(order).toEqual([
      fr.app.name,
      fr.profileSwitcher.choose,
      ...NAV_LABELS,
      // The Usage Meter reads as its title and the week's percentage.
      `${fr.usageMeter.title} ${fr.usageMeter.percent.replace("{{percent}}", "0")}`,
      fr.nav.account,
      fr.account.signOut,
      fr.sidebar.collapse,
      // AI Activity (#332): a page with no AI content, so its button shows only its label.
      fr.aiActivity.label,
      fr.coachPanel.open,
      order[stops - 1],
    ]);
    // After the top bar comes the page itself.
    expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);

    // The skip link jumps past the sidebar to the page.
    await page.goto("/compte");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);
  });

  test("the Coach Panel opens from the top bar and docks on the right, beside the page", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-coach"));
    await expect(page.getByRole("banner").getByRole("button", { name: fr.coachPanel.open, exact: true })).toBeVisible();
    await expect(coachButton(page)).toHaveCount(1);

    await coachButton(page).click();
    const panel = coachPanel(page);
    await expect(panel.getByLabel(fr.coachPanel.messageLabel)).toBeFocused();
    // Its Fermer button closes it: the top bar's steps aside meanwhile.
    await expect(coachButton(page)).toHaveCount(0);
    const box = (await panel.boundingBox())!;
    // A card inset by --space-2 (0.5rem, 8.5px at the standard text size), as AI Activity's pane (#332).
    const inset = 0.5 * 17;
    expect(box.x + box.width).toBeCloseTo(1440 - inset, 0);
    // A third of the window, between 27rem and 36rem.
    expect(box.width).toBeCloseTo(0.34 * 1440, 0);
    expect(box.height).toBeCloseTo(900 - 2 * inset, 0);
    // Docked: the page stays beside it, not under it.
    const main = (await page.getByRole("main").boundingBox())!;
    expect(main.x + main.width).toBeLessThanOrEqual(box.x + 1);
    // The message box stays at the bottom of the panel.
    const form = (await panel.locator("form").boundingBox())!;
    expect(form.y + form.height).toBeGreaterThan(900 - inset - 32);

    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }

    // Agrandir: a modal drawer over the page, which keeps its place beneath; Escape brings it back.
    await panel.getByRole("button", { name: fr.coachPanel.widen }).click();
    const drawerPanel = page.getByRole("dialog", { name: fr.coachPanel.title });
    expect((await drawerPanel.boundingBox())!.width).toBeCloseTo(64 * 17, 0); // 64rem at the standard text size (17px)
    expect((await page.locator("main").boundingBox())!.width).toBeCloseTo(main.width, 0);
    // Modal: the page beneath is out of reach.
    await expect(page.getByRole("main")).toHaveCount(0);
    await drawerPanel.getByLabel(fr.coachPanel.messageLabel).press("Escape");
    await expect(coachPanel(page)).toBeVisible();
    expect((await coachPanel(page).boundingBox())!.width).toBeCloseTo(box.width, 0);

    await panel.getByRole("button", { name: fr.coachPanel.close }).click();
    await expect(panel).toHaveCount(0);
    await expect(coachButton(page)).toBeFocused();
  });

  test("with no room beside the page for its Sections, the sidebar lists them, the main menu one arrow away", async ({ page }) => {
    // Room for the Sections beside the page at the standard text size (17px), until the Coach Panel docks.
    await page.setViewportSize({ width: 1170, height: 800 });
    await signInWithMagicLink(page, newAddress("sidebar-sections"));
    await page.goto("/compte/relances");
    const inPage = page.getByRole("main").getByRole("navigation", { name: fr.account.sections.sectionsLabel });
    await expect(inPage).toBeVisible();

    // The Coach Panel docked beside the page leaves its column too narrow.
    await coachButton(page).click();
    await expect(inPage).toBeHidden();
    const inSidebar = page.locator(".sidebar-docked").getByRole("navigation", { name: fr.account.sections.sectionsLabel });
    await expect(inSidebar.getByRole("link", { name: fr.account.sections.followUps })).toHaveAttribute("aria-current", "page");
    await expect(sidebarNav(page)).toHaveCount(0);

    await page.getByRole("button", { name: fr.sidebar.mainMenu }).click();
    await expect(sidebarNav(page)).toBeVisible();
    await expect(page.getByRole("button", { name: fr.account.title, exact: true })).toBeFocused();
    await page.getByRole("button", { name: fr.account.title, exact: true }).click();
    await expect(inSidebar).toBeVisible();
    await expect(page.getByRole("button", { name: fr.sidebar.mainMenu })).toBeFocused();
  });

  test("Mon compte's Outils Section offers the Chrome extension", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-tools"));
    await page.getByRole("navigation", { name: fr.account.sections.sectionsLabel }).getByRole("link", { name: fr.account.sections.tools }).click();
    await expect(page).toHaveURL(`${origin}/compte/outils`);
    const extension = page.getByRole("region", { name: fr.account.tools.extensionTitle });
    await expect(extension).toContainText(fr.account.tools.extensionIntro);
    // The e2e server sets no EXTENSION_STORE_URL; "coming soon" and the store page set on Paramètres are
    // checked in platform-settings.spec.ts (#303), which may set one while this runs.
  });

  test("the home page sits in it once signed in", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-home"));
    await page.goto("/");
    await expect(sidebarNav(page)).toBeVisible();
    await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toHaveText(fr.home.title);
    await expect(page.locator(".page-header")).toHaveCount(0);
  });
});

test.describe("below 64rem", () => {
  test.use({ viewport: { width: 1000, height: 800 } });

  test("the sidebar becomes a drawer, opened from the Menu button and closed by Escape or a link", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-drawer"));
    await createProfile(page, "Directrice administrative et financière");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(sidebarNav(page)).toBeHidden();
    await expect(collapseButton(page)).toBeHidden();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: fr.sidebar.skipToContent })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(menuButton(page)).toBeFocused();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Enter");
    await expect(drawer(page)).toBeVisible();
    const nav = drawer(page).getByRole("navigation", { name: fr.sidebar.label });
    await expect(nav.getByRole("link")).toHaveText(NAV_LABELS);
    // Focus goes into the drawer, onto the current page's link.
    await expect(drawer(page).getByRole("link", { name: fr.nav.account, exact: true })).toBeFocused();
    // The page behind is out of reach while it is open: its content and <main> itself,
    // which holds a live region (the Job Search notifications) that Radix's modal leaves exposed.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
    await expect(page.getByRole("main")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();

    await menuButton(page).click();
    await drawer(page).getByRole("button", { name: fr.sidebar.close }).click();
    await expect(drawer(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();

    await menuButton(page).click();
    await drawer(page).getByRole("link", { name: fr.nav.applications }).click();
    await expect(page).toHaveURL(`${origin}/candidatures`);
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.applications.title);
  });

  test("a Section of Mon compte shows alone, its title in the Top Bar leading back to the list", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-section-back"));
    await page.goto("/compte/relances");
    await expect(page.getByRole("region", { name: fr.followUps.delaysTitle })).toBeVisible();
    await expect(page.getByRole("navigation", { name: fr.account.sections.sectionsLabel })).toBeHidden();
    // As on iOS: an arrow before the title, no second way back in the page.
    const back = page.getByRole("banner").getByRole("link", { name: fr.account.title, exact: true });
    await expect(back.locator("svg")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("main").getByRole("link", { name: fr.account.sections.backToSections, exact: true })).toHaveCount(0);
    await back.click();
    await expect(page).toHaveURL(`${origin}/compte`);
    await expect(page.getByRole("navigation", { name: fr.account.sections.sectionsLabel })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: fr.account.title, exact: true })).toHaveCount(0);
  });

  test("the Coach Panel takes the whole screen, with nothing to widen", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-sheet"));
    await coachButton(page).click();
    const box = (await coachPanel(page).boundingBox())!;
    expect(box.x).toBeCloseTo(0, 0);
    expect(box.width).toBeCloseTo(1000, 0);
    await expect(coachPanel(page).getByRole("button", { name: fr.coachPanel.widen })).toBeHidden();
  });
});

test("screenshots at 3 widths", async ({ page }, testInfo) => {
  await signInWithMagicLink(page, newAddress("sidebar-screens"));
  const profileId = await createProfile(page, "Directrice administrative et financière");
  const dir = process.env.SIDEBAR_SCREENSHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [width, height] of [
    [375, 812],
    [900, 1000],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/profils/${profileId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Nothing runs off the side of the screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const shots: [string, () => Promise<void>][] = [["profile", async () => {}]];
    if (width < 1024)
      shots.push([
        "drawer",
        async () => {
          await menuButton(page).click();
          await expect(drawer(page)).toBeVisible();
        },
      ]);
    shots.push([
      "coach",
      async () => {
        if (width < 1024) await page.keyboard.press("Escape");
        await coachButton(page).click();
        await expect(coachPanel(page)).toBeVisible();
      },
    ]);
    for (const [name, show] of shots) {
      await show();
      // Let the drawer finish sliding in.
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
      const path = dir ? `${dir}/${width}-${name}.png` : testInfo.outputPath(`${width}-${name}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`${width}px ${name}`, { path, contentType: "image/png" });
    }
  }
});

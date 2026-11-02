import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { catalogueStrings, fromCatalogue, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #134: the Candidate's pages sit in the sidebar layout approved in the
// prototype (#132): a sidebar with the Profile switcher and labelled links,
// collapsible on wide screens and a drawer below 64rem, and a skip link (ADR-0024, which also puts each page's title in
// the Top Bar and signing out in the sidebar's foot). Since #608 the Candidate's pages are their conversations
// (ADR-0070): the Work Pane opens beside the page, on the right, where the Coach Panel docked.
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
/** « Aide » in the Top Bar of a page without a conversation (Mon compte, #602): the page's Help Article in the Work Pane. */
const helpButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: fr.conversationFirst.help, exact: true });
const workPane = (page: Page) => page.locator("aside.work-pane");
const drawer = (page: Page) => page.getByRole("dialog", { name: fr.sidebar.menu });

const NAV_LABELS = [fr.nav.applications, fr.sidebar.agenda, fr.sidebar.jobSearches, fr.sidebar.jobDigests, fr.account.humanCoaches];
/** The Sidebar's links to the menus are all there, among « Nouvelle conversation », the Free conversations and the menus' objects. */
async function expectNavLinks(nav: ReturnType<typeof sidebarNav>) {
  for (const label of NAV_LABELS) await expect(nav.getByRole("link", { name: label, exact: true }), label).toBeVisible();
}
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
    await expectNavLinks(sidebarNav(page));
    const links = sidebarNav(page).getByRole("link");
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
    // Recherches d'offres is one conversation for every Profile (#606).
    await expect(sidebarNav(page).getByRole("link", { name: fr.sidebar.jobSearches })).toHaveAttribute("href", "/recherches");
    await expect(page.getByRole("navigation", { name: fr.profileSwitcher.label })).toBeVisible();
    // The Text Size setting moved to Mon compte → Préférences.
    await expect(page.getByLabel(fr.textSize.label)).toHaveCount(0);
    await expect(page.getByRole("button", { name: fr.account.signOut })).toBeVisible();

    // The links lead to their pages.
    await sidebarNav(page).getByRole("link", { name: fr.nav.applications }).click();
    await expect(page).toHaveURL(`${origin}/candidatures`);
    await expect(sidebarNav(page).getByRole("link", { name: fr.nav.applications })).toHaveAttribute("aria-current", "page");

    // Only catalogue strings, at the ADR-0009 floor: the interface's, their numbers filled in, and the Help Articles'
    // titles the empty conversation offers (#342), written by the Jobbbox team.
    const inCatalogue = fromCatalogue(fr);
    const allowed = new Set(catalogueStrings(fr));
    // The Usage Meter's percentage, a catalogue string with the week's number in it.
    allowed.add(fr.usageMeter.percent.replace("{{percent}}", "0"));
    for (const file of readdirSync("packages/help/articles/fr")) allowed.add(/^title: (.+)$/m.exec(readFileSync(`packages/help/articles/fr/${file}`, "utf8"))![1]!);
    for (const t of await renderedTexts(page)) {
      expect.soft(allowed.has(t.text) || inCatalogue(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
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
    const stops = NAV_LABELS.length + 16;
    for (let i = 0; i < stops; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused(page));
    }
    expect(order).toEqual([
      fr.app.name,
      fr.profileSwitcher.choose,
      // The conversations (#601): « Nouvelle conversation », « Coach » folding them, the Coach Memory under it (#602).
      fr.conversationFirst.newConversation,
      fr.conversationFirst.coach,
      fr.coachMemory.open,
      ...NAV_LABELS,
      // « Aide et légal » (#544), at the top of the sidebar's foot.
      fr.publicSite.help,
      fr.publicSite.legal,
      fr.publicSite.nouveautes,
      // The Usage Meter reads as its title and the week's percentage.
      `${fr.usageMeter.title} ${fr.usageMeter.percent.replace("{{percent}}", "0")}`,
      fr.nav.account,
      // The Signalement icon, beside Mon compte on its row (#375).
      fr.signalement.open,
      fr.account.signOut,
      fr.sidebar.collapse,
      // « Activité » (#607) and « Aide » on a page without a conversation (#602).
      fr.fiche.activity,
      fr.conversationFirst.help,
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

  test("the Work Pane opens from the top bar on the right, beside the page, never over it (#602, #608)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-coach"));
    await expect(page.getByRole("banner").getByRole("button", { name: fr.coachPanel.open, exact: true })).toHaveCount(0);
    await helpButton(page).click();
    const pane = workPane(page);
    await expect(pane.getByRole("heading", { level: 2 })).toBeFocused();
    const box = (await pane.boundingBox())!;
    // A card a 1rem gutter from the screen's edge (17px at the standard text size), 32vw wide between 20rem and 32rem.
    expect(box.x + box.width).toBeCloseTo(1440 - 17, 0);
    expect(box.width).toBeCloseTo(Math.min(32 * 17, 0.32 * 1440), 0);
    // Beside the page: the page stays beside it, not under it.
    const main = (await page.getByRole("main").boundingBox())!;
    expect(main.x + main.width).toBeLessThanOrEqual(box.x + 1);

    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }

    await pane.getByRole("button", { name: fr.conversationFirst.close }).click();
    await expect(pane).toHaveCount(0);
    await expect(helpButton(page)).toBeFocused();
  });

  test("with no room beside the page for its Sections, the sidebar lists them, the main menu one arrow away", async ({ page }) => {
    // Room for the Sections beside the page at the standard text size (17px), until the Work Pane opens.
    await page.setViewportSize({ width: 1170, height: 800 });
    await signInWithMagicLink(page, newAddress("sidebar-sections"));
    await page.goto("/compte/relances");
    const inPage = page.getByRole("main").getByRole("navigation", { name: fr.account.sections.sectionsLabel });
    await expect(inPage).toBeVisible();

    // The Work Pane beside the page leaves its column too narrow.
    await helpButton(page).click();
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
    // A new Free conversation (#601).
    await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toHaveText(fr.conversationFirst.newConversation);
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
    await expectNavLinks(nav);
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

  test("the Work Pane takes the whole screen over the page, out of reach behind it (#608)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("sidebar-sheet"));
    await helpButton(page).click();
    const box = (await workPane(page).boundingBox())!;
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 1000, 800]);
    await expect(page.locator("main")).toHaveAttribute("inert", "");
    await workPane(page).getByRole("button", { name: fr.conversationFirst.close }).click();
    await expect(page.locator("main")).not.toHaveAttribute("inert", "");
    await expect(helpButton(page)).toBeFocused();
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
      "fiche",
      async () => {
        if (width < 1024) await page.keyboard.press("Escape");
        const fiche = page.getByRole("complementary", { name: fr.fiche.label });
        if (!(await fiche.isVisible())) await page.getByRole("banner").getByRole("button", { name: fr.fiche.label }).click();
        await expect(fiche).toBeVisible();
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

import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #544: the public shell. Every public page has the header (Nouveautés, Aide, Légal, the FR/EN switch, the text
// size, « Se connecter ») and the footer (Légal, Aide, Jobbbox), in French and in English, reached by the keyboard on a
// desktop and on a phone, where the header's links fold behind « Menu ». « Aide et légal » in the Candidate's Sidebar,
// the footer under the coach space, the public Légal from the Back Office.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
// Its own permanent super-admin (ADMIN_EMAILS): two sign-ins of one address at once can pick up each other's link.
const BACK_OFFICE = "public-shell-office@e2e.jobbbox.test";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** The public pages (#544), each with its `<h1>` in each language. */
const PUBLIC_PAGES = [
  { path: "/legal/cgv", title: (c: typeof fr) => c.legal.texts.cgv },
  { path: "/nouveautes", title: (c: typeof fr) => c.nouveautes.title },
  { path: "/aide", title: (c: typeof fr) => c.helpCentre.title },
  { path: "/connexion", title: (c: typeof fr) => c.signIn.title },
  { path: "/desabonnement", title: (c: typeof fr) => c.jobDigest.unsubscribePage.title },
  { path: "/compte/supprime", title: (c: typeof fr) => c.accountDeleted.title },
  { path: "/une-page-introuvable", title: (c: typeof fr) => c.errorPage.notFound.title },
];

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

const header = (page: Page) => page.getByRole("banner");
const footer = (page: Page) => page.getByRole("contentinfo");

/** The footer's links, column by column, then its FR/EN switch, in a catalogue's words. */
function footerLinkNames(c: typeof fr, signIn = true): string[] {
  const legal = c.publicFooter.legal;
  const help = c.publicFooter.help;
  return [
    legal.mentionsLegales,
    legal.cgu,
    legal.cgv,
    legal.confidentialite,
    legal.ia,
    help.helpCentre,
    help.contact,
    help.extension,
    c.publicSite.nouveautes,
    ...(signIn ? [c.nav.signIn] : []),
    "Français",
    "English",
  ];
}

/** What an element is called: a field's label, else its text but what is hidden from screen readers (« FR »). */
function nameOf(element: Element | null): string {
  if (!element) return "";
  if (element instanceof HTMLSelectElement) return element.labels?.[0]?.textContent ?? "";
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The names of the links in `area`. */
const linkNames = (area: Locator) => area.getByRole("link").evaluateAll((links, name) => links.map((link) => new Function("element", `return (${name})(element)`)(link) as string), nameOf.toString());

/** The name of what has the focus, after pressing Tab. */
async function tabTo(page: Page): Promise<string> {
  await page.keyboard.press("Tab");
  return page.evaluate((name) => new Function("element", `return (${name})(element)`)(document.activeElement) as string, nameOf.toString());
}

/** Every link of `area` is at least 24px by 24px (WCAG 2.2, 2.5.8). */
async function targetsAtLeast24px(area: Locator) {
  for (const link of await area.getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(box.height, await link.textContent()).toBeGreaterThanOrEqual(24);
    expect(box.width, await link.textContent()).toBeGreaterThanOrEqual(24);
  }
}

test.describe("the public shell on a desktop", () => {
  test.use({ viewport: DESKTOP });

  test("every public page has the header and the footer, in French and in English, without an axe violation", async ({ page }) => {
    for (const { path, title } of PUBLIC_PAGES) {
      for (const [lang, c] of [
        ["fr", fr],
        ["en", en],
      ] as const) {
        await page.goto(`${path}?lang=${lang}`);
        await expect(page.locator("html"), path).toHaveAttribute("lang", lang);
        await expect(page.getByRole("heading", { level: 1 }), path).toHaveText(title(c));
        const nav = header(page).getByRole("navigation", { name: c.publicSite.nav });
        await expect(nav.getByRole("link"), path).toHaveText([c.publicSite.nouveautes, c.publicSite.help, c.publicSite.legal]);
        expect(await linkNames(header(page).getByRole("navigation", { name: c.publicSite.language })), path).toEqual(["Français", "English"]);
        await expect(header(page).getByLabel(c.textSize.label), path).toBeVisible();
        const signIn = path === "/connexion" ? 0 : 1;
        await expect(header(page).getByRole("link", { name: c.nav.signIn }), path).toHaveCount(signIn);
        for (const column of [c.publicFooter.legal.title, c.publicFooter.help.title, c.app.name]) {
          await expect(footer(page).getByRole("navigation", { name: column }), `${path}: ${column}`).toBeVisible();
        }
        expect(await linkNames(footer(page)), path).toEqual(footerLinkNames(c, signIn === 1));
        await expect(footer(page), path).toContainText(c.publicFooter.copyright);
      }
      expect(await axeViolations(page), path).toEqual([]);
    }
  });

  test("« IA dans Jobbbox » leads to the privacy policy's AI section; a text not written yet shows that it is not published", async ({ page }) => {
    await page.goto("/nouveautes");
    const ai = footer(page).getByRole("link", { name: fr.publicFooter.legal.ia });
    await expect(ai).toHaveAttribute("href", "/legal/confidentialite#ia");
    await ai.click();
    await expect(page).toHaveURL(`${origin}/legal/confidentialite#ia`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.legal.texts.confidentialite);
    // The CGV: not written yet, never a 404.
    const response = await page.goto("/legal/cgv");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: fr.legal.notPublishedTitle })).toBeVisible();
  });

  test("the FR/EN switch changes the page's language, which the shell's links keep; the text size holds from page to page", async ({ page }) => {
    await page.goto("/legal/mentions-legales");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(header(page).getByRole("link", { name: "Français" })).toHaveAttribute("aria-current", "true");
    await header(page).getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(`${origin}/legal/mentions-legales?lang=en`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.legal.texts["mentions-legales"]);
    await expect(header(page).getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "true");

    // A link of the shell keeps English.
    await header(page).getByRole("link", { name: en.publicSite.nouveautes }).click();
    await expect(page).toHaveURL(`${origin}/nouveautes?lang=en`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.nouveautes.title);
    await expect(footer(page).getByRole("link", { name: en.publicFooter.legal.ia })).toHaveAttribute("href", "/legal/confidentialite?lang=en#ia");

    // Back to French from the footer's switch.
    await footer(page).getByRole("link", { name: "Français" }).click();
    await expect(page).toHaveURL(`${origin}/nouveautes?lang=fr`);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    // The text size chosen on one page is kept on the next.
    await header(page).getByLabel(fr.textSize.label).selectOption("xlarge");
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
    await page.goto("/aide");
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
    await expect(header(page).getByLabel(fr.textSize.label)).toHaveValue("xlarge");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.helpCentre.title);
  });

  test("the keyboard reaches every link of the header, then of the footer, in reading order, each target 24px at least", async ({ page }) => {
    await page.goto("/aide");
    await page.locator("body").focus();
    const headerOrder = [];
    for (let i = 0; i < 8; i++) headerOrder.push(await tabTo(page));
    expect(headerOrder).toEqual([fr.app.name, fr.publicSite.nouveautes, fr.publicSite.help, fr.publicSite.legal, "Français", "English", fr.textSize.label, fr.nav.signIn]);
    await targetsAtLeast24px(header(page));

    // From just before the footer, its links, in order.
    await footer(page).evaluate((foot) => {
      const marker = document.createElement("span");
      marker.tabIndex = 0;
      marker.id = "before-footer";
      foot.before(marker);
      marker.focus();
    });
    const footerOrder = [];
    for (let i = 0; i < footerLinkNames(fr).length; i++) footerOrder.push(await tabTo(page));
    expect(footerOrder).toEqual(footerLinkNames(fr));
    await targetsAtLeast24px(footer(page));

    // Enter follows a footer link.
    await footer(page).getByRole("link", { name: fr.publicFooter.legal.cgv }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${origin}/legal/cgv`);
  });
});

test.describe("the public shell on a phone", () => {
  test.use({ viewport: PHONE });

  test("the header's links fold behind « Menu », the language and the text size stay in view; the keyboard opens and closes it", async ({ page }) => {
    await page.goto("/nouveautes");
    const menu = header(page).getByRole("button", { name: fr.publicSite.menu });
    const nav = header(page).getByRole("navigation", { name: fr.publicSite.nav });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
    await expect(header(page).getByRole("link", { name: "English" })).toBeVisible();
    await expect(header(page).getByLabel(fr.textSize.label)).toBeVisible();
    await expect(header(page).getByRole("link", { name: fr.nav.signIn })).toBeVisible();

    await page.locator("body").focus();
    expect(await tabTo(page)).toBe(fr.app.name);
    expect(await tabTo(page)).toBe(fr.publicSite.menu);
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link")).toHaveText([fr.publicSite.nouveautes, fr.publicSite.help, fr.publicSite.legal]);
    expect(await tabTo(page)).toBe(fr.publicSite.nouveautes);
    expect(await tabTo(page)).toBe(fr.publicSite.help);
    expect(await tabTo(page)).toBe(fr.publicSite.legal);
    expect(await tabTo(page)).toBe("Français");
    await targetsAtLeast24px(header(page));
    expect(await axeViolations(page)).toEqual([]);

    // Escape closes it, the focus back on « Menu ».
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    await expect(nav).toBeHidden();

    // A link of the menu leads to its page, the menu closed there.
    await menu.click();
    await nav.getByRole("link", { name: fr.publicSite.help }).click();
    await expect(page).toHaveURL(`${origin}/aide`);
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    // The footer, its columns one under the other, reached by the keyboard too.
    await footer(page).getByRole("link", { name: fr.publicFooter.legal.mentionsLegales }).focus();
    expect(await tabTo(page)).toBe(fr.publicFooter.legal.cgu);
    await targetsAtLeast24px(footer(page));
    expect(await axeViolations(page)).toEqual([]);
  });
});

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string, viewport = DESKTOP): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, viewport });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

test.describe("Aide et légal from the app, the coach space and the Back Office", () => {
  test("the Candidate's Sidebar shows « Aide et légal », on a desktop and in the phone's drawer", async ({ browser }) => {
    const page = await personPage(browser, newAddress("public-shell.candidate"));
    try {
      await page.goto("/compte");
      const block = page.locator(".sidebar-docked").getByRole("navigation", { name: fr.sidebar.helpAndLegal });
      await expect(block.getByRole("link")).toHaveText([fr.publicSite.help, fr.publicSite.legal, fr.publicSite.nouveautes]);
      await expect(block.getByRole("link", { name: fr.publicSite.legal })).toHaveAttribute("href", "/legal/cgu");
      await targetsAtLeast24px(block);

      await page.setViewportSize(PHONE);
      await page.getByRole("button", { name: fr.sidebar.menu, exact: true }).click();
      const drawer = page.getByRole("dialog", { name: fr.sidebar.menu });
      const inDrawer = drawer.getByRole("navigation", { name: fr.sidebar.helpAndLegal });
      await expect(inDrawer.getByRole("link")).toHaveText([fr.publicSite.help, fr.publicSite.legal, fr.publicSite.nouveautes]);
      await inDrawer.getByRole("link", { name: fr.publicSite.nouveautes }).click();
      await expect(page).toHaveURL(`${origin}/nouveautes`);
      // Signed in, the public header and footer lead to « Mon compte ».
      await expect(header(page).getByRole("link", { name: fr.nav.account })).toHaveAttribute("href", "/compte");
      await expect(footer(page).getByRole("link", { name: fr.nav.account })).toHaveAttribute("href", "/compte");
    } finally {
      await page.context().close();
    }
  });

  test("the Back Office links to the public Légal; the coach space has the public footer", async ({ browser }) => {
    const admin = await personPage(browser, BACK_OFFICE);
    const coachEmail = newAddress("public-shell.coach");
    try {
      await admin.goto("/admin");
      const legal = admin.locator(".sidebar-docked").getByRole("link", { name: fr.admin.nav.publicLegal });
      await expect(legal).toHaveAttribute("href", "/legal/cgu");

      // A Human Coach, added in the Back Office.
      const name = `Sophie Martin ${Date.now()}`;
      await admin.goto("/admin/coachs");
      await admin.getByLabel(fr.admin.humanCoaches.name).fill(name);
      await admin.getByLabel(fr.admin.humanCoaches.email).fill(coachEmail);
      await admin.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/sophie-${Date.now()}/seance`);
      await admin.getByLabel(fr.admin.humanCoaches.bio).fill("Ancienne DRH dans l'industrie.");
      await admin.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
      await expect(admin.getByRole("status")).toHaveText(fr.admin.humanCoaches.added.replace("{{name}}", name));
    } finally {
      await admin.context().close();
    }

    const coach = await personPage(browser, coachEmail);
    try {
      await coach.goto("/espace-coach");
      await expect(coach.getByRole("heading", { level: 1 })).toHaveText(fr.coachSpace.title);
      for (const column of [fr.publicFooter.legal.title, fr.publicFooter.help.title, fr.app.name]) {
        await expect(footer(coach).getByRole("navigation", { name: column })).toBeVisible();
      }
      await expect(footer(coach).getByRole("link", { name: fr.publicFooter.legal.ia })).toHaveAttribute("href", "/legal/confidentialite#ia");
      await targetsAtLeast24px(footer(coach));
    } finally {
      await coach.context().close();
    }
  });
});

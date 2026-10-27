import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";
import { designTokens as liveTokens, TEXT_SIZE_STORAGE_KEY } from "../packages/shared/src/design";

// Issue #132: the clickable Notion-like layout prototype (docs/prototypes/notion-layout.html).
// It is a static page, so its public entry point is the page in a browser. The artifact wraps the
// file in a document (doctype, viewport); this spec serves it the same way on a throwaway port and
// drives it as a Candidate would: by clicking, typing and resizing the window.
// One test group per acceptance criterion of the issue. The last criterion (François approves a
// version, link and decisions recorded on #132 and #123) is a human step, not testable here; the
// "Notes du prototype" page that carries the decisions is covered instead.
const fragment = readFileSync("docs/prototypes/notion-layout.html", "utf8");

// The prototype keeps the Notion look's tokens it was drawn with: ADR-0053 (#461) moved the live tokens to the
// Design System's palette and Inter, and this page is a frozen record of #132, so it is checked against its own.
const designTokens = {
  color: {
    background: "#ffffff", surface: "#f7f7f5", border: "#e3e2e0", text: "#37352f", textSecondary: "#5a5955",
    accent: "#1f5fbf", danger: "#b42318", success: "#1e6e3a", onAccent: "#ffffff",
  },
  fontFamily: { sans: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' },
  fontSize: { body: 16 },
  textSize: liveTokens.textSize,
};
const document_ = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${fragment}</body></html>`;

let server: http.Server;
let origin: string;

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(document_);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const VIEWS = ["recherche", "candidature", "profil", "candidatures", "recherches", "job-digests", "compte", "abonnement", "notes"] as const;
const DESKTOP = { width: 1440, height: 900 };
const LAPTOP = { width: 1100, height: 800 }; // between 64rem and 80rem
const TABLET = { width: 900, height: 800 }; // below 64rem
const PHONE = { width: 375, height: 812 };

async function open(page: Page, view: string, size = DESKTOP) {
  await page.setViewportSize(size);
  await page.goto(`${origin}/#${view}`);
  await expect(page.locator(`article[data-view="${view}"]`)).toBeVisible();
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Navigation principale" });
const coach = (page: Page) => page.getByRole("complementary", { name: "Votre coach" });
const statusPill = (page: Page) => page.locator('[data-view="candidatures"] [data-bind="app-status"]');
const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("clickable prototype, reviewable on a phone", () => {
  test("opens on an Application and every page is reachable from the sidebar by clicking", async ({ page }) => {
    await open(page, "candidature");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Directeur administratif et financier");
    for (const [link, heading] of [
      ["CV et critères de recherche", /Directrice administrative et financière/],
      ["Candidatures", "Candidatures"],
      ["Recherches d'offres", "Recherches d'offres"],
      ["Job Digests", "Job Digests"],
      ["Mon compte", "Mon compte"],
      ["Abonnement", "Abonnement"],
    ] as const) {
      await sidebar(page).getByRole("link", { name: link }).click();
      const h1 = page.locator("article:visible h1");
      await expect(h1).toBeVisible();
      if (typeof heading === "string") await expect(h1).toHaveText(heading);
      else await expect(h1.locator("textarea")).toHaveValue(heading);
    }
  });

  test("on a 375px phone no page scrolls sideways and the drawer opens from the Menu button", async ({ page }) => {
    for (const view of VIEWS) {
      await open(page, view, PHONE);
      expect(await horizontalOverflow(page), `${view} overflows horizontally`).toBe(0);
    }
    await open(page, "candidatures", PHONE);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("link", { name: "Abonnement" }).click();
    await expect(page.locator('article[data-view="abonnement"]')).toBeVisible();
  });

  test("the whole layout fits a phone with the coach open and with the largest text", async ({ page }) => {
    await open(page, "candidature", PHONE);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Très grande" }).click();
    await page.getByRole("button", { name: "Fermer" }).first().click();
    for (const view of VIEWS) {
      await page.goto(`${origin}/#${view}`);
      await expect(page.locator(`article[data-view="${view}"]`)).toBeVisible();
      expect(await horizontalOverflow(page), `${view} overflows horizontally at xlarge`).toBe(0);
    }
  });
});

test.describe("sidebar layout", () => {
  test("lists Profils with a switcher, Candidatures, Recherches d'offres, Job Digests, Mon compte and Abonnement in that order", async ({ page }) => {
    await open(page, "candidature");
    const nav = sidebar(page);
    await expect(nav.getByText("Profils", { exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: /Directrice administrative et financière/ })).toBeVisible();
    const labels = await nav.locator("a.nav-link").evaluateAll((links) => links.map((a) => a.textContent!.replace(/\s+/g, " ").trim()));
    expect(labels).toEqual(["CV et critères de recherche", "Candidatures 6", "Recherches d'offres", "Job Digests", "Mon compte", "Abonnement", "Notes du prototype"]);
  });

  test("the current page is marked in the sidebar and in the breadcrumb", async ({ page }) => {
    await open(page, "job-digests");
    await expect(sidebar(page).getByRole("link", { name: "Job Digests" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("list", { name: "Fil d'Ariane" }).locator('[aria-current="page"]')).toHaveText("Job Digests");
    await sidebar(page).getByRole("link", { name: "Abonnement" }).click();
    await expect(sidebar(page).getByRole("link", { name: "Job Digests" })).not.toHaveAttribute("aria-current", "page");
    await expect(sidebar(page).getByRole("link", { name: "Abonnement" })).toHaveAttribute("aria-current", "page");
  });

  test("the profile switcher changes the active Profile everywhere", async ({ page }) => {
    await open(page, "profil");
    const switcher = page.getByRole("button", { name: /Directrice administrative et financière/ }).first();
    await expect(switcher).toHaveAttribute("aria-expanded", "false");
    await switcher.click();
    await expect(switcher).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu", { name: "Choisir un profil" });
    await expect(menu.getByRole("menuitemradio")).toHaveCount(2);
    await expect(menu.getByRole("menuitemradio", { name: /Directrice administrative/ })).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemradio", { name: "Consultante transformation finance" }).click();
    await expect(menu).toBeHidden();
    await expect(page.getByLabel("Nom du profil")).toHaveValue("Consultante transformation finance");
    await expect(page.getByLabel("Lieu")).toHaveValue("Lyon ou télétravail complet");
    await expect(page.getByLabel("Salaire minimum")).toHaveValue("75 000 € brut par an");
    await expect(sidebar(page).getByRole("button", { name: /Consultante transformation finance/ })).toBeVisible();
  });

  test("the switcher is operable from the keyboard and Escape closes it", async ({ page }) => {
    await open(page, "profil");
    const switcher = page.locator("#switcher-button");
    await switcher.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu", { name: "Choisir un profil" })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /Directrice administrative/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: /Consultante/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(switcher).toBeFocused();
  });

  test("the sidebar collapses on a wide screen and the Menu button brings it back", async ({ page }) => {
    await open(page, "candidatures");
    await expect(sidebar(page)).toBeVisible();
    await page.getByRole("button", { name: "Masquer le menu" }).click();
    await expect(sidebar(page)).toBeHidden();
    await expect(page.getByRole("link", { name: "Candidatures" })).toHaveCount(0); // gone for good, not squeezed into an icon rail
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Masquer le menu" })).toBeVisible();
  });

  test("below 64rem the sidebar is a drawer: hidden, opened by Menu, closed by Escape, the scrim or a link", async ({ page }) => {
    await open(page, "candidatures", TABLET);
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    const onScreen = async () => (await sidebar(page).boundingBox())!.x >= -1;
    await expect.poll(onScreen).toBe(false);
    await menu.click();
    await expect.poll(onScreen).toBe(true);
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect.poll(onScreen).toBe(false);
    await expect(menu).toBeFocused();

    await menu.click();
    await expect.poll(onScreen).toBe(true);
    await page.locator("#scrim").click({ position: { x: TABLET.width - 20, y: 300 } });
    await expect.poll(onScreen).toBe(false);

    await menu.click();
    await sidebar(page).getByRole("link", { name: "Job Digests" }).click();
    await expect(page.locator('article[data-view="job-digests"]')).toBeVisible();
    await expect.poll(onScreen).toBe(false);

    await menu.click();
    await page.getByRole("button", { name: "Fermer" }).first().click();
    await expect.poll(onScreen).toBe(false);
  });

  test("at 64rem and above the sidebar is docked beside the page, not a drawer", async ({ page }) => {
    await open(page, "candidatures", LAPTOP);
    const side = (await sidebar(page).boundingBox())!;
    const main = (await page.locator("main").boundingBox())!;
    expect(side.x).toBeGreaterThanOrEqual(0);
    expect(main.x).toBeGreaterThanOrEqual(side.x + side.width - 1);
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden();
  });

  test("every icon is labelled: no control is reachable only through an unlabelled icon", async ({ page }) => {
    for (const view of VIEWS) {
      await open(page, view);
      if (!(await coach(page).isVisible())) await page.locator("#coach-toggle").click();
      const bad = await page.evaluate(() => {
        const visible = (el: Element) => (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true }) && el.getClientRects().length > 0;
        const problems: string[] = [];
        for (const el of document.querySelectorAll("button, a[href], summary, [role=button], [role=menuitem], [role=menuitemradio], [role=tab]")) {
          if (!visible(el)) continue;
          const copy = el.cloneNode(true) as Element;
          copy.querySelectorAll("svg").forEach((svg) => svg.remove());
          const text = copy.textContent ?? "";
          const label = (el.getAttribute("aria-label") ?? "").trim();
          if (text.replace(/\s+/g, "").length === 0 && label === "") problems.push(el.outerHTML.slice(0, 120));
        }
        for (const svg of document.querySelectorAll("svg")) {
          if (!visible(svg)) continue;
          // An icon must be decoration beside text, never the only content of a control.
          if (svg.getAttribute("aria-hidden") !== "true") problems.push(`svg not aria-hidden: ${svg.outerHTML.slice(0, 80)}`);
        }
        return problems;
      });
      expect(bad, view).toEqual([]);
      await expect(page.locator("#coach-toggle")).toHaveAccessibleName(/coach/i);
    }
  });

  test("the Coach Panel is a right-hand panel that docks beside the page on a wide screen and toggles", async ({ page }) => {
    await open(page, "candidature");
    await expect(coach(page)).toBeVisible();
    const main = (await page.locator("main").boundingBox())!;
    const panel = (await coach(page).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
    expect(panel.x + panel.width).toBeLessThanOrEqual(DESKTOP.width + 1);
    expect(panel.x).toBeGreaterThan(DESKTOP.width / 2);

    await coach(page).getByRole("button", { name: "Fermer" }).click();
    await expect(coach(page)).toBeHidden();
    await page.locator("#coach-toggle").click();
    await expect(coach(page)).toBeVisible();
    await expect(page.locator("#coach-message")).toBeFocused();
  });

  test("below 80rem the Coach Panel opens as a sheet over the page, from the right edge", async ({ page }) => {
    await open(page, "candidature", LAPTOP);
    await expect(coach(page)).toBeHidden();
    await page.locator("#coach-toggle").click();
    await expect(coach(page)).toBeVisible();
    const panel = (await coach(page).boundingBox())!;
    expect(Math.round(panel.x + panel.width)).toBe(LAPTOP.width);
    await page.keyboard.press("Escape");
    await expect(coach(page)).toBeHidden();
    await expect(page.locator("#coach-toggle")).toBeFocused();
  });

  test("the Coach Panel knows what the Candidate is looking at and answers a message", async ({ page }) => {
    await open(page, "candidature");
    await expect(page.locator("#in-view")).toContainText("la candidature « Directeur administratif et financier (H/F) »");
    await page.locator("#sidebar").getByRole("link", { name: "Job Digests" }).click();
    await expect(page.locator("#in-view")).toContainText("le profil « Directrice administrative et financière »");
    await page.getByLabel("Votre message").fill("Quelle offre dois-je relancer en premier ?");
    await page.getByRole("button", { name: "Envoyer" }).click();
    const log = page.getByRole("log", { name: "Vos échanges avec votre coach" });
    await expect(log).toContainText("Quelle offre dois-je relancer en premier ?");
    await expect(log).toContainText("Ceci est un prototype", { timeout: 5000 });
    await expect(page.getByLabel("Votre message")).toHaveValue("");
  });
});

test.describe("Job Search results page", () => {
  test("reads as a document: a title, the criteria, then scored Job Offers from best to worst", async ({ page }) => {
    await open(page, "recherche");
    await expect(page.locator("article:visible h1")).toBeVisible();
    await expect(page.locator("article:visible dl").first()).toContainText("Lyon et 50 km");
    const rows = page.getByRole("list", { name: "Offres trouvées" }).getByRole("listitem");
    await expect(rows).toHaveCount(6);
    const scores = await page.locator("[aria-label^='Score de correspondance']").evaluateAll((els) => els.map((e) => Number(/: (\d+) sur/.exec(e.getAttribute("aria-label")!)![1])));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBe(86);
  });

  test("saving a Job Offer turns it into an Application with a link to it", async ({ page }) => {
    await open(page, "recherche");
    const row = page.getByRole("listitem").filter({ hasText: "Responsable administratif et financier" }).first();
    await row.getByRole("button", { name: "Enregistrer en candidature" }).click();
    await expect(row.getByRole("link", { name: "Voir ma candidature" })).toBeVisible({ timeout: 5000 });
    await expect(row.getByText("Enregistrée", { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Enregistrée dans vos candidatures");
  });

  test("the best match already is an Application and links to it", async ({ page }) => {
    await open(page, "recherche");
    await page.getByRole("link", { name: "Voir ma candidature" }).first().click();
    await expect(page.locator('article[data-view="candidature"]')).toBeVisible();
  });
});

test.describe("Application page", () => {
  test("reads as a document with properties edited in place: changing the status updates the Applications list", async ({ page }) => {
    await open(page, "candidature");
    const status = page.getByLabel("Statut");
    await expect(status).toBeVisible();
    await status.selectOption({ label: "Entretien" });
    await expect(page.locator("#interviews-hint")).toContainText("Ajoutez la date et l'heure de votre entretien");
    await expect(page.getByText("Statut enregistré")).toBeVisible();
    await page.locator("#sidebar").getByRole("link", { name: "Candidatures" }).click();
    await expect(statusPill(page)).toHaveText("Entretien");
  });

  test("the follow-up Action Card marks the follow-up as sent and moves the Application to Relancée", async ({ page }) => {
    await open(page, "candidature");
    const card = page.getByRole("region", { name: /Relancer l'employeur/ });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Marquer comme envoyée" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByLabel("Statut")).toHaveValue("followed_up");
    await expect(page.getByRole("status")).toContainText("La candidature passe à « Relancée »");
    await expect(page.locator("article:visible h1")).toBeFocused();
  });

  test("a follow-up proposal can be ignored", async ({ page }) => {
    await open(page, "candidature");
    await page.getByRole("button", { name: "Ignorer" }).click();
    await expect(page.getByRole("region", { name: /Relancer l'employeur/ })).toHaveCount(0);
    await expect(page.getByLabel("Statut")).not.toHaveValue("followed_up");
  });

  test("tailored documents are tabs: arrow keys move between them, and an edited letter is saved explicitly", async ({ page }) => {
    await open(page, "candidature");
    const cv = page.getByRole("tab", { name: "CV adapté" });
    await expect(cv).toHaveAttribute("aria-selected", "true");
    await cv.focus();
    await page.keyboard.press("ArrowRight");
    const letterTab = page.getByRole("tab", { name: "Lettre de motivation" });
    await expect(letterTab).toHaveAttribute("aria-selected", "true");
    await expect(letterTab).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "Lettre de motivation" })).toBeVisible();

    const letter = page.locator("#letter-body");
    const original = await letter.inputValue();
    const save = page.getByRole("button", { name: "Enregistrer la lettre" });
    await expect(save).toBeHidden();
    await letter.fill(original + "\nJe reste disponible cette semaine.");
    await expect(save).toBeVisible();
    await save.click();
    await expect(save).toBeHidden();
    await expect(page.getByRole("status")).toContainText("Lettre enregistrée");
    await letter.fill(original + "\nAutre phrase.");
    await page.getByRole("button", { name: "Annuler les modifications" }).click();
    await expect(letter).toHaveValue(original + "\nJe reste disponible cette semaine.");
  });

  test("shows the match with the offer and the interviews section", async ({ page }) => {
    await open(page, "candidature");
    await page.getByRole("link", { name: "Voir le détail" }).click();
    await expect(page.getByRole("heading", { name: "Correspondance avec l'offre" })).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Entretiens" })).toBeVisible();
  });
});

test.describe("Profile page", () => {
  test("search criteria are edited in place and saved as soon as they change", async ({ page }) => {
    await open(page, "profil");
    const role = page.getByLabel("Poste visé");
    await role.fill("Directeur financier");
    await role.press("Enter");
    await expect(page.getByText("Critères enregistrés").first()).toBeVisible();
    await expect(role).toHaveValue("Directeur financier");
    await page.getByLabel("Contrat").selectOption("Mission de transition");
    await expect(page.getByLabel("Contrat")).toHaveValue("Mission de transition");
  });

  test("Escape abandons an in-place edit and an emptied field keeps its previous value", async ({ page }) => {
    await open(page, "profil");
    const place = page.getByLabel("Lieu");
    await place.fill("Paris");
    await place.press("Escape");
    await expect(place).toHaveValue("Lyon et 50 km autour");
    await place.fill("");
    await place.press("Enter");
    await expect(place).toHaveValue("Lyon et 50 km autour");
  });

  test("master CV edits pile up into one new version that is saved explicitly, or cancelled", async ({ page }) => {
    await open(page, "profil");
    const savebar = page.getByRole("region", { name: "Modifications du CV de référence" });
    await expect(savebar).toBeHidden();
    await expect(page.locator("#cv-version")).toHaveText("7");
    const headline = page.locator("#cv-headline");
    await headline.fill("DAF, ETI industrielle");
    await page.locator("#cv-skills").fill("Consolidation IFRS\nTagetik");
    await expect(savebar).toBeVisible();
    await expect(savebar.getByRole("button", { name: "Enregistrer la version 8" })).toBeVisible();
    await savebar.getByRole("button", { name: "Annuler" }).click();
    await expect(headline).toHaveValue("Directrice administrative et financière");
    await expect(savebar).toBeHidden();
    await expect(page.locator("#cv-version")).toHaveText("7");

    await headline.fill("DAF, ETI industrielle");
    await savebar.getByRole("button", { name: "Enregistrer la version 8" }).click();
    await expect(page.locator("#cv-version")).toHaveText("8");
    await expect(page.locator("#cv-date")).toHaveText("aujourd'hui");
    await expect(savebar).toBeHidden();
    await expect(page.getByRole("status")).toContainText("Version 8 de votre CV de référence enregistrée");
  });

  test("accepting an ATS Fix applies one change, saves a version and lowers the number of proposals", async ({ page }) => {
    await open(page, "profil");
    await expect(page.locator("#fix-count")).toHaveText("3");
    await expect(page.locator("#ats-score")).toHaveText("74");
    await page.locator('[data-accept-fix="keyword"]').click();
    await expect(page.locator("#cv-skills")).toHaveValue(/Tagetik$/);
    await expect(page.locator("#cv-version")).toHaveText("8");
    await expect(page.locator("#fix-count")).toHaveText("2");
    await expect(page.locator("#ats-score")).toHaveText("78");
  });

  test("an ATS Fix cannot be accepted over unsaved CV edits", async ({ page }) => {
    await open(page, "profil");
    await page.locator("#cv-headline").fill("Autre titre");
    await page.locator('[data-accept-fix="years"]').click();
    await expect(page.getByRole("status")).toContainText("Enregistrez ou annulez d'abord vos modifications du CV");
    await expect(page.locator("#cv-version")).toHaveText("7");
    await expect(page.locator("#fix-count")).toHaveText("3");
  });

  test("links to the Job Search and the Job Digest", async ({ page }) => {
    await open(page, "profil");
    await page.getByRole("link", { name: "Job Digest : chaque lundi" }).click();
    await expect(page.locator('article[data-view="job-digests"]')).toBeVisible();
  });
});

test.describe("other pages", () => {
  test("Job Digests, Mon compte and Abonnement edit their settings in place", async ({ page }) => {
    await open(page, "job-digests");
    await page.getByLabel("Envoi").selectOption("Chaque jour à 7 h");
    await expect(page.getByText("Fréquence enregistrée")).toBeVisible();
    await sidebar(page).getByRole("link", { name: "Mon compte" }).click();
    await page.getByLabel("Langue de l'interface").selectOption("English");
    await expect(page.getByText("Langue enregistrée")).toBeVisible();
    await sidebar(page).getByRole("link", { name: "Abonnement" }).click();
    await expect(page.getByRole("button", { name: "Changer d'offre" })).toBeVisible();
  });

  test("actions outside the prototype say so instead of doing nothing", async ({ page }) => {
    await open(page, "compte");
    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    await expect(page.getByRole("status")).toContainText("hors prototype");
  });
});

test.describe("design tokens, system font stack and French sample data", () => {
  test("the page's custom properties are the design tokens", async ({ page }) => {
    await open(page, "candidature");
    const vars = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const get = (name: string) => cs.getPropertyValue(name).trim();
      return {
        background: get("--color-background"), surface: get("--color-surface"), border: get("--color-border"), text: get("--color-text"),
        textSecondary: get("--color-text-secondary"), accent: get("--color-accent"), danger: get("--color-danger"), success: get("--color-success"),
      };
    });
    const c = designTokens.color;
    expect(vars).toEqual({ background: c.background, surface: c.surface, border: c.border, text: c.text, textSecondary: c.textSecondary, accent: c.accent, danger: c.danger, success: c.success });
  });

  test("text uses the system font stack from the tokens, with no web font or external resource", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (request) => { if (!request.url().startsWith(origin)) external.push(request.url()); });
    await open(page, "candidature");
    // Chrome re-serialises the stack (BlinkMacSystemFont becomes "system-ui"), so compare the font names.
    const systemFonts = ["ui-sans-serif", "-apple-system", "system-ui", "BlinkMacSystemFont", "Segoe UI", "Helvetica", "Arial", "sans-serif"];
    expect(designTokens.fontFamily.sans).toContain("ui-sans-serif");
    for (const selector of ["body", "h1", "main p", ".nav-link", "button", "textarea"]) {
      const family = await page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
      const names = family.split(",").map((name) => name.trim().replace(/^"|"$/g, ""));
      expect(names[0], selector).toBe("ui-sans-serif");
      expect(names.at(-1), selector).toBe("sans-serif");
      expect(names.filter((name) => !systemFonts.includes(name)), selector).toEqual([]);
    }
    expect(await page.evaluate(() => document.fonts.size)).toBe(0);
    expect(external).toEqual([]);
  });

  test("the sample data is realistic French content", async ({ page }) => {
    const seen = new Set<string>();
    for (const view of VIEWS) {
      await open(page, view);
      seen.add(await page.locator(`article[data-view="${view}"]`).innerText());
    }
    const text = [...seen].join("\n");
    for (const expected of ["Groupe Ferlac", "Lyon", "85 000 € brut", "Directeur administratif et financier", "Cléance Santé", "CDI", "vendredi 16 octobre"]) expect(text).toContain(expected);
    expect(text).not.toMatch(/lorem ipsum|john doe|foo bar|\bTODO\b|example\.com/i);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });
});

test.describe("ADR-0009 accessibility floor", () => {
  /** Every visible piece of text with its computed size, colour, effective background and contrast. */
  async function measureText(page: Page) {
    return page.evaluate(() => {
      const parse = (value: string) => {
        const m = /rgba?\(([^)]+)\)/.exec(value)!;
        const [r, g, b, a] = m[1]!.split(/[ ,/]+/).map(Number);
        return { r: r!, g: g!, b: b!, a: a ?? 1 };
      };
      const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const backgroundOf = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const bg = parse(getComputedStyle(node).backgroundColor);
          if (bg.a > 0.99) return bg;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };
      const out: { tag: string; text: string; px: number; color: string; bg: string; ratio: number; disabled: boolean }[] = [];
      const seen = new Set<Element>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const fields = [...document.querySelectorAll("input, textarea, select")];
      const measured = (el: Element, text: string) => {
        if (seen.has(el)) return;
        seen.add(el);
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        const bg = backgroundOf(el);
        const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
        out.push({
          tag: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""),
          text: text.trim().slice(0, 40), px: parseFloat(cs.fontSize), color: cs.color, bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
          ratio: (hi + 0.05) / (lo + 0.05), disabled: (el as HTMLButtonElement).disabled === true,
        });
      };
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement!;
        if (!n.textContent!.trim() || el.closest("svg, style, script, .vh") || !el.checkVisibility({ checkVisibilityCSS: true })) continue;
        measured(el, n.textContent!);
      }
      for (const f of fields) if ((f as HTMLElement).checkVisibility({ checkVisibilityCSS: true }) && !f.closest(".vh")) measured(f, (f as HTMLInputElement).value ?? "");
      return out;
    });
  }

  test("every visible text is at least 16px on every page, at the standard text size", async ({ page }) => {
    for (const view of VIEWS) {
      await open(page, view);
      const small = (await measureText(page)).filter((t) => t.px < 16);
      expect(small, `${view}: text under 16px`).toEqual([]);
    }
  });

  test("every visible text reaches AA contrast (4.5:1) on every page", async ({ page }) => {
    for (const view of VIEWS) {
      await open(page, view);
      const weak = (await measureText(page)).filter((t) => !t.disabled && t.ratio < 4.5);
      expect(weak, `${view}: text under 4.5:1`).toEqual([]);
    }
  });

  test("body text is never light grey: it uses the text colours of the tokens only", async ({ page }) => {
    const allowed = new Set(
      [designTokens.color.text, designTokens.color.textSecondary, designTokens.color.accent, designTokens.color.danger, designTokens.color.success, designTokens.color.onAccent].map((hex) => {
        const n = parseInt(hex.slice(1), 16);
        return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
      }),
    );
    for (const view of VIEWS) {
      await open(page, view);
      const stray = (await measureText(page)).filter((t) => !allowed.has(t.color));
      expect(stray, `${view}: text in a non-token colour`).toEqual([]);
    }
    await open(page, "candidature");
    const paragraph = await page.locator("main p").first().evaluate((el) => getComputedStyle(el).color);
    expect(paragraph).toBe("rgb(55, 53, 47)");
  });

  test("the Candidate can change the text size: it scales every size, is remembered and survives a reload", async ({ page }) => {
    await open(page, "candidature");
    const sizeOf = () => page.evaluate(() => ({ body: parseFloat(getComputedStyle(document.body).fontSize), h1: parseFloat(getComputedStyle(document.querySelector("article:not([hidden]) h1")!).fontSize) }));
    const standard = await sizeOf();
    expect(standard.body).toBe(designTokens.fontSize.body * designTokens.textSize.standard);
    // Each setting scales every size from the same base: the sizes at a factor of 1.
    const base = { body: standard.body / designTokens.textSize.standard, h1: standard.h1 / designTokens.textSize.standard };
    const group = sidebar(page).getByRole("group", { name: "Taille du texte" });
    await expect(group.getByRole("button", { name: "Standard" })).toHaveAttribute("aria-pressed", "true");

    await group.getByRole("button", { name: "Grande", exact: true }).click();
    await expect(group.getByRole("button", { name: "Grande", exact: true })).toHaveAttribute("aria-pressed", "true");
    const large = await sizeOf();
    expect(large.body).toBeCloseTo(base.body * designTokens.textSize.large, 1);
    expect(large.h1).toBeCloseTo(base.h1 * designTokens.textSize.large, 1);

    await group.getByRole("button", { name: "Très grande" }).click();
    expect((await sizeOf()).body).toBeCloseTo(base.body * designTokens.textSize.xlarge, 1);
    expect(await page.evaluate((key) => localStorage.getItem(key), TEXT_SIZE_STORAGE_KEY)).toBe("xlarge");

    await page.reload();
    await expect(sidebar(page).getByRole("button", { name: "Très grande" })).toHaveAttribute("aria-pressed", "true");
    expect((await sizeOf()).body).toBeCloseTo(base.body * designTokens.textSize.xlarge, 1);
  });

  test("text stays above 16px and contrasted at the largest text size", async ({ page }) => {
    await open(page, "candidature");
    await sidebar(page).getByRole("button", { name: "Très grande" }).click();
    for (const view of VIEWS) {
      await page.goto(`${origin}/#${view}`);
      await expect(page.locator(`article[data-view="${view}"]`)).toBeVisible();
      const texts = await measureText(page);
      expect(texts.filter((t) => t.px < 16), view).toEqual([]);
      expect(texts.filter((t) => !t.disabled && t.ratio < 4.5), view).toEqual([]);
    }
  });

  test("controls are at least 44px tall and keyboard focus is visible", async ({ page }) => {
    await open(page, "candidature");
    const short = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main .btn, .nav-link, .tab, select.inline-edit, #coach-toggle")]
        .filter((el) => el.checkVisibility({ checkVisibilityCSS: true }))
        .map((el) => ({ text: el.textContent!.trim().slice(0, 30), h: el.getBoundingClientRect().height }))
        .filter((c) => c.h < 43.5),
    );
    expect(short).toEqual([]);
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), shadow: cs.boxShadow }; });
    expect(outline.style !== "none" && outline.width >= 2 || outline.shadow !== "none").toBe(true);
    await expect(page.getByRole("link", { name: "Aller au contenu" })).toBeInViewport();
  });
});

test.describe("decisions to approve", () => {
  test("the notes page records the layout, type scale, spacing and components needed", async ({ page }) => {
    await open(page, "notes");
    for (const heading of ["Mise en page", "Échelle typographique", "Espacement", "Modification sur place", "Composants nécessaires"]) {
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    await expect(page.locator("section:has(#n-type)")).toContainText("16px");
    await expect(page.locator("section:has(#n-components)")).toContainText("Radix (ADR-0018)");
  });
});

// The sample data and decisions must never leak into product code: the prototype is throwaway.
test("the prototype stays in docs/ and is not wired into the apps", () => {
  const reference = (file: string) => readFileSync(file, "utf8").includes("notion-layout");
  expect(reference("apps/web/package.json")).toBe(false);
  expect(reference("package.json")).toBe(false);
});

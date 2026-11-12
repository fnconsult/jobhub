import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

/** A page's conversation with the AI Coach (ADR-0070): the page itself, its main region. */
export const conversationOf = (page: Page, label: string = fr.conversationFirst.label) => page.getByRole("region", { name: label });

/**
 * Where the Coach Panel once opened (#608): the page's own conversation, or, on a page that is none (Mon compte, where
 * signing in lands), the home page's new Free conversation.
 */
export async function toConversation(page: Page, label: string = fr.conversationFirst.label): Promise<void> {
  await page.waitForLoadState();
  if ((await conversationOf(page, label).count()) === 0) await page.goto("/");
  await expect(conversationOf(page, label)).toBeVisible();
}

/** The docked Sidebar (wide screens); on a phone it is a drawer the Menu button opens. */
const sidebarOf = (page: Page) => page.locator(".sidebar-docked");

/** « Nouvelle conversation » at the top of the Sidebar: the home page's new Free conversation (#601). */
export async function startNewConversation(page: Page): Promise<void> {
  await sidebarOf(page).getByRole("link", { name: fr.conversationFirst.newConversation }).click();
  await expect(conversationOf(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).locator("> li")).toHaveCount(1);
}

/** « Mémoire du coach » under « Coach » in the Sidebar: the Coach Memory in the Work Pane (#602), which it returns. */
export async function openCoachMemory(page: Page) {
  await sidebarOf(page).getByRole("button", { name: fr.coachMemory.open }).click();
  return page.getByRole("complementary", { name: fr.coachMemory.title });
}

/** A saved Free conversation, under « Coach » in the Sidebar (#601). */
export async function openFreeConversation(page: Page, title: string | RegExp): Promise<void> {
  await sidebarOf(page).getByRole("link", { name: title }).click();
  await expect(conversationOf(page)).toBeVisible();
}

/**
 * AI Activity's button, « Activité » in the Top Bar of the Candidate's pages (#603, #607, #809): named « Activité IA », then its
 * words (the page's summary, or the step under way) while Activity is not shown.
 */
export const activityButtonOf = (page: Page) => page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) });

/**
 * Where a page's AI Activity shows (#980, ADR-0070): the side panel on its « Activité » view, beside the conversation (over
 * it on a phone). Its Context bar comes first, then the actions under way and the history.
 */
export const activityOf = (page: Page) => page.getByRole("complementary", { name: fr.fiche.views.activity, exact: true });

/**
 * Shows the side panel on « Activité » with AI Activity's icon (#809, #980), which `activityOf` returns; left as it is when
 * shown. The panel may also open by itself (the onboarding's search starting, ADR-0106): if it did so just before the
 * click, the click closed it, so the click is tried again until the panel stays open.
 */
export async function openActivity(page: Page) {
  const button = activityButtonOf(page);
  await expect(async () => {
    if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return activityOf(page);
}

/** « … » in the compact Top Bar of a phone (#897): the page's other actions, in words, in its menu. */
export const topBarMoreOf = (page: Page) => page.getByRole("banner").getByRole("button", { name: fr.sidebar.moreActions, exact: true });

/** On a phone, picks `name` (« Activité », « Effacer la conversation », « Aide »…) under the compact Top Bar's « … » (#897). */
export async function chooseInTopBarMore(page: Page, name: string): Promise<void> {
  await topBarMoreOf(page).click();
  await page.getByRole("menu").getByRole("menuitem", { name, exact: true }).click();
}

/** « Activité »'s glyph, live while an AI action of the page is under way (#603): what the closed button says of it. */
export const activityUnderWayOf = (page: Page) => activityButtonOf(page).locator(".activity-glyph[data-live]");

/** Hides the page's AI Activity again: AI Activity's icon closes the side panel on « Activité ». */
export async function closeActivity(page: Page) {
  const button = activityButtonOf(page);
  if ((await button.getAttribute("aria-expanded")) === "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
}

/** An object's Fiche (#603, #605, #980): the side panel on its « Fiche » view, open on a wide screen as the page loads. */
export const ficheOf = (page: Page) => page.getByRole("complementary", { name: fr.fiche.label, exact: true });

/** A side panel view's icon in the Top Bar (#980): « Fiche », « L'offre », « Documents » or « Offres trouvées ». */
export const panelIconOf = (page: Page, view: string) => page.getByRole("banner").getByRole("button", { name: view, exact: true });

/**
 * Shows the side panel on a view (#980) with its icon in the Top Bar, or on a phone under « … », and returns it; left as it is
 * when shown.
 */
export async function openPanelView(page: Page, view: string) {
  const shown = page.getByRole("complementary", { name: view, exact: true });
  if (await shown.isVisible()) return shown;
  const icon = panelIconOf(page, view);
  if (await icon.isVisible()) await icon.click();
  else await chooseInTopBarMore(page, view);
  await expect(shown).toBeVisible();
  return shown;
}

/** The object's Results (#980): the side panel's « Documents » view, or « Offres trouvées » for a Job Search or a Job Digest. */
export const openResults = (page: Page, view: string = fr.fiche.views.documents) => openPanelView(page, view);

/** Shows the Fiche (#980), which another view may have taken the place of. */
export const openFiche = (page: Page) => openPanelView(page, fr.fiche.label);

/** The Work Pane, named by the title of what it shows (#602, ADR-0070). */
export const workPaneOf = (page: Page, title: string | RegExp) => page.getByRole("complementary", { name: title });

/** « Modifier les critères » on a Profile's Fiche (#605): what opens its Search Criteria. */
export const editCriteriaOf = (page: Page) => ficheOf(page).getByRole("button", { name: fr.jobSearch.editCriteria, exact: true });

/**
 * A Profile's Search Criteria, each edited in place and saved on change (#137, ADR-0025), in the dialog « Modifier les
 * critères » opens from its Fiche's card (#605: the Fiche is too narrow for them as properties). Opens it, and the Fiche
 * first when it is closed, and returns them; a reload closes it.
 */
export async function openSearchCriteria(page: Page) {
  // On a phone the Fiche starts closed: its icon in the Top Bar, or « … », opens it, over the conversation (#608, #980).
  await openFiche(page);
  await editCriteriaOf(page).click();
  const criteria = page.getByRole("dialog").getByRole("group", { name: fr.cvReview.searchCriteria });
  await expect(criteria).toBeVisible();
  return criteria;
}

/** One of a Profile's Sections, from its Fiche (ADR-0024, #605): it opens in the Work Pane. */
export const profileSectionLink = (page: Page, name: string) => ficheOf(page).getByRole("link", { name, exact: true });

/** « Lancer une recherche », Recherches d'offres' suggestion above its box (#606): for `profileName` when the Candidate has several active Profiles. */
export const startJobSearchButton = (page: Page, profileName?: string) =>
  page
    .getByRole("navigation", { name: fr.quickActions.label })
    .getByRole("button", { name: profileName ? fr.jobSearchesMenu.startFor.replace("{{profile}}", profileName) : fr.jobSearchesMenu.start, exact: true });

/** Starts a Job Search from Recherches d'offres (#606), for `profileName` when the Candidate has several, and returns its id once on its page. */
export async function startJobSearch(page: Page, profileName?: string): Promise<string> {
  await page.goto("/recherches");
  await startJobSearchButton(page, profileName).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** A Job Search's Job Offers, its Section, opened from its Fiche in the Work Pane (#605): their titles are h3 there. */
export async function openFoundJobOffers(page: Page) {
  await ficheOf(page).getByRole("link", { name: fr.jobSearch.resultsLabel, exact: true }).click();
  await expect(page).toHaveURL(/\/recherches\/[0-9a-f-]+\/offres$/);
}

/**
 * An entry of Activity's history (#808, ADR-0086) whose title says `label`: one row each, a button that unfolds its
 * detail (its steps, models, cost and links).
 */
export const historyEntryOf = (page: Page, label: string | RegExp) =>
  activityOf(page).locator(".activity-entry").filter({ has: page.locator(".activity-entry-title").filter({ hasText: label }) });

/** That entry, its detail unfolded: there is one, and its row says it is open. */
export async function unfoldedEntryOf(page: Page, label: string | RegExp) {
  const entry = historyEntryOf(page, label).first();
  await expect(entry).toBeVisible();
  const row = entry.locator(".activity-entry-row");
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  return entry;
}

/**
 * The Provenance sites the page's entries name (#980): « Sources et outils de cette page » is gone, each entry names its own
 * under « Sources : » in its detail. Unfolds every entry, and returns their « Sources » lines.
 */
export async function pageSourcesOf(page: Page) {
  const rows = activityOf(page).locator(".activity-entry-row");
  for (const row of await rows.all()) if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  return activityOf(page).locator(".activity-entry-sites");
}

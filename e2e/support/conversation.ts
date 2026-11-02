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

import type { Locator } from "@playwright/test";

/**
 * Chooses `item` in a Coach Panel's one menu (ADR-0024): the conversation's title,
 * the panel's first button. The menu opens outside the panel, in the page.
 */
export async function chooseInPanelMenu(panel: Locator, item: string): Promise<void> {
  await panel.getByRole("button").first().click();
  await panel.page().getByRole("menuitem", { name: item }).click();
}

/** The items of a Coach Panel's menu, opened; Escape closes it again. */
export async function panelMenuItems(panel: Locator): Promise<Locator> {
  await panel.getByRole("button").first().click();
  return panel.page().getByRole("menu").getByRole("menuitem");
}

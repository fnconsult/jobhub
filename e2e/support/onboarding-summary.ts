import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

// The summary at the end of creating a Profile (#1004): « Ai-je bien compris ? », its card « Votre recherche d'offres ».
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

/** The card « Votre recherche d'offres » in the thread of /profils/nouveau. */
export const onboardingSummary = (page: Page) => page.getByRole("region", { name: fr.onboardingSummary.title, exact: true });

/** « Voir le détail »: the review form, opened in the Work Pane. */
export async function openReviewDetail(page: Page): Promise<void> {
  await onboardingSummary(page).getByRole("button", { name: fr.onboardingSummary.detail, exact: true }).click();
}

/** « Cela semble correct », then « Continuer vers mon profil » once the coach says it is saved: the Profile's page. */
export async function confirmSummary(page: Page): Promise<void> {
  await onboardingSummary(page).getByRole("button", { name: fr.onboardingSummary.confirm, exact: true }).click();
  await page.getByRole("link", { name: fr.onboardingSummary.toProfile, exact: true }).click();
}

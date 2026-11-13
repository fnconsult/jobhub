import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

// The summary at the end of creating a Profile (#1004): « Ai-je bien compris ? », its card « Votre recherche d'offres ».
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

/** The card « Votre recherche d'offres » in the thread of /profils/nouveau. */
export const onboardingSummary = (page: Page) => page.getByRole("region", { name: fr.onboardingSummary.title, exact: true });

/**
 * From a CV (#1003): once the CV is read, confirms the target role and the place
 * the CV read (« Oui, … »), then skips what a CV does not say (contracts, remote work, minimum salary), up to the summary.
 */
export async function throughCvInterview(page: Page): Promise<void> {
  const thread = page.getByRole("list", { name: fr.questionnaire.transcript });
  const suggestions = page.getByRole("group", { name: fr.conversationFirst.suggestions });
  const yes = suggestions.getByRole("button", { name: /^Oui, / }).first();
  const skip = suggestions.getByRole("button", { name: fr.questionnaire.skip, exact: true });
  const replies = thread.locator("li.chat-candidate");
  await expect(thread.getByText(fr.newProfile.fromCv.questionsStart)).toBeVisible({ timeout: 15_000 });
  for (let turn = 0; turn < 10; turn++) {
    await expect(onboardingSummary(page).or(turn < 2 ? yes : skip)).toBeVisible({ timeout: 15_000 });
    if (await onboardingSummary(page).isVisible()) return;
    const before = await replies.count();
    await (turn < 2 ? yes : skip).click();
    await expect(replies).toHaveCount(before + 1);
  }
  await expect(onboardingSummary(page)).toBeVisible();
}

/** « Voir le détail »: the review form, opened in the Work Pane. */
export async function openReviewDetail(page: Page): Promise<void> {
  await onboardingSummary(page).getByRole("button", { name: fr.onboardingSummary.detail, exact: true }).click();
}

/** « Cela semble correct », then « Continuer vers mon profil » once the coach says it is saved: the Profile's page. */
export async function confirmSummary(page: Page): Promise<void> {
  await onboardingSummary(page).getByRole("button", { name: fr.onboardingSummary.confirm, exact: true }).click();
  await page.getByRole("link", { name: fr.onboardingSummary.toProfile, exact: true }).click();
}

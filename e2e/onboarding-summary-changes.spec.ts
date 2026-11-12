import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { openActivity, unfoldedEntryOf } from "./support/conversation";
import { onboardingSummary } from "./support/onboarding-summary";

// Issue #1005 (ADR-0105, ADR-0077): « Modifier » on the onboarding's summary lets the Candidate rewrite it in their own
// words; the AI translates the rewriting into Search Criteria changes, shown for validation (« J'ai compris : + CDD,
// − Lyon, + Paris (75) ») and made once validated; the summary is composed again and asked again. « Annuler » changes
// nothing; an answer the AI could not give says so and leaves the summary as it was. The AI is faked inside the server
// (fake-mistral.mjs): it reads the rewriting by rules; "E2E_SUMMARY_GARBLED" gets prose, "E2E_AI_DOWN" a 503. Places
// come from the fake geo API (fake-geo-api.mjs): « Paris » is suggested as « Paris (75) ».
const expect = baseExpect.configure({ timeout: 15_000 });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.onboardingSummary;
const q = fr.questionnaire.questions;
const transcript = (page: Page) => page.getByRole("list", { name: fr.questionnaire.transcript });

/** Answers the Onboarding Questionnaire's `question`, once it is asked: in the box, or « Passer ». */
async function reply(page: Page, question: string, value: string | "skip") {
  await expect(transcript(page).getByRole("listitem").last()).toContainText(question);
  if (value === "skip") await page.getByRole("button", { name: fr.questionnaire.skip }).click();
  else {
    await page.getByLabel(fr.questionnaire.answerLabel).fill(value);
    await page.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
  }
}

/** Up to the summary by the questionnaire: a Directrice financière in Lyon, every other question skipped. */
async function toSummary(page: Page, who: string) {
  await signInWithMagicLink(page, newAddress(who));
  await page.goto("/profils/nouveau");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();
  await reply(page, q.fullName, "Marie Dupont");
  await reply(page, q.targetRole, "Directrice financière");
  await reply(page, q.location, "Lyon");
  for (const question of [q.email, q.phone, q.jobTitle.replace("{{number}}", "1"), q.degree.replace("{{number}}", "1"), q.skills, q.languages, q.summary]) await reply(page, question, "skip");
  await expect(summaryText(page)).toHaveText("Vous recherchez un poste de Directrice financière à Lyon.");
}

const summaryText = (page: Page) => onboardingSummary(page).locator(".onb-summary");
const textBox = (page: Page) => onboardingSummary(page).getByRole("textbox", { name: texts.editLabel });

/** « Modifier », the text rewritten, « Terminé ». */
async function rewrite(page: Page, text: string) {
  await onboardingSummary(page).getByRole("button", { name: texts.edit, exact: true }).click();
  await textBox(page).fill(text);
  await onboardingSummary(page).getByRole("button", { name: texts.done, exact: true }).click();
}

test.describe("« Modifier » on the onboarding summary (#1005)", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("a contract type added and a place changed: two changes shown, made once validated, the summary composed again and saved", async ({ page }) => {
    test.setTimeout(120_000);
    await toSummary(page, "summary-changes");

    // « Modification »: the summary as plain text, to write as to a recruiter.
    await onboardingSummary(page).getByRole("button", { name: texts.edit, exact: true }).click();
    await expect(onboardingSummary(page).getByText(texts.editing, { exact: true })).toBeVisible();
    await expect(onboardingSummary(page).getByText(texts.editHint)).toBeVisible();
    await expect(textBox(page)).toHaveValue("Vous recherchez un poste de Directrice financière à Lyon.");
    await expect(textBox(page)).toBeFocused();
    // « Annuler »: nothing changes.
    await textBox(page).fill("Je cherche en CDD à Paris.");
    await onboardingSummary(page).getByRole("button", { name: texts.cancel, exact: true }).click();
    await expect(summaryText(page)).toHaveText("Vous recherchez un poste de Directrice financière à Lyon.");

    await rewrite(page, "Je cherche un poste de Directrice financière en CDD, à Paris plutôt qu'à Lyon.");
    await expect(onboardingSummary(page)).toContainText("J'ai compris : + CDD, − Lyon, + Paris (75)");
    // Nothing changed until validated.
    await expect(summaryText(page)).toHaveText("Vous recherchez un poste de Directrice financière à Lyon.");
    await onboardingSummary(page).getByRole("button", { name: texts.validate }).click();
    await expect(summaryText(page)).toHaveText("Vous recherchez un poste de Directrice financière en CDD à Paris (75).");
    await expect(onboardingSummary(page)).toContainText(texts.notices.applied);

    // « Création du profil » shows the step, with its model and tokens.
    await openActivity(page);
    const creation = await unfoldedEntryOf(page, new RegExp(`^${fr.aiActivity.kinds.profile_creation}$`));
    const step = creation.getByRole("list", { name: fr.aiActivity.history.parts }).locator('> li[data-kind="summary_changes"]');
    await expect(step).toContainText(fr.aiActivity.kinds.summary_changes);
    await expect(step).toContainText(/jetons/);
    await expect(step).toContainText(/Mistral/);

    // « Cela semble correct » saves the criteria changed.
    await onboardingSummary(page).getByRole("button", { name: texts.confirm, exact: true }).click();
    await page.getByRole("link", { name: texts.toProfile, exact: true }).click();
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").at(-1)!;
    const profile = await (await page.request.get(`/api/profiles/${id}`)).json();
    expect(profile.searchCriteria).toMatchObject({ targetRole: "Directrice financière", locations: ["Paris (75)"], contractTypes: ["cdd"] });
  });

  test("an answer the AI could not give says so and leaves the summary; what is not a Search Criterion goes to « Voir le détail »", async ({ page }) => {
    test.setTimeout(120_000);
    await toSummary(page, "summary-changes-unusable");

    await rewrite(page, "Je cherche autre chose. E2E_SUMMARY_GARBLED");
    await expect(onboardingSummary(page)).toContainText(texts.notices.unusable);
    await expect(summaryText(page)).toHaveText("Vous recherchez un poste de Directrice financière à Lyon.");

    await rewrite(page, "Je cherche en CDD à Paris. E2E_AI_DOWN");
    await expect(onboardingSummary(page)).toContainText(texts.notices.unusable);
    await expect(summaryText(page)).toHaveText("Vous recherchez un poste de Directrice financière à Lyon.");

    await rewrite(page, "Vous recherchez un poste de Directrice financière à Lyon. Je maîtrise SAP.");
    await expect(onboardingSummary(page)).toContainText(texts.notices.other);
    await expect(summaryText(page)).toHaveText("Vous recherchez un poste de Directrice financière à Lyon.");
  });
});

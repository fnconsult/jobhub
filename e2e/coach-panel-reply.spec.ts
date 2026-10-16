import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #164: how the Coach Panel shows an AI Coach reply. Driven in the browser
// through the Coach Panel; the AI Coach is faked inside the server (fake-mistral.mjs),
// which writes Markdown and says "tu" unless its instructions tell it to say "vous".
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

const coachPanel = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });

async function openCoachAndAsk(page: Page, text: string) {
  await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
  await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await coachPanel(page).getByRole("button", { name: fr.coachPanel.send }).click();
}

test.describe("Coach Panel replies", () => {
  test("a Markdown answer shows no raw Markdown, and the Coach says vous", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-markdown"));
    await openCoachAndAsk(page, "E2E_COACH_MARKDOWN Quel est le poste que je vise ?");

    const answer = coachPanel(page).getByRole("listitem").filter({ hasText: "Directrice des opérations" });
    await expect(answer).toBeVisible();
    // Bold and italic are set, not spelled out; lists are lists.
    await expect(answer.locator("strong", { hasText: "Directrice des opérations" })).toBeVisible();
    await expect(answer.locator("em", { hasText: "Consolidation" })).toBeVisible();
    await expect(answer.getByRole("listitem")).toHaveCount(2);
    const shown = (await answer.innerText()) ?? "";
    expect(shown).not.toContain("**");
    expect(shown).not.toMatch(/(^|\s)\*\S/);
    expect(shown).not.toMatch(/^\s*- /m);

    // "Vous" throughout: the same as the app and the Coach's greeting.
    await expect(coachPanel(page).getByText(fr.coachPanel.welcome)).toContainText("vous");
    expect(shown).toContain("Vous visez");
    expect(shown).toContain("Vos compétences");
    expect(shown).not.toMatch(/\b(tu|ton|ta|tes)\b/i);
  });

  test("the panel scrolls to the latest answer", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await signInWithMagicLink(page, newAddress("coach-scroll"));
    await openCoachAndAsk(page, "E2E_COACH_LONG Dites-moi tout.");

    await expect(coachPanel(page).getByText("FIN DE LA RÉPONSE")).toBeInViewport();
    // The list itself was scrolled, the start of the answer is above the fold.
    await expect(coachPanel(page).getByText("Paragraphe 1 :")).not.toBeInViewport();

    // A second answer arrives: still at the latest message.
    await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).fill("E2E_COACH_LONG Encore.");
    await coachPanel(page).getByRole("button", { name: fr.coachPanel.send }).click();
    await expect(coachPanel(page).getByText("FIN DE LA RÉPONSE")).toHaveCount(2);
    await expect(coachPanel(page).getByText("FIN DE LA RÉPONSE").last()).toBeInViewport();
  });
});

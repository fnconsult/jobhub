import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #164: how a conversation shows an AI Coach reply. Driven in the browser through the home page's conversation
// (ADR-0070, #608: the Coach Panel left the Candidate's pages); the AI Coach is faked inside the server (fake-mistral.mjs),
// which writes Markdown and says "tu" unless its instructions tell it to say "vous".
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));

const coachPanel = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });

async function openCoachAndAsk(page: Page, text: string) {
  // Signed in on Mon compte, which is no conversation: the home page is a new one.
  await page.goto("/");
  await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await coachPanel(page).getByRole("button", { name: fr.coachPanel.send }).click();
}

test.describe("a conversation's replies", () => {
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

    // "Vous" throughout: the same as the app and the Coach's first message.
    await expect(coachPanel(page).getByText(fr.coachPanel.aiDisclosure)).toContainText("vous");
    expect(shown).toContain("Vous visez");
    expect(shown).toContain("Vos compétences");
    expect(shown).not.toMatch(/\b(tu|ton|ta|tes)\b/i);
  });

  test("a reply is unframed text, the thread's full width, no glyph once there (#464, #788); the Candidate's own words are an accent bubble", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-glyph"));
    await openCoachAndAsk(page, "E2E_COACH_MARKDOWN Quel est le poste que je vise ?");

    const answer = coachPanel(page).getByRole("listitem").filter({ hasText: "Directrice des opérations" });
    await expect(answer).toBeVisible();
    // No glyph in the margin (#788): its words start at the reply's left edge.
    await expect(answer.locator(":scope > svg.activity-glyph")).toHaveCount(0);
    const answerBox = (await answer.boundingBox())!;
    const textBox = (await answer.locator("p").first().boundingBox())!;
    expect(Math.round(textBox.x)).toBe(Math.round(answerBox.x));
    // Unframed: no border, no fill of its own.
    const frame = await answer.evaluate((li) => {
      const style = getComputedStyle(li);
      return { border: style.borderTopWidth, background: style.backgroundColor };
    });
    expect(frame).toEqual({ border: "0px", background: "rgba(0, 0, 0, 0)" });

    const mine = coachPanel(page).getByRole("listitem").filter({ hasText: "Quel est le poste que je vise ?" });
    const accent = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-accent)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect(mine).toHaveCSS("background-color", accent);
  });

  test("the thread scrolls to the latest answer, shown from its first line", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await signInWithMagicLink(page, newAddress("coach-scroll"));
    await openCoachAndAsk(page, "E2E_COACH_LONG Dites-moi tout.");

    // Taller than the thread's column, the answer shows from its start; its end is further down (e2e/conversation-scroll.spec.ts).
    await expect(coachPanel(page).getByText("Paragraphe 1 :")).toBeInViewport();
    await expect(coachPanel(page).getByText("FIN DE LA RÉPONSE")).not.toBeInViewport();

    // A second answer arrives: the thread goes on to it, from its first line.
    await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).fill("E2E_COACH_LONG Encore.");
    await coachPanel(page).getByRole("button", { name: fr.coachPanel.send }).click();
    await expect(coachPanel(page).getByText("FIN DE LA RÉPONSE")).toHaveCount(2);
    await expect(coachPanel(page).getByText("Paragraphe 1 :").last()).toBeInViewport();
    await expect(coachPanel(page).getByText("Paragraphe 1 :").first()).not.toBeInViewport();
  });
});

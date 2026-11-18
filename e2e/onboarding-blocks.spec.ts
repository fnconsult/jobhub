import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { onboardingSummary } from "./support/onboarding-summary";

// Issue #1046 (ADR-0106, map #992): the onboarding interview without a CV, in four blocks, and put off for later. Once the
// target role and a place are validated (the Profile is born, #999), the AI Coach says the rest comes in four blocks
// (criteria, career, skills, presentation); the thread marks where each starts, in words (« Bloc deux sur quatre »), once
// per block, never per question. « Continuer plus tard » saves the answers given and leaves the page; « Reprendre la création »
// reopens the interview at the block reached, not at the start. « Passer cette question » stays on every optional question.
// The turn cap (40) and the fall-back to the Onboarding Questionnaire are unchanged. The AI is faked inside the server
// (fake-mistral.mjs): a target role holding « (blocs) » makes it go on in the four blocks, from the block the prompt names.
const expect = baseExpect.configure({ timeout: 15_000 });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const interview = fr.newProfile.interview;
const origin = process.env.E2E_WEB_ORIGIN!;
const ROLE = "Directrice financière (blocs)";

const transcript = (page: Page) => page.getByRole("list", { name: fr.questionnaire.transcript });
const suggestions = (page: Page) => page.getByRole("group", { name: fr.conversationFirst.suggestions });
const skip = (page: Page) => suggestions(page).getByRole("button", { name: fr.questionnaire.skip, exact: true });
const later = (page: Page) => page.getByRole("button", { name: fr.newProfile.later.action, exact: true });
const blockMarks = (page: Page) => transcript(page).getByRole("heading", { level: 2 });
const lastLine = (page: Page) => transcript(page).getByRole("listitem").last();

/** Answers the question just asked: in the box. */
async function reply(page: Page, question: string, value: string) {
  await expect(lastLine(page)).toContainText(question);
  await page.getByLabel(fr.questionnaire.answerLabel).fill(value);
  await page.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
}

/** Starts the interview and answers the target role and the place: the Profile is born; the first question of the first block is asked. */
async function bornProfile(page: Page, who: string): Promise<void> {
  await signInWithMagicLink(page, newAddress(who));
  await page.goto("/profils/nouveau");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();
  await reply(page, "Quel poste recherchez-vous ?", ROLE);
  await reply(page, "Dans quelle ville souhaitez-vous travailler ?", "Lyon");
  await expect(lastLine(page)).toContainText("Quel type de contrat recherchez-vous ?");
}

async function profileOf(page: Page, id: string) {
  const response = await page.request.get(`/api/profiles/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { masterCv: { version: number; content: { experience: { title: string }[]; summary: string } }; searchCriteria: { contractTypes: string[] } };
}

test.describe("The onboarding interview in four blocks (#1046)", () => {
  test.setTimeout(150_000);

  test("once the target role and the place are validated, the coach announces four blocks, and the thread marks each once, in words", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("blocks-announced"));
    await page.goto("/profils/nouveau");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();

    // Before the Profile is born: no announcement, no mark.
    await reply(page, "Quel poste recherchez-vous ?", ROLE);
    await expect(lastLine(page)).toContainText("Dans quelle ville souhaitez-vous travailler ?");
    await expect(transcript(page)).not.toContainText(interview.blocks);
    await expect(blockMarks(page)).toHaveCount(0);

    // The place validated: one line names the four blocks, in order, then the first block starts.
    await reply(page, "Dans quelle ville souhaitez-vous travailler ?", "Lyon");
    await expect(transcript(page).getByText(interview.blocks)).toBeVisible();
    expect(interview.blocks).toMatch(/critères.*parcours.*compétences.*présentation/);
    await expect(lastLine(page)).toContainText("Quel type de contrat recherchez-vous ?");
    await expect(blockMarks(page)).toHaveText([interview.block.criteria]);

    // « bloc n sur 4 », in full words (no digit), a heading of the thread: its live region reads a new line once.
    await expect(blockMarks(page).first()).toHaveText(/^Bloc un sur quatre/);
    expect(interview.block.criteria).not.toMatch(/\d/);
    await expect(transcript(page)).toHaveAttribute("aria-live", "polite");

    // The three questions of the first block: still one mark.
    await suggestions(page).getByRole("button", { name: /^Oui, / }).click();
    await expect(lastLine(page)).toContainText("Quel rythme de télétravail vous convient ?");
    await expect(blockMarks(page)).toHaveCount(1);
    await skip(page).click();
    await expect(lastLine(page)).toContainText("Quel salaire annuel brut minimum visez-vous ?");
    await expect(blockMarks(page)).toHaveCount(1);

    // The next blocks, each marked once when it starts, in order, whatever the number of questions in it.
    await skip(page).click();
    await expect(lastLine(page)).toContainText("Quel est l'intitulé de votre dernier poste ?");
    await expect(blockMarks(page)).toHaveText([interview.block.criteria, interview.block.career]);
    await skip(page).click();
    await expect(lastLine(page)).toContainText("Quelle est votre formation ?");
    await expect(blockMarks(page)).toHaveCount(2);
    await skip(page).click();
    await expect(lastLine(page)).toContainText("Quelles sont vos principales compétences ?");
    await expect(blockMarks(page)).toHaveText([interview.block.criteria, interview.block.career, interview.block.skills]);
    await skip(page).click();
    await expect(lastLine(page)).toContainText("Présentez-vous en quelques phrases.");
    await expect(blockMarks(page)).toHaveText([interview.block.criteria, interview.block.career, interview.block.skills, interview.block.presentation]);
    await skip(page).click();
    await expect(onboardingSummary(page)).toBeVisible();
    await expect(blockMarks(page)).toHaveCount(4);
  });

  test("« Passer cette question » is on every optional question of every block", async ({ page }) => {
    await bornProfile(page, "blocks-skip");
    for (const question of [
      "Quel type de contrat recherchez-vous ?",
      "Quel rythme de télétravail vous convient ?",
      "Quel salaire annuel brut minimum visez-vous ?",
      "Quel est l'intitulé de votre dernier poste ?",
      "Quelle est votre formation ?",
      "Quelles sont vos principales compétences ?",
      "Présentez-vous en quelques phrases.",
    ]) {
      await expect(lastLine(page)).toContainText(question);
      await expect(skip(page)).toBeVisible();
      const answered = await transcript(page).locator("li.chat-candidate").count();
      await skip(page).click();
      await expect(transcript(page).locator("li.chat-candidate")).toHaveCount(answered + 1);
    }
    await expect(onboardingSummary(page)).toBeVisible();
  });

  test("« Continuer plus tard »: offered from the Profile's birth on, never before; it saves the answers given and leaves the page", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("blocks-later"));
    await page.goto("/profils/nouveau");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();
    // Not born yet (no place): nothing to save, nothing offered.
    await reply(page, "Quel poste recherchez-vous ?", ROLE);
    await expect(lastLine(page)).toContainText("Dans quelle ville souhaitez-vous travailler ?");
    await expect(later(page)).toHaveCount(0);

    // Born: offered at every question, after the Profile's birth.
    await reply(page, "Dans quelle ville souhaitez-vous travailler ?", "Lyon");
    await expect(lastLine(page)).toContainText("Quel type de contrat recherchez-vous ?");
    await expect(later(page)).toBeVisible();
    await suggestions(page).getByRole("button", { name: /^Oui, / }).click(); // CDI
    await expect(lastLine(page)).toContainText("Quel rythme de télétravail vous convient ?");
    await expect(later(page)).toBeVisible();
    await skip(page).click();
    await skip(page).click(); // the minimum salary
    await expect(lastLine(page)).toContainText("Quel est l'intitulé de votre dernier poste ?");
    await expect(later(page)).toBeVisible();
    await reply(page, "Quel est l'intitulé de votre dernier poste ?", "Contrôleuse de gestion");
    await expect(lastLine(page)).toContainText("Quelle est votre formation ?");
    await expect(later(page)).toBeVisible();

    // « Continuer plus tard »: the Profile's page, its Search Criteria and the Master CV as answered.
    await later(page).click();
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    const saved = await profileOf(page, id);
    expect(saved.searchCriteria.contractTypes).toEqual(["cdi"]);
    expect(saved.masterCv.content.experience[0]?.title).toBe("Contrôleuse de gestion");
    // Not finished: « Création à terminer », with « Reprendre la création ».
    await expect(page.getByText(fr.profilePage.onboarding.unfinished)).toBeVisible();
    await expect(page.getByRole("link", { name: fr.profilePage.onboarding.resume })).toHaveAttribute("href", `/profils/nouveau?profil=${id}`);
  });

  test("« Reprendre la création » reopens the interview at the block reached, not at the start, with the answers kept", async ({ page }) => {
    await bornProfile(page, "blocks-resume");
    await suggestions(page).getByRole("button", { name: /^Oui, / }).click();
    await skip(page).click();
    await skip(page).click();
    await reply(page, "Quel est l'intitulé de votre dernier poste ?", "Contrôleuse de gestion");
    await expect(lastLine(page)).toContainText("Quelle est votre formation ?");
    await later(page).click();
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    const before = await profileOf(page, id);

    await page.getByRole("link", { name: fr.profilePage.onboarding.resume }).click();
    await expect(page).toHaveURL(new RegExp(`/profils/nouveau\\?profil=${id}$`));
    // The coach picks up where it was left: the career block (the second), the next unanswered question; no criteria question again.
    await expect(transcript(page).getByText(interview.resumed)).toBeVisible();
    await expect(lastLine(page)).toContainText("Quelle est votre formation ?");
    await expect(blockMarks(page)).toHaveText([interview.block.career]);
    await expect(transcript(page)).not.toContainText("Quel type de contrat recherchez-vous ?");
    await expect(transcript(page)).not.toContainText("Quel poste recherchez-vous ?");
    // « Continuer plus tard » and « Passer cette question » still offered; the Profile is not duplicated or restarted.
    await expect(later(page)).toBeVisible();
    await expect(skip(page)).toBeVisible();

    // Going on: the blocks after it, then the summary; the Profile is still the same one.
    await skip(page).click();
    await expect(lastLine(page)).toContainText("Quelles sont vos principales compétences ?");
    await expect(blockMarks(page)).toHaveText([interview.block.career, interview.block.skills]);
    await reply(page, "Quelles sont vos principales compétences ?", "Contrôle de gestion, Excel");
    await expect(lastLine(page)).toContainText("Présentez-vous en quelques phrases.");
    await skip(page).click();
    await expect(onboardingSummary(page)).toBeVisible();
    const after = await profileOf(page, id);
    expect(after.masterCv.version).toBe(before.masterCv.version);
    expect(after.searchCriteria.contractTypes).toEqual(["cdi"]);
  });

  test("« Continuer plus tard » at a later block, then resumed there: the first block is not asked again", async ({ page }) => {
    await bornProfile(page, "blocks-resume-skills");
    for (let skipped = 0; skipped < 5; skipped++) await skip(page).click(); // criteria (3), career (2)
    await expect(lastLine(page)).toContainText("Quelles sont vos principales compétences ?");
    await later(page).click();
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: fr.profilePage.onboarding.resume }).click();
    await expect(lastLine(page)).toContainText("Quelles sont vos principales compétences ?");
    await expect(blockMarks(page)).toHaveText([interview.block.skills]);
    await expect(transcript(page)).not.toContainText("Quel type de contrat recherchez-vous ?");
    await expect(transcript(page)).not.toContainText("Quel est l'intitulé de votre dernier poste ?");
  });

  test("the scripted Onboarding Questionnaire still takes over when the AI is down, with « Continuer plus tard » once the Profile is born", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("blocks-fallback"));
    await page.goto("/profils/nouveau");
    await page.waitForLoadState("networkidle");
    await page.getByLabel(fr.coachPanel.messageLabel).fill("Je n'ai pas de CV E2E_AI_DOWN");
    await page.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
    await expect(transcript(page)).toContainText(interview.fallback);
    const q = fr.questionnaire.questions;
    await expect(later(page)).toHaveCount(0);
    await reply(page, q.fullName, "Marie Dupont");
    await reply(page, q.targetRole, "Directrice financière");
    await reply(page, q.location, "Lyon");
    await expect(lastLine(page)).toContainText(q.email);
    await expect(later(page)).toBeVisible();
    await expect(skip(page)).toBeVisible();
    // No block mark in the scripted questions.
    await expect(blockMarks(page)).toHaveCount(0);
  });
});

test.describe("The turn cap is unchanged (#1046)", () => {
  type Turn = { ask: { field: string; question: string }; reply: { kind: "skipped" } };
  const turns = (count: number): Turn[] => Array.from({ length: count }, () => ({ ask: { field: "skills", question: "Quelles sont vos compétences ?" }, reply: { kind: "skipped" } }));
  const draft = {
    masterCv: { fullName: "", headline: "", email: "", phone: "", location: "", summary: "", experience: [], education: [], skills: [], languages: [] },
    searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon (69)"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
  };

  /** The interview's endpoint, asked as the page does; "E2E_AI_DOWN" in the opener makes the AI fail, so the answer tells whether it was called. */
  async function ask(page: Page, exchange: Turn[], resumedAt?: { block: string; turns: number }) {
    const response = await page.request.post("/api/onboarding/interview", {
      headers: { origin },
      data: { language: "fr", draft, exchange, opener: "Je n'ai pas de CV E2E_AI_DOWN", ...(resumedAt ? { resumedAt } : {}) },
    });
    expect(response.status()).toBe(200);
    return (await response.json()) as { turn?: { done: boolean }; fallback?: boolean };
  }

  test("at 40 turns the interview is done without the AI; before, the AI is asked and, down, the scripted questions take over", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("blocks-cap"));
    expect(await ask(page, turns(39))).toEqual({ fallback: true });
    const capped = await ask(page, turns(40));
    expect(capped.fallback).toBeUndefined();
    expect(capped.turn?.done).toBe(true);
    // 41 turns is more than the page ever sends: refused.
    const over = await page.request.post("/api/onboarding/interview", { headers: { origin }, data: { language: "fr", draft, exchange: turns(41) } });
    expect(over.status()).toBe(400);
  });

  test("the turns asked before « Continuer plus tard » count in the cap", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("blocks-cap-resumed"));
    expect(await ask(page, turns(10), { block: "career", turns: 29 })).toEqual({ fallback: true });
    const capped = await ask(page, turns(10), { block: "career", turns: 30 });
    expect(capped.turn?.done).toBe(true);
    expect(capped.fallback).toBeUndefined();
  });
});

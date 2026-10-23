import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { chooseInPanelMenu } from "./support/coach-panel";

// Issue #327: each AI Coach reply keeps its Provenance, and one quiet line under it says what served it (the model that
// actually did, tokens · time, Tools, Provenance sites and the hour). « Votre coach » and « Vous » are read only by screen
// readers. The same line sits under each Back Office Assistant reply. The AI is faked inside the server (fake-mistral.mjs):
// every task runs on Mistral (api.mistral.ai, EU), its default model mistral-large-latest.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
/** A permanent super-admin of the suite's own (playwright.config.ts), for the Back Office Assistant. */
const SUPER_ADMIN = "provenance-office@e2e.jobbbox.test";

const panelOf = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });
const messagesOf = (panel: Locator, label: string) => panel.getByRole("list", { name: label }).locator("> li");
const lineOf = (message: Locator) => message.locator(".provenance-line");

async function ask(panel: Locator, text: string) {
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(text);
  await panel.getByRole("button", { name: fr.coachPanel.send }).click();
}

/** Each of these words is there for screen readers only: clipped to a pixel, never seen. */
async function expectOnlyForScreenReaders(words: Locator) {
  expect(await words.count()).toBeGreaterThan(0);
  for (const sizes of await words.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()))) {
    expect(sizes.width).toBeLessThanOrEqual(1);
    expect(sizes.height).toBeLessThanOrEqual(1);
  }
}

/** The panel passes axe (WCAG 2.1 AA), its Provenance lines and their disclosure included. */
async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

test.describe("the Provenance line under each AI Coach reply", () => {
  test("a reply shows the model that served it, tokens · time and the hour, with no visible author, no cost, prompt, Playbook Agent or id", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("provenance-line"));
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await ask(panelOf(page), "Comment préparer mon entretien ?");

    const messages = messagesOf(panelOf(page), fr.coachPanel.messagesLabel);
    await expect(messages).toHaveCount(3);
    const reply = messages.last();
    const line = lineOf(reply);
    await expect(line).toBeVisible();
    await expect(line).toContainText("Mistral Large");
    await expect(line).toContainText(new RegExp(`\\d+(,\\d)?k? ${fr.provenanceLine.tokens} · \\d+(,\\d)? s`));
    await expect(line.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
    await expect(line).not.toContainText(fr.provenanceLine.euAiConsent);
    // No cost, prompt, AI task, Playbook Agent or internal id.
    const shown = await line.innerText();
    expect(shown).not.toMatch(/€|eur|coaching|guardrail|playbook|mistral-large-latest|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    // Its words are metadata: 0.8125rem (13px at the standard size, 16px root) in #6b6a67.
    expect(await line.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(107, 106, 103)");
    expect(await line.evaluate((element) => parseFloat(getComputedStyle(element).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(0.8125, 4);

    // No author is shown; screen readers hear both.
    await expectOnlyForScreenReaders(panelOf(page).getByText(fr.questionnaire.coach, { exact: true }));
    await expectOnlyForScreenReaders(panelOf(page).getByText(fr.questionnaire.you, { exact: true }));
    const tree = await panelOf(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).ariaSnapshot();
    expect(tree).toContain(fr.questionnaire.coach);
    expect(tree).toContain(fr.questionnaire.you);
    expect(tree).toContain(fr.provenanceLine.tokens);

    // The line is kept: it is back when the conversation reopens.
    await page.reload();
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await expect(lineOf(messagesOf(panelOf(page), fr.coachPanel.messagesLabel).last())).toContainText("Mistral Large");
    await expectNoAxeViolations(page, "aside.coach-panel");
  });

  test("a reply that went to the EU AI Consent route shows Mistral with the « consentement IA UE » chip", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("provenance-consent"));
    expect((await page.request.put("/api/account/eu-ai-consent", { headers: { origin } })).ok()).toBe(true);
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    // A phone number makes the call identity-bearing: with EU AI Consent, the identity route serves it.
    await ask(panelOf(page), "Rappelez-moi au 06 12 34 56 78 pour parler de ma candidature.");

    const line = lineOf(messagesOf(panelOf(page), fr.coachPanel.messagesLabel).last());
    await expect(line).toContainText("Mistral Large");
    await expect(line.getByText(fr.provenanceLine.euAiConsent, { exact: true })).toBeVisible();
  });

  test("a reply saved before shows its partial line, one that saved nothing says « modèle non enregistré », and both pass axe", async ({ page }) => {
    const email = newAddress("provenance-old");
    await signInWithMagicLink(page, email);
    const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    await db.connect();
    try {
      const { rows } = await db.query(`INSERT INTO coach_conversation (candidate_id, title) SELECT id, 'Avant la provenance' FROM candidate WHERE email = $1 RETURNING id`, [email]);
      await db.query(
        `INSERT INTO coach_message (conversation_id, author, text, created_at, provider, model, input_tokens, output_tokens, cached_input_tokens) VALUES
           ($1, 'candidate', 'Bonjour', now() - interval '2 minutes', NULL, NULL, NULL, NULL, NULL),
           ($1, 'coach', 'Réponse avec son modèle.', now() - interval '2 minutes', 'mistral', 'mistral-large-latest', 1800, 300, 0),
           ($1, 'candidate', 'Et avant ?', now() - interval '1 minute', NULL, NULL, NULL, NULL, NULL),
           ($1, 'coach', 'Réponse sans rien.', now() - interval '1 minute', NULL, NULL, NULL, NULL, NULL)`,
        [rows[0].id],
      );
    } finally {
      await db.end();
    }

    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await chooseInPanelMenu(panelOf(page), fr.coachPanel.conversations);
    await panelOf(page).getByRole("button", { name: "Avant la provenance" }).click();

    const messages = messagesOf(panelOf(page), fr.coachPanel.messagesLabel);
    // The welcome first: the conversation was saved before the AI disclosure.
    await expect(messages).toHaveCount(5);
    const partial = lineOf(messages.nth(2));
    await expect(partial).toContainText("Mistral Large");
    await expect(partial).toContainText("2,1k");
    // Its time was not kept: none is shown.
    await expect(partial).not.toContainText(/\d s\b/);
    await expect(lineOf(messages.nth(4))).toContainText(fr.provenanceLine.unrecorded);
    await expectNoAxeViolations(page, "aside.coach-panel");
  });

  test("a reply's Provenance sites open as a disclosure listing the pages read, which passes axe", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("provenance-sites"));
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    // A careers page served by fake-coach-link-sites.mjs: the reply reads it (or finds its Job Offer already read) and keeps it as a Provenance site.
    await ask(panelOf(page), "Que pensez-vous de cette offre ? https://carrieres.coach-links.e2e-jobbbox.fr/offres/daf-lyon");

    const line = lineOf(messagesOf(panelOf(page), fr.coachPanel.messagesLabel).last());
    const sources = line.getByRole("button", { name: fr.provenanceLine.sources.replace("{{count}}", "1") });
    await expect(sources).toHaveAttribute("aria-expanded", "false");
    await sources.focus();
    await page.keyboard.press("Enter");
    await expect(sources).toHaveAttribute("aria-expanded", "true");
    const link = line.getByRole("link", { name: /carrieres\.coach-links\.e2e-jobbbox\.fr\/offres\/daf-lyon/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noreferrer");
    await expectNoAxeViolations(page, "aside.coach-panel");
    await page.keyboard.press("Escape");
    await expect(sources).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("the Provenance line under each Back Office Assistant reply", () => {
  test("a reply shows its line, with no visible author, and passes axe", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/journal");
    await page.getByRole("button", { name: fr.backOfficeAssistant.open, exact: true }).click();
    const assistant = page.getByRole("complementary", { name: fr.backOfficeAssistant.title });
    await ask(assistant, "Combien de coachs sont en activité ?");

    const messages = messagesOf(assistant, fr.backOfficeAssistant.messagesLabel);
    await expect(messages).toHaveCount(3);
    await expect(lineOf(messages.last())).toContainText("Mistral Large");
    await expectOnlyForScreenReaders(assistant.getByRole("list", { name: fr.backOfficeAssistant.messagesLabel }).getByText(fr.backOfficeAssistant.author, { exact: true }));
    await expectNoAxeViolations(page, "aside.coach-panel");
  });
});

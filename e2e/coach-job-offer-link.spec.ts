import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// A Job Offer link the Candidate pastes in the Coach Panel: the AI Coach reads the posting and answers with a
// Job Offer card, to process on the Job Offer's page. The careers site is faked inside the server
// (fake-coach-link-sites.mjs), which logs every request it gets; LinkedIn, a Forbidden site, is never requested.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachPanel.jobOfferLink;
const SITE = "https://carrieres.coach-links.e2e-jobbbox.fr";
const requestLog = path.join(path.dirname(process.env.E2E_SERVER_LOG!), "coach-links.log");

const coachPanel = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });

async function say(page: Page, text: string) {
  await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await coachPanel(page).getByRole("button", { name: fr.coachPanel.send }).click();
}

const requested = () => (existsSync(requestLog) ? readFileSync(requestLog, "utf8").split("\n").filter(Boolean) : []);

test.describe("a Job Offer link pasted in the Coach Panel", () => {
  test("the AI Coach reads the posting and answers with a card to the new Job Offer, to process on its page", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-link"));
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await say(page, `Que pensez-vous de cette offre ? ${SITE}/offres/daf-lyon`);

    await expect(coachPanel(page).getByText(texts.read)).toBeVisible();
    const card = coachPanel(page).getByRole("article", { name: texts.card });
    await expect(card).toContainText("Directrice administrative et financière H/F");
    await expect(card).toContainText("Fromagerie Lyonnaise");
    await expect(card).toContainText(texts.toProcess);

    // The card reopens with the conversation.
    await page.reload();
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await expect(coachPanel(page).getByRole("article", { name: texts.card })).toContainText(texts.toProcess);

    await coachPanel(page).getByRole("link", { name: texts.open }).click();
    await expect(page).toHaveURL(/\/offres\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: fr.jobOffer.saveTitle })).toBeVisible();
    await expect(page.getByText("Fromagerie Lyonnaise recrute sa directrice administrative et financière").first()).toBeVisible();
  });

  test("a Forbidden site is never requested, and a page that is not one posting makes no Job Offer", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-link-refused"));
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();

    await say(page, "https://www.linkedin.com/jobs/view/4012345678");
    await expect(coachPanel(page).getByText(texts.forbiddenSite)).toBeVisible();
    expect(requested().filter((url) => url.includes("linkedin"))).toEqual([]);

    await say(page, `${SITE}/offres`);
    await expect(coachPanel(page).getByText(texts.notAJobOffer)).toBeVisible();
    await expect(coachPanel(page).getByRole("article", { name: texts.card })).toHaveCount(0);
  });
});

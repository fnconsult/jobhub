import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { toConversation } from "./support/conversation";
import AxeBuilder from "./support/axe";
import { comparesScreenshots, SCREENSHOT_WIDTHS } from "./support/screenshots";
import { expectTextContrast, showInTheme, themedName, THEMES } from "./support/theme";

// A Job Offer link the Candidate pastes in the Coach Panel: the AI Coach reads the posting and answers with a
// Job Offer card, to process on the Job Offer's page. The careers site is faked inside the server
// (fake-coach-link-sites.mjs), which logs every request it gets; LinkedIn, a Forbidden site, is never requested.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachPanel.jobOfferLink;
const SITE = "https://carrieres.coach-links.e2e-jobbbox.fr";
const requestLog = path.join(path.dirname(process.env.E2E_SERVER_LOG!), "coach-links.log");

const coachPanel = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });

async function say(page: Page, text: string) {
  await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await coachPanel(page).getByRole("button", { name: fr.coachPanel.send }).click();
}

const requested = () => (existsSync(requestLog) ? readFileSync(requestLog, "utf8").split("\n").filter(Boolean) : []);

test.describe("a Job Offer link pasted in the Coach Panel", () => {
  test("the AI Coach reads the posting and answers with a card to the new Job Offer, to process on its page", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-link"));
    await toConversation(page);
    await say(page, `Que pensez-vous de cette offre ? ${SITE}/offres/daf-lyon`);

    await expect(coachPanel(page).getByText(texts.read)).toBeVisible();
    const card = coachPanel(page).getByRole("article", { name: texts.card });
    await expect(card).toContainText("Directrice administrative et financière H/F");
    await expect(card).toContainText("Fromagerie Lyonnaise");
    await expect(card).toContainText(texts.toProcess);

    // The card reopens with the conversation.
    await page.reload();
    await toConversation(page);
    await expect(coachPanel(page).getByRole("article", { name: texts.card })).toContainText(texts.toProcess);

    await coachPanel(page).getByRole("link", { name: texts.open }).click();
    await expect(page).toHaveURL(/\/offres\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: fr.jobOffer.saveTitle })).toBeVisible();
    await expect(page.getByText("Fromagerie Lyonnaise recrute sa directrice administrative et financière").first()).toBeVisible();
  });

  test("a Forbidden site is never requested, and a page that is not one posting makes no Job Offer", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-link-refused"));
    await toConversation(page);

    await say(page, "https://www.linkedin.com/jobs/view/4012345678");
    await expect(coachPanel(page).getByText(texts.forbiddenSite)).toBeVisible();
    expect(requested().filter((url) => url.includes("linkedin"))).toEqual([]);

    await say(page, `${SITE}/offres`);
    await expect(coachPanel(page).getByText(texts.notAJobOffer)).toBeVisible();
    await expect(coachPanel(page).getByRole("article", { name: texts.card })).toHaveCount(0);
  });
});

// The card on the Design System (the product owner's « coach-card-suivie » regression): a Card with no edge of its own,
// a Pill, a small secondary Button. Its baselines, light and dark, at the three widths and, on a phone, at the largest
// Text Size; only the card is compared (the Provenance line under it holds a time). How to redraw them on purpose:
// docs/agents/screenshot-baselines.md.
test.describe("the Job Offer card's screenshot baselines", () => {
  test("the card is drawn with the Design System, light and dark, at each width and the largest Text Size", async ({ page }) => {
    test.setTimeout(120_000);
    await signInWithMagicLink(page, newAddress("coach-link-card"));
    await toConversation(page);
    await say(page, `Que pensez-vous de cette offre ? ${SITE}/offres/daf-lyon`);
    const card = coachPanel(page).getByRole("article", { name: texts.card });
    await expect(card).toContainText(texts.toProcess);

    // No accent edge: the card's four borders are the Card's one hairline.
    const borders = await card.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.borderLeftWidth, style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth];
    });
    expect(new Set(borders).size, `the card's borders: ${borders.join(", ")}`).toBe(1);

    const shots = [
      ...SCREENSHOT_WIDTHS.map((size) => ({ ...size, textSize: "standard" as const })),
      { ...SCREENSHOT_WIDTHS[0], name: "phone-xlarge", textSize: "xlarge" as const },
    ];
    for (const shot of shots) {
      await page.setViewportSize({ width: shot.width, height: shot.height });
      if (shot.textSize === "xlarge") {
        await page.evaluate(() => localStorage.setItem("jobbbox.textSize", "xlarge"));
        await page.reload();
        await toConversation(page);
        await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
      }
      for (const theme of THEMES) {
        await showInTheme(page, theme);
        await card.scrollIntoViewIfNeeded();
        expect((await new AxeBuilder({ page }).include(".coach-job-offer-card").analyze()).violations).toEqual([]);
        if (theme === "dark") await expectTextContrast(page, `job-offer-card-${shot.name}`);
        if (comparesScreenshots()) await expect(card).toHaveScreenshot(`${themedName(`job-offer-card-${shot.name}`, theme)}.png`);
      }
    }
    await showInTheme(page, "light");
  });
});

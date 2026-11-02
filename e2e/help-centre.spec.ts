import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #549 (ADR-0065): the public Help Centre. /aide shows its four topics, named by task, and a search without AI; a
// Visitor, signed out, reads a public article, its kind, « Écrit par l'équipe Jobbbox » and its related articles; a
// tutorial's steps are a numbered list; an empty topic says « Bientôt des articles ici »; /en/aide/… is in English; any
// other address under /aide is a 404 (an Administrator's article is never public: packages/help/src/help-centre.test.ts).
// The Coach Panel finds the « extension » topic's articles, and its card leads to the article in the Help Centre.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const titleOf = (locale: "fr" | "en", id: string) => /^title: (.+)$/m.exec(readFileSync(`packages/help/articles/${locale}/${id}.md`, "utf8"))![1]!;
const TUTORIAL = "tutorial-extension-save-job-offer";
const WHERE = "faq-where-to-find-help";
const TOPICS = ["decouvrir", "extension", "utiliser", "espace-coach"] as const;

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

const main = (page: Page) => page.getByRole("main");

test.describe("the Help Centre, for a Visitor", () => {
  test("/aide shows the four topics and the search; a signed-out Visitor finds and reads a tutorial", async ({ page }) => {
    await page.goto("/aide");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.helpCentre.title);
    await expect(main(page).getByRole("heading", { level: 3 })).toHaveText(TOPICS.map((topic) => fr.helpCentre.topics[topic].title));
    await expect(main(page).getByRole("search").getByLabel(fr.helpCentre.searchLabel)).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    await main(page).getByLabel(fr.helpCentre.searchLabel).fill("enregistrer une offre avec l'extension");
    await main(page).getByRole("button", { name: fr.helpCentre.searchSubmit }).click();
    await expect(page).toHaveURL(/\/aide\?q=enregistrer/);
    await expect(main(page).getByRole("status")).toContainText("enregistrer une offre avec l'extension");
    await main(page).getByRole("link", { name: titleOf("fr", TUTORIAL) }).click();

    await expect(page).toHaveURL(`${origin}/aide/extension/${TUTORIAL}`);
    const article = main(page).getByRole("article", { name: titleOf("fr", TUTORIAL) });
    await expect(article.getByText(fr.coachPanel.help.kinds.tutorial, { exact: true })).toBeVisible();
    await expect(article.getByText(fr.helpCentre.writtenBy, { exact: true })).toBeVisible();
    await expect(article.getByRole("navigation", { name: fr.helpCentre.breadcrumb }).getByRole("link")).toHaveText([fr.helpCentre.title, fr.helpCentre.topics.extension.title]);
    // A tutorial's steps: a numbered list, the interface's labels word for word.
    const steps = article.locator(".help-centre__body ol > li");
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(1)).toContainText(`« ${fr.extension.badge} »`);
    await expect(main(page).getByRole("heading", { name: fr.helpCentre.related })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("a topic lists its articles; an empty one says « Bientôt des articles ici », never a 404", async ({ page }) => {
    await page.goto("/aide");
    await main(page).getByRole("link", { name: fr.helpCentre.topics.decouvrir.title }).click();
    await expect(page).toHaveURL(`${origin}/aide/decouvrir`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.helpCentre.topics.decouvrir.title);
    await expect(main(page).getByRole("list", { name: fr.helpCentre.inTopic }).getByRole("link", { name: titleOf("fr", WHERE) })).toBeVisible();

    const empty = await page.goto("/aide/espace-coach");
    expect(empty?.status()).toBe(200);
    await expect(main(page).getByRole("heading", { name: fr.helpCentre.emptyTopic })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("a search no article answers says so", async ({ page }) => {
    await page.goto("/aide?q=zzzz%20yyyy");
    await expect(main(page).getByRole("status")).toHaveText(fr.helpCentre.noResults.replace("{{query}}", "zzzz yyyy"));
  });

  test("/en/aide and its articles are in English, their links staying under /en", async ({ page }) => {
    await page.goto("/en/aide");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.helpCentre.title);
    await expect(main(page).getByRole("heading", { level: 3 })).toHaveText(TOPICS.map((topic) => en.helpCentre.topics[topic].title));

    await main(page).getByRole("link", { name: en.helpCentre.topics.decouvrir.title }).click();
    await expect(page).toHaveURL(`${origin}/en/aide/decouvrir`);
    await main(page).getByRole("link", { name: titleOf("en", WHERE) }).click();
    await expect(page).toHaveURL(`${origin}/en/aide/decouvrir/${WHERE}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(titleOf("en", WHERE));
    await expect(main(page).getByText(en.helpCentre.writtenBy, { exact: true })).toBeVisible();

    await main(page).getByRole("navigation", { name: en.helpCentre.breadcrumb }).getByRole("link", { name: en.helpCentre.title }).click();
    await expect(page).toHaveURL(`${origin}/en/aide`);
    await main(page).getByLabel(en.helpCentre.searchLabel).fill("extension");
    await main(page).getByRole("button", { name: en.helpCentre.searchSubmit }).click();
    await expect(page).toHaveURL(`${origin}/en/aide?q=extension`);
    await expect(main(page).getByRole("link", { name: titleOf("en", TUTORIAL) })).toHaveAttribute("href", `/en/aide/extension/${TUTORIAL}`);
  });

  test("any other address under /aide is a 404: an unknown topic, an unknown article, an article under another topic", async ({ request }) => {
    for (const path of ["/aide/parametres", "/aide/utiliser/no-such-article", `/aide/utiliser/${TUTORIAL}`, `/en/aide/decouvrir/${TUTORIAL}`]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });
});

test.describe("the Coach Panel and the Help Centre", () => {
  test("the Coach Panel finds the « extension » topic's tutorial; its card leads to the article in the Help Centre", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("help-centre-coach"));
    const panel = page.getByRole("complementary", { name: fr.coachPanel.title });
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await panel.getByLabel(fr.coachPanel.messageLabel).fill("enregistrer une offre avec l'extension");
    await panel.getByRole("list", { name: fr.coachPanel.help.suggestions }).getByRole("button", { name: titleOf("fr", TUTORIAL) }).click();

    const card = panel.getByRole("article", { name: titleOf("fr", TUTORIAL) });
    await expect(card.getByText(fr.coachPanel.help.cardLabel)).toBeVisible();
    await card.getByRole("link", { name: fr.coachPanel.help.openInHelpCentreAbout.replace("{{title}}", titleOf("fr", TUTORIAL)) }).click();
    await expect(page).toHaveURL(`${origin}/aide/extension/${TUTORIAL}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(titleOf("fr", TUTORIAL));
  });
});

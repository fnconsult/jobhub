import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #549 (ADR-0065): the public Help Centre. /aide shows its four topics, named by task, and a search without AI; a
// Visitor, signed out, reads a public article, its kind, « Écrit par l'équipe Jobbbox » and its related articles; a
// tutorial's steps are a numbered list; an empty topic says « Bientôt des articles ici » (none left since #554, so a unit
// test: packages/help/src/help-centre.test.ts); /en/aide/… is in English; any
// other address under /aide is a 404 (an Administrator's article is never public: packages/help/src/help-centre.test.ts).
// The Coach Panel finds the « extension » topic's articles, and its card leads to the article in the Help Centre.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const en = JSON.parse(readFileSync("packages/shared/src/i18n/locales/en.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
/** An article's title, as its front matter gives it, quotes around it dropped (« "L'extension : l'installer" »). */
const titleOf = (locale: "fr" | "en", id: string) =>
  /^title: (.+)$/m.exec(readFileSync(`packages/help/articles/${locale}/${id}.md`, "utf8"))![1]!.replace(/^(["'])(.*)\1$/, "$2");
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
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(1)).toContainText(`« ${fr.extension.badge} »`);
    await expect(main(page).getByRole("heading", { name: fr.helpCentre.related })).toBeVisible();
    // Reached by a link: Next streams the page's <title> after its content, so axe waits for it (else « document-title »).
    await expect(page).toHaveTitle(`${titleOf("fr", TUTORIAL)} · ${fr.helpCentre.title} · ${fr.app.name}`);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("a topic lists its articles", async ({ page }) => {
    await page.goto("/aide");
    await main(page).getByRole("link", { name: fr.helpCentre.topics.decouvrir.title }).click();
    await expect(page).toHaveURL(`${origin}/aide/decouvrir`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.helpCentre.topics.decouvrir.title);
    await expect(main(page).getByRole("list", { name: fr.helpCentre.inTopic }).getByRole("link", { name: titleOf("fr", WHERE) })).toBeVisible();
    // Reached by a click, the page sets its <title> after it draws: wait for it, or axe can read none (document-title).
    await expect(page).not.toHaveTitle("");
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
  test("the conversation finds the « extension » topic's tutorial; the article opens beside it and leads to the Help Centre", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("help-centre-coach"));
    await page.goto("/");
    const box = page.getByRole("textbox", { name: fr.coachPanel.messageLabel });
    await box.fill("enregistrer une offre avec l'extension");
    await page.getByRole("list", { name: fr.coachPanel.help.suggestions }).getByRole("button", { name: titleOf("fr", TUTORIAL) }).click();

    const pane = page.getByRole("complementary").filter({ has: page.locator(".work-pane-head") });
    await expect(pane.getByRole("heading", { level: 2, name: titleOf("fr", TUTORIAL) })).toBeVisible();
    await pane.getByRole("link", { name: fr.coachPanel.help.openInHelpCentreAbout.replace("{{title}}", titleOf("fr", TUTORIAL)) }).click();
    await expect(page).toHaveURL(`${origin}/aide/extension/${TUTORIAL}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(titleOf("fr", TUTORIAL));
  });
});

// Issue #552: the « Découvrir Jobbbox » articles for a Visitor, signed out: listed under their topic, found by the
// public search, « Nous contacter » in the public footer leading to its article, which gives the legal notice's
// address (never its token), and the data and AI question linking to the privacy policy's AI section, under /en in English.
test.describe("« Découvrir Jobbbox », for a Visitor (#552)", () => {
  const DECOUVRIR = [
    "page-what-is-jobbbox",
    "page-install-extension",
    "faq-sign-in-link",
    "faq-plans-and-quotas",
    "faq-text-size-site",
    "faq-job-digest-unsubscribe",
    "faq-contact-us",
    "faq-data-and-ai",
    "tutorial-getting-started",
  ];
  const CONTACT = "faq-contact-us";

  test("/aide/decouvrir lists its 9 articles; the public search finds them", async ({ page }) => {
    await page.goto("/aide/decouvrir");
    const list = main(page).getByRole("list", { name: fr.helpCentre.inTopic });
    for (const id of DECOUVRIR) await expect(list.getByRole("link", { name: titleOf("fr", id), exact: true })).toHaveAttribute("href", `/aide/decouvrir/${id}`);

    for (const [query, id] of [
      ["mot de passe oublié", "faq-sign-in-link"],
      ["se désabonner du job digest", "faq-job-digest-unsubscribe"],
      ["créer un compte et mon premier profil", "tutorial-getting-started"],
    ] as const) {
      await page.goto(`/aide?q=${encodeURIComponent(query)}`);
      await expect(main(page).getByRole("link", { name: titleOf("fr", id), exact: true }).first(), query).toBeVisible();
    }
  });

  test("the tutorial « Commencer » is a numbered list of the interface's labels", async ({ page }) => {
    await page.goto("/aide/decouvrir/tutorial-getting-started");
    const steps = main(page).locator(".help-centre__body ol > li");
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(0)).toContainText(`« ${fr.signIn.submit} »`);
    await expect(steps.nth(3)).toContainText(`« ${fr.profiles.create} »`);
    await expect(steps.nth(5)).toContainText(`« ${fr.cvReview.save} »`);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("« Nous contacter » in the public footer opens its article, which gives the legal notice's address", async ({ page }) => {
    await page.goto("/aide");
    await page.getByRole("contentinfo").getByRole("link", { name: fr.publicFooter.help.contact }).click();
    await expect(page).toHaveURL(`${origin}/aide/decouvrir/${CONTACT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(titleOf("fr", CONTACT));
    // Its metadata comes after a client-side navigation: wait for the page's title before axe reads it.
    await expect(page).toHaveTitle(new RegExp(`^${titleOf("fr", CONTACT).replace(/[?]/g, "\\?")}`));
    const body = main(page).locator(".help-centre__body");
    await expect(body).toContainText(`« ${fr.signalement.question.title} »`);
    await expect(body).not.toContainText("{{contact-email}}");
    // The address the app sends from (MAIL_FROM), as a mailto link; while it is a development one, the legal notice's.
    const mailto = body.locator("a[href^='mailto:']");
    if ((await mailto.count()) > 0) await expect(mailto).toHaveText(/@/);
    else await expect(body).toContainText("l'adresse indiquée dans les mentions légales");
    expect(await axeViolations(page)).toEqual([]);

    await page.goto("/en/aide");
    await page.getByRole("contentinfo").getByRole("link", { name: en.publicFooter.help.contact }).click();
    await expect(page).toHaveURL(`${origin}/en/aide/decouvrir/${CONTACT}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(titleOf("en", CONTACT));
  });

  test("the data and AI question links to the privacy policy's AI section, in the page's language", async ({ page }) => {
    await page.goto("/aide/decouvrir/faq-data-and-ai");
    await expect(main(page).locator(".help-centre__body").getByRole("link", { name: fr.publicFooter.legal.ia })).toHaveAttribute("href", "/legal/confidentialite#ia");
    await page.goto("/en/aide/decouvrir/faq-data-and-ai");
    await expect(main(page).locator(".help-centre__body").getByRole("link", { name: en.publicFooter.legal.ia })).toHaveAttribute("href", "/en/legal/confidentialite#ia");
  });
});

// Issue #553: the « L'extension » articles, for the Guest and the signed-in Candidate. Listed under their topic in
// French and English, the tutorials a numbered list of the Side Panel's labels, and found from a Candidate's Coach Panel.
test.describe("« L'extension » (#553)", () => {
  const EXTENSION = [
    "page-side-panel",
    "faq-extension-badge-sites",
    "faq-guest-session",
    "faq-rescore-why-match-score",
    "tutorial-extension-analyse-job-offer",
    "tutorial-extension-create-account",
    TUTORIAL,
  ];

  test("/aide/extension and /en/aide/extension list #553's 7 articles", async ({ page }) => {
    for (const [locale, prefix] of [["fr", ""], ["en", "/en"]] as const) {
      await page.goto(`${prefix}/aide/extension`);
      const list = main(page).getByRole("list", { name: (locale === "fr" ? fr : en).helpCentre.inTopic });
      for (const id of EXTENSION) await expect(list.getByRole("link", { name: titleOf(locale, id), exact: true })).toHaveAttribute("href", `${prefix}/aide/extension/${id}`);
    }
  });

  test("the Guest's tutorial « Analyser une offre » is a numbered list of the Side Panel's labels", async ({ page }) => {
    await page.goto("/aide/extension/tutorial-extension-analyse-job-offer");
    const steps = main(page).locator(".help-centre__body ol > li");
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(0)).toContainText(`« ${fr.extension.badge} »`);
    await expect(steps.nth(2)).toContainText(`« ${fr.extension.analysis.dropCv} »`);
    await expect(steps.nth(3)).toContainText(`« ${fr.extension.analysis.submit} »`);
    await expect(steps.nth(5)).toContainText(`« ${fr.extension.analysis.forget} »`);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("a Candidate's Coach Panel finds the Guest session's question", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("help-centre-extension"));
    await page.goto("/");
    await page.getByRole("textbox", { name: fr.coachPanel.messageLabel }).fill("effacer mes données de l'extension");
    await expect(page.getByRole("list", { name: fr.coachPanel.help.suggestions }).getByRole("button", { name: titleOf("fr", "faq-guest-session") })).toBeVisible();
  });
});

// Issue #554: the « Espace coach » articles, a Human Coach's. Listed under their topic in French and English, the
// tutorials a numbered list of the coach space's labels; the coach space's footer leads there (e2e/public-shell.spec.ts).
test.describe("« Espace coach » (#554)", () => {
  const COACH_SPACE = ["page-coach-space", "faq-coach-access", "faq-retired-human-coach", "tutorial-coach-session-date", "tutorial-coach-review", "faq-coach-two-step-verification"];

  test("/aide/espace-coach and /en/aide/espace-coach list the coach space's articles (#554, #665)", async ({ page }) => {
    for (const [locale, prefix] of [["fr", ""], ["en", "/en"]] as const) {
      await page.goto(`${prefix}/aide/espace-coach`);
      const list = main(page).getByRole("list", { name: (locale === "fr" ? fr : en).helpCentre.inTopic });
      await expect(list.getByRole("link")).toHaveCount(COACH_SPACE.length);
      for (const id of COACH_SPACE) await expect(list.getByRole("link", { name: titleOf(locale, id), exact: true })).toHaveAttribute("href", `${prefix}/aide/espace-coach/${id}`);
    }
  });

  test("the tutorial « Saisir la date et le lien d'une séance » is a numbered list of the coach space's labels", async ({ page }) => {
    await page.goto("/aide/espace-coach/tutorial-coach-session-date");
    const steps = main(page).locator(".help-centre__body ol > li");
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(0)).toContainText(`« ${fr.coachSpace.sessionsTitle} »`);
    await expect(steps.nth(1)).toContainText(`« ${fr.coachingSession.coachEnterDate} »`);
    await expect(steps.nth(2)).toContainText(`« ${fr.coachingSession.date} »`);
    await expect(steps.nth(4)).toContainText(`« ${fr.coachingSession.videoLink} »`);
    await expect(steps.nth(5)).toContainText(`« ${fr.coachingSession.save} »`);
    expect(await axeViolations(page)).toEqual([]);
  });

  test("the tutorial « Write a review of an application document » is in English", async ({ page }) => {
    await page.goto("/en/aide/espace-coach/tutorial-coach-review");
    const steps = main(page).locator(".help-centre__body ol > li");
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(3)).toContainText(`« ${en.coachSpace.reviewDocument} »`);
    await expect(steps.nth(5)).toContainText(`« ${en.coachSpace.reviewSubmit} »`);
  });
});

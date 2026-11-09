import { readFileSync } from "node:fs";
import pg from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { showSystemPrompt, systemPromptShown } from "./support/system-prompt";

// Issue #551 (ADR-0065): the Back Office's help. The Back Office Assistant suggests the Administrators' Help Articles
// first, found without AI, is given those the search finds and cites them; with none, the reply offers « Demander un
// tutoriel », whose click alone keeps an Unanswered Question of the Administrator audience, with the section in view,
// never the Administrator. « Questions sans réponse » filters by audience. /admin/aide lists the Back Office's topics,
// « Fournisseurs et Tools » first, its search and each article, for Administrators only, never indexed; an
// Administrator's article stays out of /aide and sitemap.xml. The AI is faked inside the server (fake-mistral.mjs):
// "E2E_SHOW_CONTEXT#<tag>" prints the system prompt to the server log.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const uq = admin.unansweredQuestions;
const assistantTexts = fr.backOfficeAssistant;
const page404 = fr.errorPage.notFound.title;
// Its own permanent super-admin (playwright.config.ts's ADMIN_EMAILS).
const SUPER_ADMIN = "back-office-help-office@e2e.jobbbox.test";
const ARTICLE = { id: "page-admin-unanswered-questions", title: "Questions sans réponse", path: "/admin/aide/contenu/page-admin-unanswered-questions" };
const origin = process.env.E2E_WEB_ORIGIN!;

/** A word of letters alone, its own to each run: no Help Article holds it. */
const tag = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

const assistant = (page: Page) => page.getByRole("complementary", { name: assistantTexts.title });
const box = (page: Page) => assistant(page).getByLabel(fr.coachPanel.messageLabel);
const messages = (page: Page) => assistant(page).getByRole("list", { name: assistantTexts.messagesLabel }).locator("> li");

async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

async function openAssistant(page: Page) {
  await page.getByRole("button", { name: assistantTexts.open, exact: true }).click();
  await expect(assistant(page)).toBeVisible();
}

/** Sends `text` to the assistant and waits for its reply. */
async function ask(page: Page, text: string) {
  const before = await messages(page).count();
  await box(page).fill(text);
  await assistant(page).getByRole("button", { name: assistantTexts.send, exact: true }).click();
  await expect(messages(page)).toHaveCount(before + 2);
}

test.describe("Back Office help: the assistant's articles, « Demander un tutoriel », /admin/aide (#551)", () => {
  test("the assistant shows the section's article « Sur cette page », suggests it while typing, is given it and cites it", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/questions-sans-reponse");
    await openAssistant(page);

    // « Sur cette page »: the section's Administrator article.
    const intro = assistant(page).locator(".help-intro");
    await expect(intro.getByRole("heading", { name: fr.coachPanel.help.onThisPage })).toBeVisible();
    await expect(intro).toContainText(ARTICLE.title);
    await expect(intro).not.toContainText(fr.coachPanel.help.oftenAsked);
    await intro.getByRole("button", { name: fr.coachPanel.help.readMoreAbout.replace("{{title}}", ARTICLE.title) }).click();
    const card = assistant(page).getByRole("article", { name: ARTICLE.title });
    await expect(card).toContainText("Filtrer par public");
    await expect(card.getByRole("link", { name: assistantTexts.help.openInBackOfficeHelpAbout.replace("{{title}}", ARTICLE.title) })).toHaveAttribute("href", ARTICLE.path);
    await expect(card.getByRole("link", { name: fr.coachPanel.help.openInHelpCentre })).toHaveCount(0);

    // Suggested first, without AI, while typing.
    await box(page).fill("filtrer les questions sans réponse par public");
    await expect(assistant(page).getByRole("list", { name: fr.coachPanel.help.suggestions }).getByRole("button").first()).toHaveText(`${ARTICLE.title}${fr.coachPanel.help.kinds.page}`);

    // Given to the assistant, with its link to cite; a Candidate's article never.
    const show = showSystemPrompt();
    await ask(page, `Comment filtrer les questions sans réponse par public ? ${show}`);
    const system = await systemPromptShown(show);
    expect(system).toContain(`### « ${ARTICLE.title} » (${ARTICLE.path})`);
    expect(system).toContain("citez chaque article dont vous vous servez par son titre et son lien");
    // Found articles: no « Demander un tutoriel » under the reply.
    await expect(messages(page).last().getByRole("button", { name: assistantTexts.help.requestTutorial })).toHaveCount(0);

  });

  test("given no Candidate's article, the assistant offers « Demander un tutoriel », which alone records an Administrator's Unanswered Question, without the Administrator, filtered by audience", async ({ page }) => {
    const ref = tag();
    const show = showSystemPrompt();
    // A Candidate's frequent question (faq-follow-up-recruiter): the assistant is never given that article.
    const question = `Comment relancer un recruteur ${ref} ? ${show}`;
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin/offres");
    await openAssistant(page);
    await ask(page, question);
    const told = await systemPromptShown(show);
    expect(told).not.toContain("### « ");
    expect(told).toContain("Aucun article de l'aide du back office ne couvre cette question");
    const reply = messages(page).last();
    await expect(reply).toContainText(assistantTexts.help.noTutorial);

    // Nothing is recorded before the click.
    const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
    try {
      const kept = async () => (await db.query("SELECT * FROM unanswered_question WHERE question LIKE $1", [`%${ref}%`])).rows;
      expect(await kept()).toEqual([]);

      await reply.getByRole("button", { name: assistantTexts.help.requestTutorial }).click();
      await expect(reply.getByRole("status")).toHaveText(assistantTexts.help.requested);

      const rows = await kept();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ audience: "administrator", question, route: "/admin/offres", language: "fr", count: 1 });
      // Nothing in it names the Administrator.
      expect(JSON.stringify(rows[0])).not.toContain("back-office-help-office");
      // No column could: none names a person, an account or a conversation.
      expect(Object.keys(rows[0]!).filter((column) => /candidate|administrator|account|person|email|conversation/.test(column))).toEqual([]);
    } finally {
      await db.end();
    }

    // « Questions sans réponse », by audience.
    await page.goto("/admin/questions-sans-reponse");
    const row = page.getByRole("row").filter({ hasText: ref });
    await expect(row.getByRole("cell").nth(0)).toHaveText(`/admin/offres · ${uq.audiences.administrator} · ${uq.languages.fr}`);
    const audiences = page.getByRole("navigation", { name: uq.audienceFilter });
    await expect(audiences.getByRole("link")).toHaveText([uq.allAudiences, ...["visitor", "guest", "candidate", "human-coach", "administrator"].map((each) => uq.audiences[each])]);
    await audiences.getByRole("link", { name: uq.audiences.candidate }).click();
    await expect(page).toHaveURL(/public=candidate/);
    await expect(page.getByRole("row").filter({ hasText: ref })).toHaveCount(0);
    await page.getByRole("navigation", { name: uq.audienceFilter }).getByRole("link", { name: uq.audiences.administrator }).click();
    await expect(page.getByRole("navigation", { name: uq.audienceFilter }).getByRole("link", { name: uq.audiences.administrator })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row").filter({ hasText: ref })).toHaveCount(1);
  });

  test("#558: each section's article « Sur cette page », a tutorial cited by the assistant, and « IA et conformité » with its dated note, for Administrators only", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    const guardrails = { title: "Garde-fous", path: "/admin/aide/coaching/page-admin-guardrails" };
    await page.goto("/admin/garde-fous");
    await openAssistant(page);
    const intro = assistant(page).locator(".help-intro");
    await expect(intro).toContainText(guardrails.title);
    await intro.getByRole("button", { name: fr.coachPanel.help.readMoreAbout.replace("{{title}}", guardrails.title) }).click();
    const card = assistant(page).getByRole("article", { name: guardrails.title });
    await expect(card).toContainText("Quand il détecte quelque chose");
    await expect(card.getByRole("link", { name: assistantTexts.help.openInBackOfficeHelpAbout.replace("{{title}}", guardrails.title) })).toHaveAttribute("href", guardrails.path);

    // A tutorial, found without AI and given to the assistant with its link.
    const show = showSystemPrompt();
    await ask(page, `Comment valider un playbook ? ${show}`);
    expect(await systemPromptShown(show)).toContain("### « Valider une version d'un playbook » (/admin/aide/coaching/tutorial-admin-validate-playbook)");

    // « IA et conformité », last: the art. 4 article and the internal, dated « hors Annexe III » note.
    const note = { id: "faq-admin-annex-iii-note", path: "/admin/aide/ia-et-conformite/faq-admin-annex-iii-note" };
    await page.goto("/admin/aide/ia-et-conformite");
    const list = page.getByRole("main").getByRole("link");
    await expect(list.filter({ hasText: "Maîtrise de l'IA (AI Act, art. 4)" })).toHaveCount(1);
    await list.filter({ hasText: "pourquoi Jobbbox n'est pas un système d'IA à haut risque" }).click();
    await expect(page).toHaveURL(new RegExp(`${note.path}$`));
    await expect(page.getByRole("main")).toContainText("Note interne datée du 2 novembre 2026");
    await expect(page.getByRole("main")).toContainText("AI Act, règlement (UE) 2024/1689");

    // Never public.
    const candidate = await personPage(browser, newAddress("back-office-help-558-candidate"));
    expect((await candidate.goto(note.path))?.status()).toBe(404);
    expect((await candidate.goto(`/aide/ia-et-conformite/${note.id}`))?.status()).toBe(404);
    const sitemap = await (await candidate.request.get("/sitemap.xml")).text();
    expect(sitemap).not.toContain(note.id);
    await candidate.context().close();
  });

  test("/admin/aide: the Back Office's topics, « Fournisseurs et Tools » first, its search and its articles, for Administrators only, never indexed", async ({ page, browser }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto("/admin");
    await page.getByRole("navigation", { name: admin.nav.label }).getByRole("link", { name: admin.nav.help }).click();
    await expect(page).toHaveURL(/\/admin\/aide$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(admin.help.title);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const topics = page.getByRole("heading", { level: 3 });
    await expect(topics.first()).toHaveText(admin.help.topics["fournisseurs-et-tools"].title);
    await expect(topics.last()).toHaveText(admin.help.topics["ia-et-conformite"].title);

    await page.getByLabel(admin.help.searchLabel).fill("questions sans réponse public");
    await page.getByRole("button", { name: admin.help.searchSubmit }).click();
    await expect(page.getByRole("status")).toContainText("« questions sans réponse public »");
    await page.getByRole("main").getByRole("link", { name: ARTICLE.title }).first().click();
    await expect(page).toHaveURL(new RegExp(`${ARTICLE.path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ARTICLE.title);
    await expect(page.getByRole("main")).toContainText("Demander un tutoriel");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    // A Candidate's article is no Back Office help page.
    expect((await page.goto("/admin/aide/utiliser/faq-text-size"))?.status()).toBe(404);

    // Anyone but an Administrator: a 404.
    const candidate = await personPage(browser, newAddress("back-office-help-candidate"));
    for (const path of ["/admin/aide", ARTICLE.path, "/admin/aide?q=public"]) {
      const response = await candidate.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(candidate.getByRole("heading", { level: 1 })).toHaveText(page404);
    }
    // Never public: not in the Help Centre, its search, nor the sitemap.
    expect((await candidate.goto(`/aide/contenu/${ARTICLE.id}`))?.status()).toBe(404);
    await candidate.goto("/aide?q=questions%20sans%20r%C3%A9ponse%20public");
    await expect(candidate.getByRole("main")).not.toContainText(ARTICLE.title);
    const sitemap = await (await candidate.request.get("/sitemap.xml")).text();
    expect(sitemap).not.toContain(ARTICLE.id);
    expect(sitemap).not.toContain("/admin/aide");
    await candidate.context().close();
  });

  test("« Fournisseurs et Tools » (#557): Paramètres, its Connexion, Sources and Extension tabs and Outils show their article « Sur cette page »; its 16 articles lead /admin/aide, never public", async ({ page, browser }) => {
    // Its own super-admin: a fresh conversation, so the assistant opens on its help.
    await signInWithMagicLink(page, "providers-help-office@e2e.jobbbox.test");
    const onThisPage = async (path: string, title: string) => {
      await page.goto(path);
      await openAssistant(page);
      const intro = assistant(page).locator(".help-intro");
      await expect(intro.getByRole("heading", { name: fr.coachPanel.help.onThisPage })).toBeVisible();
      await expect(intro.getByRole("button", { name: fr.coachPanel.help.readMoreAbout.replace("{{title}}", title) })).toBeVisible();
    };
    await onThisPage("/admin/parametres", "Paramètres");
    await onThisPage("/admin/parametres?tab=connexion", "Connexion");
    await onThisPage("/admin/parametres?tab=sources", "Sites et recherche web");
    await onThisPage("/admin/parametres?tab=extension", "Sites et recherche web");
    await onThisPage("/admin/outils", "Outils");

    // Suggested while typing, without AI, and opened as a card.
    await box(page).fill("remplacer une clé de fournisseur");
    const suggestion = assistant(page).getByRole("list", { name: fr.coachPanel.help.suggestions }).getByRole("button", { name: /Remplacer ou effacer une clé de fournisseur/ });
    await expect(suggestion).toBeVisible();

    // Given to the assistant, with its link to cite.
    const show = showSystemPrompt();
    await ask(page, `Comment remplacer une clé de fournisseur ? ${show}`);
    expect(await systemPromptShown(show)).toContain("### « Remplacer ou effacer une clé de fournisseur » (/admin/aide/fournisseurs-et-tools/tutorial-admin-provider-secret)");

    // /admin/aide: the topic comes first and lists its 17 articles.
    await page.goto("/admin/aide/fournisseurs-et-tools");
    const main = page.getByRole("main");
    const titles = [
      "Paramètres",
      "Outils",
      "Connexion",
      "Sites et recherche web",
      "Ajouter un fournisseur et le rendre actif",
      "Remplacer ou effacer une clé de fournisseur",
      "Changer le fournisseur ou le modèle d'une tâche IA",
      "Activer un destinataire hors UE",
      "Configurer un fournisseur de connexion, puis exiger le SSO",
      "Ajouter un site de l'extension ou une source de la recherche d'offres",
      "Activer l'enrichissement de contacts et son DPA",
      "Configurer Stripe et Brevo",
      "Charger une version de test de l'extension",
      "Pourquoi un outil est-il « En attente d'accès » ?",
      "Comment lire une raison d'échec ?",
      "Quel rôle change quoi dans les fournisseurs et les outils ?",
      "Que faire d'une variable d'environnement qui n'est plus lue ?",
    ];
    for (const title of titles) await expect(main.getByRole("link", { name: title, exact: true })).toBeVisible();
    await main.getByRole("link", { name: "Changer le fournisseur ou le modèle d'une tâche IA", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Changer le fournisseur ou le modèle d'une tâche IA");
    await expect(page.getByRole("main")).toContainText("Règle de résidence des données");

    // Never public: not in the Help Centre, its search, nor the sitemap.
    const candidate = await personPage(browser, newAddress("providers-help-candidate"));
    expect((await candidate.goto("/aide/fournisseurs-et-tools/tutorial-admin-provider-secret"))?.status()).toBe(404);
    await candidate.goto("/aide?q=remplacer%20une%20cl%C3%A9%20de%20fournisseur");
    await expect(candidate.getByRole("main")).not.toContainText("Remplacer ou effacer une clé de fournisseur");
    const sitemap = await (await candidate.request.get("/sitemap.xml")).text();
    expect(sitemap).not.toMatch(/(page|tutorial|faq)-admin-/);
    await candidate.context().close();
  });
});

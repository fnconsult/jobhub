import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #8: the ATS Score of a Master CV, split into Lisibilité and Mots-clés
// for the Profile's target role, and the ATS Fixes the AI Coach proposes as
// Action Cards, Senior Advice included, accepted or rejected one by one.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

/** Readable, lists every finance keyword but Trésorerie (only mentioned), and says the Candidate's age. */
const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière, 58 ans",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "J'ai piloté la trésorerie d'un groupe coté.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Budget et consolidation." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP", "Budget", "Consolidation", "Reporting", "Contrôle de gestion", "Clôture", "ERP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

const KEYWORD_FIX = "Ajoutez « Trésorerie » à vos compétences";
const SENIOR_ADVICE = "Conseil senior : retirez votre âge";

/** Signs a new Candidate in (Free Plan) with a Profile made of `masterCv`, and opens its ATS Score Section. Returns the Profile's id. */
async function openProfile(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/profils/${id}/ats-score`);
  return id;
}

const atsSection = (page: Page) => page.getByRole("region", { name: fr.atsScore.title });
const cards = (page: Page) => page.getByRole("region", { name: fr.actionCards.title });
/** The Profile page's Master CV (#137), and its "Version N · enregistrée le …". */
const masterCvOf = (page: Page) => page.getByRole("region", { name: fr.profile.masterCv });
const versionShown = (page: Page, version: number) => masterCvOf(page).getByText(new RegExp(`^Version ${version} · `));
/** Opens a Section of the Profile's page from the list beside it (ADR-0024). */
const openSection = (page: Page, name: string) =>
  page.getByRole("navigation", { name: fr.profilePage.sections.sectionsLabel }).getByRole("link", { name, exact: true }).click();
const S = fr.profilePage.sections;
/** The Profile's ATS Score Section proposes its fixes in its Propositions Section, where the Candidate is taken. */
const atPropositions = (page: Page, id: string) => expect(page).toHaveURL(`${origin}/profils/${id}/propositions`);

test.describe("ATS Score", () => {
  test("shows the score with its Lisibilité / Mots-clés breakdown and proposes the fixes as Action Cards", async ({ page }) => {
    const id = await openProfile(page, "ats-score");
    const section = atsSection(page);
    await expect(section).toContainText(fr.atsScore.notYet);

    await section.getByRole("button", { name: fr.atsScore.compute }).click();
    await atPropositions(page, id);
    const keywordFix = cards(page).getByRole("article", { name: KEYWORD_FIX });
    await expect(keywordFix).toContainText("Votre CV cite déjà « Trésorerie »");
    await expect(keywordFix.getByRole("button", { name: fr.actionCards.accept })).toBeVisible();
    await expect(keywordFix.getByRole("button", { name: fr.actionCards.dismiss })).toBeVisible();

    await openSection(page, S["ats-score"]);
    await expect(section.getByLabel("ATS Score : 97 sur 100")).toBeVisible();
    await expect(section.getByRole("term")).toHaveText([fr.atsScore.readability, fr.atsScore.keywords]);
    await expect(section.getByRole("definition").first()).toContainText("100/100");
    await expect(section.getByRole("definition").last()).toContainText("94/100");
    await expect(section.getByRole("list", { name: fr.atsScore.mentioned })).toHaveText("Trésorerie");
    await expect(section).toContainText("Calculé sur la version 1 de votre CV de référence.");
  });

  test("the proposed fixes come into view as soon as the score is computed, without a reload (#165)", async ({ page }) => {
    const id = await openProfile(page, "ats-in-view");
    const section = atsSection(page);
    // The cards are in another Section: the Candidate is taken there.
    await section.getByRole("button", { name: fr.atsScore.compute }).click();

    await atPropositions(page, id);
    const proposals = cards(page);
    // The Section's heading is said by the Top Bar (only screen readers hear it in the page, ADR-0024).
    await expect(proposals).toBeInViewport();
    await expect(proposals.getByRole("article").getByRole("heading")).toHaveText([KEYWORD_FIX, SENIOR_ADVICE]);
    await expect(proposals.getByRole("article", { name: KEYWORD_FIX })).toBeInViewport();

    // The same cards after a reload, and on the Profile's page itself, whose first Section they now are.
    await page.reload();
    await expect(cards(page).getByRole("article").getByRole("heading")).toHaveText([KEYWORD_FIX, SENIOR_ADVICE]);
    await page.goto(`/profils/${id}`);
    await expect(cards(page).getByRole("article").getByRole("heading")).toHaveText([KEYWORD_FIX, SENIOR_ADVICE]);

    // The score itself stays in its own Section.
    await openSection(page, S["ats-score"]);
    await expect(section.getByLabel("ATS Score : 97 sur 100")).toBeVisible();
  });

  test("Senior Advice is labelled as such, says it is optional, and can be dismissed without changing the CV", async ({ page }) => {
    const id = await openProfile(page, "ats-senior");
    await atsSection(page).getByRole("button", { name: fr.atsScore.compute }).click();
    await atPropositions(page, id);

    const advice = cards(page).getByRole("article", { name: SENIOR_ADVICE });
    await expect(advice).toContainText(fr.atsFixes.seniorAdvice);
    await expect(advice).toContainText("« , 58 ans » sera retiré.");
    await expect(advice).toContainText(fr.atsFixes.seniorAdviceOptional);
    await expect(cards(page).getByRole("article", { name: KEYWORD_FIX })).not.toContainText(fr.atsFixes.seniorAdvice);

    await advice.getByRole("button", { name: fr.atsFixes.dismissAdvice }).click();
    await expect(cards(page).getByRole("status")).toHaveText(fr.actionCards.dismissed);
    await expect(advice).toHaveCount(0);
    await page.reload();
    await expect(cards(page).getByRole("article", { name: KEYWORD_FIX })).toBeVisible();
    await expect(cards(page).getByRole("article", { name: SENIOR_ADVICE })).toHaveCount(0);
    await openSection(page, S["cv-de-reference"]);
    await expect(versionShown(page, 1)).toBeVisible();
  });

  test("each accepted fix creates a new Master CV version and the score is recomputed, without using the Plan Quota", async ({ page }) => {
    const id = await openProfile(page, "ats-accept");
    const section = atsSection(page);
    await section.getByRole("button", { name: fr.atsScore.compute }).click();
    await atPropositions(page, id);

    await cards(page).getByRole("article", { name: KEYWORD_FIX }).getByRole("button", { name: fr.actionCards.accept }).click();
    await expect(cards(page).getByRole("status")).toHaveText(fr.actionCards.accepted);
    await expect(cards(page).getByRole("article", { name: KEYWORD_FIX })).toHaveCount(0);
    // The Master CV follows the version the fix saved, and the score was computed on it.
    await openSection(page, S["cv-de-reference"]);
    await expect(versionShown(page, 2)).toBeVisible();
    await expect(masterCvOf(page).getByLabel(fr.profilePage.skills)).toHaveValue(/\nTrésorerie$/);
    await openSection(page, S["ats-score"]);
    await expect(section.getByLabel("ATS Score : 100 sur 100")).toBeVisible();
    await expect(section).toContainText("Calculé sur la version 2 de votre CV de référence.");

    // The last card accepted, Propositions is gone: the Profile's page shows its Master CV.
    await openSection(page, S.propositions);
    await cards(page).getByRole("article", { name: SENIOR_ADVICE }).getByRole("button", { name: fr.actionCards.accept }).click();
    await expect(page).toHaveURL(`${origin}/profils/${id}`);
    await expect(versionShown(page, 3)).toBeVisible();
    await expect(masterCvOf(page).getByLabel(fr.cvReview.headline)).toHaveValue("Directrice financière");
    await openSection(page, S["ats-score"]);
    await expect(section).toContainText("Calculé sur la version 3 de votre CV de référence.");

    // The Free Plan's one ATS Score of the month was the first computation: recomputing after fixes did not use it.
    await section.getByRole("button", { name: fr.atsScore.recompute }).click();
    await expect(section.getByRole("alert")).toContainText(fr.billing.quotaReached.title);
  });
});

/** Lists its skills on one line, decorates them, and counts its years of experience: readability fixes and Senior Advice. */
const clutteredCv = {
  ...masterCv,
  headline: "Directrice financière",
  summary: "Plus de 30 ans d'expérience en finance d'entreprise.",
  skills: ["IFRS, SAP, Budget, Consolidation", "★ Reporting", "Contrôle de gestion", "Clôture", "ERP", "Trésorerie"],
};

const SPLIT_FIX = "Séparez vos compétences";
const DECORATIONS_FIX = "Retirez les symboles décoratifs";
const YEARS_ADVICE = "Conseil senior : écrivez « Plus de 15 ans d'expérience »";

/** The ATS Score the page shows, read from its accessible label. */
async function shownScore(page: Page): Promise<number> {
  const label = await atsSection(page).getByLabel(/^ATS Score : \d+ sur 100$/).getAttribute("aria-label");
  return Number(label!.match(/(\d+) sur 100/)![1]);
}

test.describe("ATS Fixes, one by one", () => {
  test("rejecting a fix keeps the Master CV and the score; accepting another creates a version and raises the score", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("ats-one-by-one"));
    const created = await page.request.post("/api/profiles", {
      headers: { origin },
      data: { masterCv: clutteredCv, searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    await page.goto(`/profils/${id}/ats-score`);

    const section = atsSection(page);
    await section.getByRole("button", { name: fr.atsScore.compute }).click();
    await atPropositions(page, id);
    await openSection(page, S["ats-score"]);
    await expect(section.getByRole("term")).toHaveText([fr.atsScore.readability, fr.atsScore.keywords]);
    const before = await shownScore(page);
    expect(before).toBeLessThan(100);
    await expect(section.getByRole("listitem").filter({ hasText: fr.atsScore.checks.skillsList })).toContainText(fr.atsScore.failed);
    await openSection(page, S.propositions);

    // Readability fixes are ordinary Action Cards; only the Senior Advice says it is one.
    const split = cards(page).getByRole("article", { name: SPLIT_FIX });
    const decorations = cards(page).getByRole("article", { name: DECORATIONS_FIX });
    const years = cards(page).getByRole("article", { name: YEARS_ADVICE });
    await expect(split).toContainText("« IFRS, SAP, Budget, Consolidation » deviendra 4 compétences");
    await expect(decorations).toBeVisible();
    await expect(years).toContainText(fr.atsFixes.seniorAdvice);
    await expect(split).not.toContainText(fr.atsFixes.seniorAdvice);
    await expect(decorations).not.toContainText(fr.atsFixes.seniorAdvice);

    // Reject one: nothing else moves.
    await decorations.getByRole("button", { name: fr.actionCards.dismiss }).click();
    await expect(cards(page).getByRole("status")).toHaveText(fr.actionCards.dismissed);
    await expect(decorations).toHaveCount(0);
    await expect(split).toBeVisible();
    await expect(years).toBeVisible();
    await openSection(page, S["cv-de-reference"]);
    await expect(versionShown(page, 1)).toBeVisible();
    await expect(versionShown(page, 2)).toHaveCount(0);
    await openSection(page, S["ats-score"]);
    expect(await shownScore(page)).toBe(before);

    // Accept another: a new Master CV version, and the score is recomputed on it.
    await openSection(page, S.propositions);
    await split.getByRole("button", { name: fr.actionCards.accept }).click();
    await expect(cards(page).getByRole("status")).toHaveText(fr.actionCards.accepted);
    await expect(split).toHaveCount(0);
    await expect(years).toBeVisible();
    await openSection(page, S["cv-de-reference"]);
    await expect(versionShown(page, 2)).toBeVisible();
    await openSection(page, S["ats-score"]);
    await expect(section).toContainText("Calculé sur la version 2 de votre CV de référence.");
    await expect(section.getByRole("listitem").filter({ hasText: fr.atsScore.checks.skillsList })).toContainText(fr.atsScore.passed);
    await expect.poll(() => shownScore(page)).toBeGreaterThan(before);

    // The rejected fix stays rejected; the Senior Advice is still the Candidate's to decide.
    await openSection(page, S.propositions);
    await expect(cards(page).getByRole("article", { name: DECORATIONS_FIX })).toHaveCount(0);
    await expect(cards(page).getByRole("article", { name: YEARS_ADVICE })).toBeVisible();
    await openSection(page, S["cv-de-reference"]);
    await expect(versionShown(page, 2)).toBeVisible();
    await expect(masterCvOf(page).getByLabel(fr.profilePage.skills)).toHaveValue(/★ Reporting/);
  });
});

test.describe("ATS Score endpoint", () => {
  test("refuses anonymous visitors, other sites and someone else's Profile", async ({ page, browser }) => {
    const id = await openProfile(page, "ats-owner");
    expect((await page.request.post(`/api/profiles/${id}/ats-score`, { headers: { origin: "https://evil.example" } })).status()).toBe(403);

    const stranger = await browser.newPage({ baseURL: origin });
    expect((await stranger.request.post(`/api/profiles/${id}/ats-score`, { headers: { origin } })).status()).toBe(401);
    await signInWithMagicLink(stranger, newAddress("ats-stranger"));
    expect((await stranger.request.post(`/api/profiles/${id}/ats-score`, { headers: { origin } })).status()).toBe(404);
    await stranger.close();
  });
});

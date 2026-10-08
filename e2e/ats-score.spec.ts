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

/** Signs a new Candidate in (Free Plan) with a Profile made of `masterCv`, and opens it. Returns the Profile's id. */
async function openProfile(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/profils/${id}`);
  return id;
}

const atsSection = (page: Page) => page.getByRole("region", { name: fr.atsScore.title });
const cards = (page: Page) => page.getByRole("region", { name: fr.actionCards.title });

test.describe("ATS Score", () => {
  test("shows the score with its Lisibilité / Mots-clés breakdown and proposes the fixes as Action Cards", async ({ page }) => {
    await openProfile(page, "ats-score");
    const section = atsSection(page);
    await expect(section).toContainText(fr.atsScore.notYet);

    await section.getByRole("button", { name: fr.atsScore.compute }).click();

    await expect(section.getByLabel("ATS Score : 97 sur 100")).toBeVisible();
    await expect(section.getByRole("term")).toHaveText([fr.atsScore.readability, fr.atsScore.keywords]);
    await expect(section.getByRole("definition").first()).toContainText("100/100");
    await expect(section.getByRole("definition").last()).toContainText("94/100");
    await expect(section.getByRole("list", { name: fr.atsScore.mentioned })).toHaveText("Trésorerie");
    await expect(section).toContainText("Calculé sur la version 1 de votre CV de référence.");

    const keywordFix = cards(page).getByRole("article", { name: KEYWORD_FIX });
    await expect(keywordFix).toContainText("Votre CV cite déjà « Trésorerie »");
    await expect(keywordFix.getByRole("button", { name: fr.actionCards.accept })).toBeVisible();
    await expect(keywordFix.getByRole("button", { name: fr.actionCards.dismiss })).toBeVisible();
  });

  test("Senior Advice is labelled as such, says it is optional, and can be dismissed without changing the CV", async ({ page }) => {
    await openProfile(page, "ats-senior");
    await atsSection(page).getByRole("button", { name: fr.atsScore.compute }).click();

    const advice = cards(page).getByRole("article", { name: SENIOR_ADVICE });
    await expect(advice).toContainText(fr.atsFixes.seniorAdvice);
    await expect(advice).toContainText("« , 58 ans » sera retiré.");
    await expect(advice).toContainText(fr.atsFixes.seniorAdviceOptional);
    await expect(cards(page).getByRole("article", { name: KEYWORD_FIX })).not.toContainText(fr.atsFixes.seniorAdvice);

    await advice.getByRole("button", { name: fr.atsFixes.dismissAdvice }).click();
    await expect(cards(page).getByRole("status")).toHaveText(fr.actionCards.dismissed);
    await expect(advice).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Version 1", { exact: true })).toBeVisible();
    await expect(cards(page).getByRole("article", { name: SENIOR_ADVICE })).toHaveCount(0);
  });

  test("each accepted fix creates a new Master CV version and the score is recomputed, without using the Plan Quota", async ({ page }) => {
    await openProfile(page, "ats-accept");
    const section = atsSection(page);
    await section.getByRole("button", { name: fr.atsScore.compute }).click();
    await expect(section.getByLabel("ATS Score : 97 sur 100")).toBeVisible();

    await cards(page).getByRole("article", { name: KEYWORD_FIX }).getByRole("button", { name: fr.actionCards.accept }).click();
    await expect(cards(page).getByRole("status")).toHaveText(fr.actionCards.accepted);
    await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(section.getByLabel("ATS Score : 100 sur 100")).toBeVisible();
    await expect(section).toContainText("Calculé sur la version 2 de votre CV de référence.");

    await cards(page).getByRole("article", { name: SENIOR_ADVICE }).getByRole("button", { name: fr.actionCards.accept }).click();
    await expect(page.getByText("Version 3", { exact: true })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("58 ans");
    await expect(section).toContainText("Calculé sur la version 3 de votre CV de référence.");

    // The Free Plan's one ATS Score of the month was the first computation: recomputing after fixes did not use it.
    await section.getByRole("button", { name: fr.atsScore.recompute }).click();
    await expect(section.getByRole("alert")).toContainText(fr.billing.quotaReached.title);
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

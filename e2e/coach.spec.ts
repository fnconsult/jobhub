import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #5: a Candidate without a CV builds their Master CV with the AI Coach's
// Onboarding Questionnaire; the Coach Panel is on every page and knows the
// Profile in view; Action Cards are proposals the Candidate accepts or
// dismisses. The AI Coach is faked inside the server (fake-mistral.mjs): it
// replies with the Profile its system prompt has in view and the number of messages.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const q = fr.questionnaire.questions;

const MASTER_CV = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "" }],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

async function withDatabase<T>(use: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return await use(db);
  } finally {
    await db.end();
  }
}

/** Creates a Profile for the signed-in Candidate through the public endpoint; returns its id. */
async function createProfile(page: Page, targetRole: string): Promise<string> {
  const response = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv: { ...MASTER_CV, headline: targetRole }, searchCriteria: { targetRole, location: "Lyon" } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

/** What the AI Coach would do when it proposes an Action Card (no public endpoint creates one). */
async function proposeActionCard(email: string, profileId: string, title: string, body: string): Promise<string> {
  return withDatabase(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO action_card (candidate_id, kind, title, body, focus_kind, focus_id, payload)
       SELECT id, 'e2e_test', $2, $3, 'profile', $4, '{}' FROM candidate WHERE email = $1 RETURNING id`,
      [email, title, body, profileId],
    );
    return rows[0].id;
  });
}

const answerBox = (page: Page) => page.getByLabel(fr.questionnaire.answerLabel);
const transcript = (page: Page) => page.getByRole("list", { name: fr.questionnaire.transcript });

async function reply(page: Page, question: string, value: string | "skip" | "yes" | "no") {
  await expect(transcript(page).getByRole("listitem").last()).toContainText(question);
  if (value === "yes" || value === "no") await page.getByRole("button", { name: value === "yes" ? fr.questionnaire.yes : fr.questionnaire.no, exact: true }).click();
  else if (value === "skip") await page.getByRole("button", { name: fr.questionnaire.skip }).click();
  else {
    await answerBox(page).fill(value);
    await page.getByRole("button", { name: fr.questionnaire.send, exact: true }).click();
  }
}

const coachPanel = (page: Page) => page.getByRole("complementary", { name: fr.coachPanel.title });

async function askCoach(page: Page, text: string) {
  await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).fill(text);
  await coachPanel(page).getByRole("button", { name: fr.coachPanel.send }).click();
}

test.describe("onboarding with the AI Coach", () => {
  test("onboarding offers two paths: upload a CV, or answer the questionnaire", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("two-paths"));
    await expect(page.getByText(fr.profiles.none)).toBeVisible();
    await page.getByRole("link", { name: fr.profiles.create }).click();

    await expect(page).toHaveURL(`${origin}/profils/nouveau`);
    await expect(page).toHaveTitle(`${fr.newProfile.title} · ${fr.app.name}`);
    await expect(page.getByRole("heading", { level: 2, name: fr.newProfile.withCv })).toBeVisible();
    await expect(page.getByLabel(fr.cvUpload.fileLabel)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: fr.newProfile.withoutCv })).toBeVisible();
    await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();

    await expect(page.getByRole("heading", { level: 2, name: fr.questionnaire.title })).toBeVisible();
    await expect(transcript(page)).toContainText(fr.questionnaire.welcome);
    await expect(transcript(page).getByRole("listitem").last()).toContainText(q.fullName);
    await expect(answerBox(page)).toBeFocused();
  });

  test("a Candidate without a CV answers the questionnaire, reviews the Master CV it built, and saves it as their Profile", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("questionnaire"));
    await page.goto("/profils/nouveau");
    await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();

    // A name, a target role and a location are needed for a Profile.
    await page.getByRole("button", { name: fr.questionnaire.send, exact: true }).click();
    await expect(page.locator(".field-error[role=alert]")).toHaveText(fr.questionnaire.errors.required);
    await expect(page.getByRole("button", { name: fr.questionnaire.skip })).toHaveCount(0);

    await reply(page, q.fullName, "Marie Dupont");
    await reply(page, q.targetRole, "Directrice financière");
    await reply(page, q.location, "Lyon");
    await reply(page, q.email, "marie.dupont@example.fr");
    await reply(page, q.phone, "skip");
    await reply(page, q.jobTitle.replace("{{number}}", "1"), "Directrice financière");
    await reply(page, q.employer, "Groupe Seb");
    await reply(page, q.jobLocation, "Lyon");
    await reply(page, q.period, "2015 – 2024");
    await reply(page, q.jobDescription, "Pilotage financier d'un groupe de 2 000 personnes.");
    await reply(page, q.moreExperience, "yes");
    await reply(page, q.jobTitle.replace("{{number}}", "2"), "Responsable du contrôle de gestion");
    await reply(page, q.employer, "Renault");
    await reply(page, q.jobLocation, "Paris");
    await reply(page, q.period, "2005 – 2015");
    await reply(page, q.jobDescription, "skip");
    await reply(page, q.moreExperience, "no");
    await reply(page, q.degree.replace("{{number}}", "1"), "Master Finance");
    await reply(page, q.institution, "ESSEC");
    await reply(page, q.year, "1998");
    await expect(transcript(page)).toContainText(fr.questionnaire.skipped);
    await reply(page, q.moreEducation, "no");
    await reply(page, q.skills, "Consolidation, IFRS, SAP");
    await reply(page, q.languages, "Anglais : courant, Allemand : notions");
    await reply(page, q.summary, "Directrice financière, 25 ans d'expérience dans l'industrie.");

    // The same review form as for an uploaded CV, filled from the answers.
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
    await expect(page.getByText(fr.questionnaire.reviewIntro)).toBeVisible();
    const criteria = page.getByRole("group", { name: fr.cvReview.searchCriteria });
    await expect(criteria.getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveValue("Directrice financière");
    await expect(criteria.getByLabel(fr.cvReview.location, { exact: true })).toHaveValue("Lyon");
    await expect(page.getByLabel(fr.cvReview.fullName)).toHaveValue("Marie Dupont");
    await expect(page.getByLabel(fr.cvReview.email)).toHaveValue("marie.dupont@example.fr");
    await expect(page.getByRole("group", { name: "Poste 2" }).getByLabel(fr.cvReview.employer)).toHaveValue("Renault");
    await expect(page.getByRole("group", { name: "Formation 1" }).getByLabel(fr.cvReview.institution)).toHaveValue("ESSEC");
    const skills = page.getByRole("group", { name: fr.cvReview.skills, exact: true }).getByLabel(fr.cvReview.skill, { exact: true });
    await expect(skills).toHaveCount(3);
    expect(await skills.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(["Consolidation", "IFRS", "SAP"]);
    await expect(page.getByRole("group", { name: "Langue 2" }).getByLabel(fr.cvReview.level)).toHaveValue("notions");
    await page.getByLabel(fr.cvReview.contractType).selectOption({ label: fr.cvReview.contractTypes.cdi });
    await page.getByRole("button", { name: fr.cvReview.save }).click();

    // Saved as a Profile with version 1 of its Master CV, like an uploaded CV.
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice financière");
    await expect(page.getByText("Version 1")).toBeVisible();
    await expect(page.getByText("Marie Dupont", { exact: true })).toBeVisible();
    await expect(page.getByText("Directrice financière · Groupe Seb · Lyon · 2015 – 2024")).toBeVisible();
    await expect(page.getByText("Responsable du contrôle de gestion · Renault · Paris · 2005 – 2015")).toBeVisible();
    await expect(page.getByText("Master Finance · ESSEC · 1998")).toBeVisible();
    await expect(page.getByText("Allemand · notions")).toBeVisible();
    await expect(page.getByText("Directrice financière, 25 ans d'expérience dans l'industrie.")).toBeVisible();
  });

  test("the questionnaire and an uploaded CV produce the same Master CV structure", async ({ page }) => {
    /** Every field of the review form, by its accessible name, in order. */
    const reviewFields = async () => {
      await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
      return page.locator("form").filter({ has: page.getByRole("button", { name: fr.cvReview.save }) })
        .locator("input:not([type=hidden]), textarea, select")
        .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || el.getAttribute("aria-label") || ""));
    };

    await signInWithMagicLink(page, newAddress("same-structure"));
    await page.goto("/profils/nouveau");
    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv(MARIE_DUPONT_CV)) });
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();
    const fromUpload = await reviewFields();

    // One job, one degree, one language: as many entries as the uploaded CV was read into.
    await page.goto("/profils/nouveau");
    await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();
    await reply(page, q.fullName, "Marie Dupont");
    await reply(page, q.targetRole, "Directrice financière");
    await reply(page, q.location, "Lyon");
    await reply(page, q.email, "skip");
    await reply(page, q.phone, "skip");
    await reply(page, q.jobTitle.replace("{{number}}", "1"), "Directrice financière");
    await reply(page, q.employer, "Groupe Seb");
    await reply(page, q.jobLocation, "Lyon");
    await reply(page, q.period, "2015 – 2024");
    await reply(page, q.jobDescription, "Pilotage financier.");
    await reply(page, q.moreExperience, "no");
    await reply(page, q.degree.replace("{{number}}", "1"), "Master Finance");
    await reply(page, q.institution, "ESSEC");
    await reply(page, q.year, "1998");
    await reply(page, q.moreEducation, "no");
    await reply(page, q.skills, "Consolidation, IFRS");
    await reply(page, q.languages, "Anglais : courant");
    await reply(page, q.summary, "skip");
    const fromQuestionnaire = await reviewFields();

    expect(fromUpload.length).toBeGreaterThan(10);
    expect(fromQuestionnaire).toEqual(fromUpload);
  });

  test("the questionnaire uses catalogue strings and meets the ADR-0009 floor", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("questionnaire-floor"));
    await page.goto("/profils/nouveau");
    await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();
    await expect(answerBox(page)).toBeVisible();
    const allowed = new Set(catalogueStrings(fr));
    for (const t of await renderedTexts(page)) {
      expect.soft(allowed.has(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("the Coach Panel", () => {
  test("can be opened from any page and knows which Profile is in view", async ({ page }) => {
    const email = newAddress("panel");
    await signInWithMagicLink(page, email);
    const profileId = await createProfile(page, "Directrice financière");

    for (const path of ["/", "/compte", "/profils/nouveau", `/profils/${profileId}`]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: fr.coachPanel.open, exact: true }), `Coach Panel button on ${path}`).toBeVisible();
    }

    // On the account page, no Profile is in view.
    await page.goto("/compte");
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await expect(coachPanel(page)).toContainText(fr.coachPanel.welcome);
    await expect(coachPanel(page)).toContainText(fr.coachPanel.nothingInView);
    await expect(coachPanel(page).getByLabel(fr.coachPanel.messageLabel)).toBeFocused();
    await askCoach(page, "Bonjour");
    await expect(coachPanel(page)).toContainText("Je ne vois aucun profil. (1 message)");

    // The conversation follows the Candidate to the Profile page, which the AI Coach now sees.
    await page.getByRole("link", { name: "Directrice financière" }).click();
    await expect(page).toHaveURL(`${origin}/profils/${profileId}`);
    await expect(coachPanel(page)).toContainText("Vous consultez : le profil « Directrice financière »");
    await expect(coachPanel(page)).toContainText("Je ne vois aucun profil. (1 message)");
    await askCoach(page, "Que pensez-vous de mon CV ?");
    await expect(coachPanel(page)).toContainText("Je vois votre profil « Directrice financière ». (3 messages)");

    // Escape closes it and gives focus back to its button.
    await coachPanel(page).getByLabel(fr.coachPanel.messageLabel).press("Escape");
    await expect(coachPanel(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: fr.coachPanel.open, exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: fr.coachPanel.open, exact: true })).toHaveAttribute("aria-expanded", "false");
  });

  test("tells the Candidate when the AI Coach cannot reply, and gives their message back", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("panel-down"));
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await askCoach(page, "Bonjour E2E_AI_DOWN");

    await expect(coachPanel(page).getByRole("alert")).toHaveText(fr.coachPanel.errors.unavailable);
    await expect(coachPanel(page).getByLabel(fr.coachPanel.messageLabel)).toHaveValue("Bonjour E2E_AI_DOWN");
  });

  test("keeps answering past MAX_MESSAGES, from the most recent messages, and keeps the whole conversation on screen", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("panel-long"));
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    const messages = coachPanel(page).getByRole("list").getByRole("listitem");

    // 20 exchanges reach MAX_MESSAGES (40); the 21st and 22nd still get a reply.
    for (let n = 1; n <= 22; n++) {
      await askCoach(page, `message ${n}`);
      await expect(messages).toHaveCount(1 + 2 * n);
    }
    await expect(coachPanel(page).getByRole("alert")).toHaveCount(0);
    // The AI Coach was sent a window of at most 40 messages, starting with the Candidate's.
    await expect(messages.last()).toHaveText(/\((39|40) messages\)/);
    await expect(messages.nth(1)).toContainText("message 1");
  });

  test("is not shown to signed-out visitors", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: fr.coachPanel.open, exact: true })).toHaveCount(0);
  });

  test("meets the ADR-0009 floor", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("panel-floor"));
    await page.getByRole("button", { name: fr.coachPanel.open, exact: true }).click();
    await expect(coachPanel(page)).toBeVisible();
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("Action Cards", () => {
  test("the Candidate accepts or dismisses the AI Coach's proposals inside the Profile page", async ({ page }) => {
    const email = newAddress("cards");
    await signInWithMagicLink(page, email);
    const profileId = await createProfile(page, "Directrice financière");
    await proposeActionCard(email, profileId, "Ajoutez « SAP » à vos compétences", "Les offres de Directrice financière le demandent souvent.");
    await proposeActionCard(email, profileId, "Raccourcissez votre résumé", "Trois lignes suffisent.");

    await page.goto(`/profils/${profileId}`);
    const cards = page.getByRole("region", { name: fr.actionCards.title });
    const first = cards.getByRole("article", { name: "Ajoutez « SAP » à vos compétences" });
    const second = cards.getByRole("article", { name: "Raccourcissez votre résumé" });
    await expect(first).toContainText("Les offres de Directrice financière le demandent souvent.");

    await first.getByRole("button", { name: fr.actionCards.accept }).click();
    await expect(cards.getByRole("status")).toHaveText(fr.actionCards.accepted);
    await expect(first).toHaveCount(0);
    await second.getByRole("button", { name: fr.actionCards.dismiss }).click();
    await expect(cards.getByRole("status")).toHaveText(fr.actionCards.dismissed);
    await expect(second).toHaveCount(0);

    // Decided once and for all.
    await page.reload();
    await expect(page.getByRole("region", { name: fr.actionCards.title })).toHaveCount(0);
  });

  test("a Profile without proposals shows no Action Cards", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("no-cards"));
    const profileId = await createProfile(page, "DAF");
    await page.goto(`/profils/${profileId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAF");
    await expect(page.getByRole("region", { name: fr.actionCards.title })).toHaveCount(0);
  });
});

test.describe("Coach and Action Card endpoints", () => {
  test("refuse anonymous visitors and other sites, and never use or decide another Candidate's data", async ({ page, browser }) => {
    const conversation = { messages: [{ from: "candidate", text: "Bonjour" }] };
    expect((await page.request.post("/api/coach", { headers: { origin }, data: conversation })).status()).toBe(401);
    expect((await page.request.post("/api/action-cards/00000000-0000-4000-8000-000000000000", { headers: { origin }, data: { decision: "accept" } })).status()).toBe(401);

    const email = newAddress("endpoint-owner");
    await signInWithMagicLink(page, email);
    const profileId = await createProfile(page, "Directrice financière");
    const cardId = await proposeActionCard(email, profileId, "Une proposition", "Détail.");
    expect((await page.request.post("/api/coach", { headers: { origin: "https://evil.example" }, data: conversation })).status()).toBe(403);
    expect((await page.request.post(`/api/action-cards/${cardId}`, { headers: { origin: "https://evil.example" }, data: { decision: "accept" } })).status()).toBe(403);
    expect((await page.request.post("/api/coach", { headers: { origin }, data: { messages: [] } })).status()).toBe(400);
    expect((await page.request.post(`/api/action-cards/${cardId}`, { headers: { origin }, data: { decision: "maybe" } })).status()).toBe(400);

    const other = await browser.newContext({ baseURL: origin });
    const otherPage = await other.newPage();
    await signInWithMagicLink(otherPage, newAddress("endpoint-other"));
    const peek = await otherPage.request.post("/api/coach", { headers: { origin }, data: { ...conversation, focus: { kind: "profile", id: profileId } } });
    expect(await peek.json()).toEqual({ reply: "Je ne vois aucun profil. (1 message)" });
    // An Application in view is accepted too; none exists yet, so nothing is in view.
    const application = await page.request.post("/api/coach", { headers: { origin }, data: { ...conversation, focus: { kind: "application", id: "00000000-0000-4000-8000-000000000000" } } });
    expect(application.status()).toBe(200);
    expect(await application.json()).toEqual({ reply: "Je ne vois aucun profil. (1 message)" });
    expect((await page.request.post("/api/coach", { headers: { origin }, data: { ...conversation, focus: { kind: "offer", id: profileId } } })).status()).toBe(400);
    expect((await otherPage.request.post(`/api/action-cards/${cardId}`, { headers: { origin }, data: { decision: "dismiss" } })).status()).toBe(404);
    await other.close();

    expect((await page.request.post(`/api/action-cards/${cardId}`, { headers: { origin }, data: { decision: "accept" } })).status()).toBe(200);
    expect((await page.request.post(`/api/action-cards/${cardId}`, { headers: { origin }, data: { decision: "accept" } })).status()).toBe(409);
  });
});

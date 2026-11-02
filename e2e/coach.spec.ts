import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { placeNames } from "./support/locations";
import { newAddress } from "./support/mailbox";
import { toConversation } from "./support/conversation";

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
    data: { masterCv: { ...MASTER_CV, headline: targetRole }, searchCriteria: { targetRole, locations: ["Lyon"] } },
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

const coachPanel = (page: Page) => page.getByRole("region", { name: fr.conversationFirst.label });

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
    await expect(placeNames(criteria)).toHaveText(["Lyon"]);
    await expect(page.getByLabel(fr.cvReview.fullName)).toHaveValue("Marie Dupont");
    await expect(page.getByLabel(fr.cvReview.email)).toHaveValue("marie.dupont@example.fr");
    await expect(page.getByRole("group", { name: "Poste 2" }).getByLabel(fr.cvReview.employer)).toHaveValue("Renault");
    await expect(page.getByRole("group", { name: "Formation 1" }).getByLabel(fr.cvReview.institution)).toHaveValue("ESSEC");
    const skills = page.getByRole("group", { name: fr.cvReview.skills, exact: true }).getByLabel(fr.cvReview.skill, { exact: true });
    await expect(skills).toHaveCount(3);
    expect(await skills.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(["Consolidation", "IFRS", "SAP"]);
    await expect(page.getByRole("group", { name: "Langue 2" }).getByLabel(fr.cvReview.level)).toHaveValue("notions");
    await page.getByRole("group", { name: fr.cvReview.contractType }).getByRole("checkbox", { name: fr.cvReview.contractTypes.cdi }).check();
    await page.getByRole("button", { name: fr.cvReview.save }).click();

    // Saved as a Profile with version 1 of its Master CV, like an uploaded CV.
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice financière");
    // Its Master CV, a Section opened in the Work Pane beside the Profile's conversation (#605).
    const profilePath = new URL(page.url()).pathname;
    await page.goto(`${profilePath}/cv-de-reference`);
    await expect(page.locator("aside.work-pane").getByRole("region", { name: fr.profile.masterCv }).getByText(/^Version 1 · /)).toBeVisible();
    // The whole Master CV, as its version page shows it.
    await page.goto(`${profilePath}/versions/1`);
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
    // The Usage Meter's percentage, a catalogue string with the week's number in it.
    allowed.add(fr.usageMeter.percent.replace("{{percent}}", "0"));
    for (const t of await renderedTexts(page)) {
      expect.soft(allowed.has(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("the AI Coach in the pages' conversations", () => {
  test("each page is its own conversation, which knows which Profile is in view (#601, #605, #608)", async ({ page }) => {
    const email = newAddress("panel");
    await signInWithMagicLink(page, email);
    const profileId = await createProfile(page, "Directrice financière");

    // No « Aide et coach » left on the Candidate's pages.
    for (const path of ["/", "/compte", "/profils/nouveau", `/profils/${profileId}`]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: fr.coachPanel.open, exact: true }), `no Coach Panel button on ${path}`).toHaveCount(0);
    }

    // The home page's new conversation: no Profile in view.
    await page.goto("/");
    await expect(coachPanel(page)).toContainText(fr.coachPanel.aiDisclosure);
    await expect(coachPanel(page)).toContainText(fr.coachPanel.nothingInView);
    await askCoach(page, "Bonjour");
    await expect(coachPanel(page)).toContainText("Je ne vois aucun profil. (1 message)");

    // The Profile's page is the Profile's own conversation, which the AI Coach sees.
    await page.goto(`/profils/${profileId}`);
    await expect(coachPanel(page)).toContainText("Vous consultez : le profil « Directrice financière »");
    await expect(coachPanel(page)).not.toContainText("Je ne vois aucun profil.");
    await askCoach(page, "Que pensez-vous de mon CV ?");
    await expect(coachPanel(page)).toContainText("Je vois votre profil « Directrice financière ». (1 message)");
  });

  test("tells the Candidate when the AI Coach cannot reply, and gives their message back", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("panel-down"));
    await toConversation(page);
    await askCoach(page, "Bonjour E2E_AI_DOWN");

    // Why, by its Failure Reason in words (#328): never the provider's technical message.
    await expect(coachPanel(page).getByRole("alert")).toHaveText(fr.coachPanel.failed.replace("{{reason}}", fr.failureReasons.provider_unavailable));
    await expect(coachPanel(page).getByLabel(fr.coachPanel.messageLabel)).toHaveValue("Bonjour E2E_AI_DOWN");
  });

  test("keeps answering past MAX_MESSAGES, from the most recent messages, and keeps the whole conversation on screen", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("panel-long"));
    await toConversation(page);
    const messages = coachPanel(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");

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

  test("keeps a page's conversation after a reload; a Free conversation is listed under « Coach » (#601, #605)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("panel-saved"));
    const profileId = await createProfile(page, "Directrice financière");
    const messages = coachPanel(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");

    // The Profile's conversation.
    await page.goto(`/profils/${profileId}`);
    await askCoach(page, "Mon CV est-il bon ?");
    await expect(messages.last()).toHaveText(/Je vois votre profil « Directrice financière »\. \(1 message\)/);

    // Saved: a reload keeps it.
    await page.reload();
    await expect(messages).toHaveCount(3);
    await askCoach(page, "Et ma formation ?");
    await expect(messages.last()).toHaveText(/\(3 messages\)/);

    // A Free conversation, from the home page: no Profile in view, and listed under « Coach » in the Sidebar.
    await page.goto("/");
    await expect(messages).toHaveCount(1);
    await askCoach(page, "Comment préparer un entretien ?");
    await expect(messages.last()).toHaveText(/Je ne vois aucun profil\. \(1 message\)/);
    await expect(page).toHaveURL(/\/conversations\/[0-9a-f-]{36}$/);
    const sidebar = page.locator(".sidebar-docked");
    await expect(sidebar.getByRole("link", { name: "Comment préparer un entretien ?" })).toHaveAttribute("aria-current", "page");
    // The Profile's conversation is the Profile's page's, never listed among the Free ones.
    await expect(sidebar.getByRole("link", { name: "Mon CV est-il bon ?" })).toHaveCount(0);
  });

  test("a conversation is kept 12 months after its last message, then the worker's nightly purge deletes it", async ({ page }) => {
    /** The worker's purge, run as its schedule would `days` from now. */
    const purgeIn = (days: number) => {
      const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "coach-conversations.purge", String(days * 24)], {
        env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
        encoding: "utf8",
      });
      expect(run.status, run.stderr).toBe(0);
    };
    await signInWithMagicLink(page, newAddress("panel-purge"));
    const sent = await page.request.post("/api/coach", { headers: { origin }, data: { message: "Bonjour" } });
    const { conversation } = await sent.json();

    purgeIn(360);
    expect((await page.request.get(`/api/coach/conversations/${conversation.id}`)).status()).toBe(200);

    purgeIn(370);
    expect((await page.request.get(`/api/coach/conversations/${conversation.id}`)).status()).toBe(404);
    expect((await (await page.request.get("/api/coach/conversations")).json()).conversations).toEqual([]);

    // The Coach Panel then starts a new conversation.
    await toConversation(page);
    await expect(coachPanel(page).getByRole("heading", { level: 3, name: fr.coachPanel.newConversation })).toBeVisible();
  });

  test("is not shown to signed-out visitors", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: fr.coachPanel.open, exact: true })).toHaveCount(0);
  });

  test("meets the ADR-0009 floor", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("panel-floor"));
    await toConversation(page);
    await expect(coachPanel(page)).toBeVisible();
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// Issue #127: each AI Coach reply is saved with its tokens and estimated € cost;
// the back office shows the median and p90 cost per reply, per day (Paris time).
test.describe("AI Coach cost", () => {
  // Its own Administrator, so its sign-in never crosses another spec's.
  const ADMINISTRATOR = "cost-office@e2e.jobbbox.test";

  test("an Administrator sees today's median and p90 cost per AI Coach reply, and who answered", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("coach-cost"));
    const sent = await page.request.post("/api/coach", { headers: { origin }, data: { message: "Combien coûte ma question ?" } });
    expect(sent.status(), await sent.text()).toBe(200);
    // What the Candidate gets back says nothing of the cost: its Provenance (#327) carries the tokens, a technical measure, never euros.
    const body = await sent.json();
    expect(JSON.stringify(body)).not.toMatch(/cost|eur/i);
    expect(body.provenance.steps.at(-1)).toMatchObject({ task: "coaching", model: "mistral-large-latest", tokens: { input: 100, output: 50 } });

    const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
    const admin = await context.newPage();
    await signInWithMagicLink(admin, ADMINISTRATOR);
    await admin.goto("/admin");
    await admin.getByRole("link", { name: fr.admin.sections.coachCost }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(fr.admin.coachCost.title);

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
    const row = admin.getByRole("row").filter({ has: admin.locator(`time[datetime="${today}"]`) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("mistral mistral-large-latest");
    // The fake Mistral answers each call with 100 tokens in and 50 out: $0.000125 at Mistral Large's list price.
    // With Coaching Playbooks served, a reply takes the choice of Playbook Agents (none here) and the reply itself (#225),
    // and the Guardrails' check on the message and on the reply (#228): four calls.
    await expect(row.getByRole("cell").nth(1)).toHaveText(/0,0004\s?€/);
    await context.close();
  });

  test("is hidden from Candidates", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("coach-cost-curious"));
    expect((await page.goto("/admin/cout-coach"))?.status()).toBe(404);
  });
});

test.describe("Action Cards", () => {
  test("the Candidate accepts or dismisses the AI Coach's proposals inside the Profile page", async ({ page }) => {
    const email = newAddress("cards");
    await signInWithMagicLink(page, email);
    const profileId = await createProfile(page, "Directrice financière");
    await proposeActionCard(email, profileId, "Ajoutez « SAP » à vos compétences", "Les offres de Directrice financière le demandent souvent.");
    await proposeActionCard(email, profileId, "Raccourcissez votre résumé", "Trois lignes suffisent.");

    // Propositions, a Section of the Profile, in the Work Pane beside its conversation (#605).
    await page.goto(`/profils/${profileId}/propositions`);
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
    await page.goto(`/profils/${profileId}/propositions`);
    await expect(page.getByRole("article", { name: "Ajoutez « SAP » à vos compétences" })).toHaveCount(0);
    await expect(page.getByRole("article", { name: "Raccourcissez votre résumé" })).toHaveCount(0);
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
    const message = { message: "Bonjour" };
    expect((await page.request.post("/api/coach", { headers: { origin }, data: message })).status()).toBe(401);
    expect((await page.request.get("/api/coach/conversations")).status()).toBe(401);
    expect((await page.request.post("/api/action-cards/00000000-0000-4000-8000-000000000000", { headers: { origin }, data: { decision: "accept" } })).status()).toBe(401);

    const email = newAddress("endpoint-owner");
    await signInWithMagicLink(page, email);
    const profileId = await createProfile(page, "Directrice financière");
    const cardId = await proposeActionCard(email, profileId, "Une proposition", "Détail.");
    expect((await page.request.post("/api/coach", { headers: { origin: "https://evil.example" }, data: message })).status()).toBe(403);
    expect((await page.request.post(`/api/action-cards/${cardId}`, { headers: { origin: "https://evil.example" }, data: { decision: "accept" } })).status()).toBe(403);
    expect((await page.request.post("/api/coach", { headers: { origin }, data: { message: "  " } })).status()).toBe(400);
    expect((await page.request.post(`/api/action-cards/${cardId}`, { headers: { origin }, data: { decision: "maybe" } })).status()).toBe(400);

    // Marie's conversation, started on her Profile.
    const started = await page.request.post("/api/coach", { headers: { origin }, data: { ...message, focus: { kind: "profile", id: profileId } } });
    expect(started.status()).toBe(200);
    const { conversation, reply } = await started.json();
    expect(reply).toBe("Je vois votre profil « Directrice financière ». (1 message)");
    expect(conversation).toMatchObject({ title: "Bonjour", profile: { id: profileId, name: "Directrice financière" } });
    expect((await page.request.patch(`/api/coach/conversations/${conversation.id}`, { headers: { origin: "https://evil.example" }, data: { title: "X" } })).status()).toBe(403);
    expect((await page.request.delete(`/api/coach/conversations/${conversation.id}`, { headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect((await page.request.patch(`/api/coach/conversations/${conversation.id}`, { headers: { origin }, data: { title: " " } })).status()).toBe(400);

    const other = await browser.newContext({ baseURL: origin });
    const otherPage = await other.newPage();
    await signInWithMagicLink(otherPage, newAddress("endpoint-other"));
    const peek = await otherPage.request.post("/api/coach", { headers: { origin }, data: { ...message, focus: { kind: "profile", id: profileId } } });
    expect(await peek.json()).toMatchObject({ reply: "Je ne vois aucun profil. (1 message)", conversation: { profile: null } });
    // Marie's Coach Conversations are hers alone.
    expect((await otherPage.request.get(`/api/coach/conversations/${conversation.id}`)).status()).toBe(404);
    expect((await otherPage.request.post("/api/coach", { headers: { origin }, data: { ...message, conversationId: conversation.id } })).status()).toBe(404);
    expect((await otherPage.request.patch(`/api/coach/conversations/${conversation.id}`, { headers: { origin }, data: { title: "À moi" } })).status()).toBe(404);
    expect((await otherPage.request.delete(`/api/coach/conversations/${conversation.id}`, { headers: { origin } })).status()).toBe(404);
    expect((await (await otherPage.request.get("/api/coach/conversations")).json()).conversations).toHaveLength(1);
    // An Application in view is accepted too; none exists yet, so nothing is in view.
    const application = await page.request.post("/api/coach", { headers: { origin }, data: { ...message, focus: { kind: "application", id: "00000000-0000-4000-8000-000000000000" } } });
    expect(application.status()).toBe(200);
    expect((await application.json()).reply).toBe("Je ne vois aucun profil. (1 message)");
    // So are a Job Offer, Job Search or Job Digest in view (#126); a page naming its Profile attaches a new conversation to it.
    for (const kind of ["job_offer", "job_search", "job_digest"]) {
      const inView = await page.request.post("/api/coach", { headers: { origin }, data: { ...message, focus: { kind, id: "00000000-0000-4000-8000-000000000000", profileId } } });
      expect(inView.status(), kind).toBe(200);
      expect((await inView.json()).conversation.profile, kind).toEqual({ id: profileId, name: "Directrice financière" });
    }
    expect((await page.request.post("/api/coach", { headers: { origin }, data: { ...message, focus: { kind: "offer", id: profileId } } })).status()).toBe(400);
    expect((await otherPage.request.post(`/api/action-cards/${cardId}`, { headers: { origin }, data: { decision: "dismiss" } })).status()).toBe(404);
    await other.close();

    expect((await page.request.get(`/api/coach/conversations/${conversation.id}`)).status()).toBe(200);
    expect((await page.request.post(`/api/action-cards/${cardId}`, { headers: { origin }, data: { decision: "accept" } })).status()).toBe(200);
    expect((await page.request.post(`/api/action-cards/${cardId}`, { headers: { origin }, data: { decision: "accept" } })).status()).toBe(409);
  });

  test("give a Subject's one conversation, none until its first message, and only for the Candidate's own Subjects (#600, ADR-0070)", async ({ page, browser }) => {
    const ofSubject = (on: Page, kind: string, id: string) => on.request.get(`/api/coach/conversations?kind=${kind}&id=${encodeURIComponent(id)}`);
    expect((await ofSubject(page, "menu", "agenda")).status()).toBe(401);
    await signInWithMagicLink(page, newAddress("subject-owner"));
    const profileId = await createProfile(page, "Directrice financière");
    const subject = { kind: "profile", id: profileId };

    expect(await (await ofSubject(page, "profile", profileId)).json()).toEqual({ conversation: null });
    const first = await page.request.post("/api/coach", { headers: { origin }, data: { subject, message: "Mon CV ?" } });
    expect(first.status()).toBe(200);
    const { conversation } = await first.json();
    expect(conversation).toMatchObject({ subject: { kind: "profile", id: profileId, name: "Directrice financière" }, profile: { id: profileId } });
    expect((await page.request.post("/api/coach", { headers: { origin }, data: { subject, message: "Et ensuite ?" } })).status()).toBe(200);
    expect((await (await ofSubject(page, "profile", profileId)).json()).conversation).toMatchObject({ id: conversation.id, messages: { length: 4 } });
    expect((await (await page.request.get("/api/coach/conversations")).json()).conversations).toHaveLength(1);
    // A menu is one conversation per Candidate; a key that is no menu is refused, and so is a message to a conversation and a Subject at once.
    expect(await (await ofSubject(page, "menu", "agenda")).json()).toEqual({ conversation: null });
    expect((await ofSubject(page, "menu", "account")).status()).toBe(400);
    expect((await page.request.post("/api/coach", { headers: { origin }, data: { subject, conversationId: conversation.id, message: "Les deux ?" } })).status()).toBe(400);

    const other = await browser.newContext({ baseURL: origin });
    const otherPage = await other.newPage();
    await signInWithMagicLink(otherPage, newAddress("subject-other"));
    expect((await ofSubject(otherPage, "profile", profileId)).status()).toBe(404);
    expect((await otherPage.request.post("/api/coach", { headers: { origin }, data: { subject, message: "Je lis ?" } })).status()).toBe(404);
    await other.close();
  });
});

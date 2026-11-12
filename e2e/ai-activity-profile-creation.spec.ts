import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { activityOf, openActivity, unfoldedEntryOf } from "./support/conversation";

// Issue #810 (ADR-0086, ADR-0070): a Profile's creation is one Activité entry, « Création du profil », on `/profils/nouveau`
// and then on the new Profile's page: the CV read (its Provenance, the only AI), the Onboarding Questionnaire (« Questions
// écrites par Jobbbox », « Sans IA », its answers), the review, « Profil créé » with Version 1, and Version 1's ATS Score.
// What the browser alone knows (the questionnaire, the review) is gone once the page is loaded again; the entry is made
// again from what is kept. The Context bar says « Le coach n'a pas encore répondu » until the coach's first reply. The AI is
// faked inside the server (fake-mistral.mjs): "E2E_CV_SLOW" in the CV makes its reading take 30 s.
const expect = baseExpect.configure({ timeout: 15_000 });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const kinds = fr.aiActivity.kinds;
const history = fr.aiActivity.history;
const origin = process.env.E2E_WEB_ORIGIN!;

const nowOf = (page: Page) => activityOf(page).locator(".ai-activity-live");
const contextBarOf = (page: Page) => activityOf(page).getByRole("region", { name: fr.contextBar.title });
/** « Création du profil », unfolded: its parts by their kind, in their order. */
async function creationOf(page: Page) {
  const entry = await unfoldedEntryOf(page, new RegExp(`^${kinds.profile_creation}$`));
  return { entry, parts: entry.getByRole("list", { name: history.parts }).locator("> li") };
}
const q = fr.questionnaire.questions;
const transcript = (page: Page) => page.getByRole("list", { name: fr.questionnaire.transcript });

/** Answers the Onboarding Questionnaire's `question`, once it is asked: in the box, or « Passer ». */
async function reply(page: Page, question: string, value: string | "skip") {
  await expect(transcript(page).getByRole("listitem").last()).toContainText(question);
  if (value === "skip") await page.getByRole("button", { name: fr.questionnaire.skip }).click();
  else {
    await page.getByLabel(fr.questionnaire.answerLabel).fill(value);
    await page.getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
  }
}
const partKinds = (parts: Locator) => parts.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.kind));

test.describe("« Création du profil » in Activity (#810)", () => {
  // Wide enough for the Activité column beside the conversation, and the Fiche beside a Section in the Work Pane.
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("a CV uploaded: « En ce moment » shows its reading, then the history « Création du profil » with its parts, before and after a reload", async ({ page }) => {
    test.setTimeout(150_000);
    await signInWithMagicLink(page, newAddress("activity-profile-creation-cv"));
    await page.goto("/profils/nouveau");
    await page.waitForLoadState("networkidle");
    await openActivity(page);
    await expect(contextBarOf(page)).toContainText(fr.contextBar.noReply);
    await expect(activityOf(page)).toContainText(history.empty);

    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv([...MARIE_DUPONT_CV, "Divers", "E2E_CV_SLOW"])) });
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();
    // « En ce moment »: the reading, live.
    await expect(nowOf(page)).toContainText(kinds.cv_reading);
    await expect(nowOf(page)).toContainText(fr.aiActivity.steps.read);

    // Read: the review in the Work Pane; the history's one entry, the reading and the review.
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible({ timeout: 60_000 });
    await openActivity(page);
    const before = await creationOf(page);
    await expect(before.entry.locator(".activity-entry-row")).toContainText(history.results.creating);
    expect(await partKinds(before.parts)).toEqual(["cv_reading", "review"]);
    await expect(before.parts.first()).toContainText("Mistral");

    await page.getByRole("button", { name: fr.cvReview.save }).click();
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    // On the Profile's page: the review still known, « Profil créé » with Version 1; the Context bar still empty.
    await openActivity(page);
    const saved = await creationOf(page);
    await expect(saved.entry.locator(".activity-entry-row")).toContainText(history.results.created.replace("{{version}}", "1"));
    expect(await partKinds(saved.parts)).toEqual(["cv_reading", "review", "profile_created"]);
    await expect(saved.entry.getByRole("link", { name: history.open.profile_creation })).toHaveAttribute("href", `/profils/${id}`);
    await expect(contextBarOf(page)).toContainText(fr.contextBar.noReply);

    // Its first ATS Score, then a reload: made again from what is kept, the review no longer known.
    const scored = await page.request.post(`/api/profiles/${id}/ats-score`, { headers: { origin } });
    expect(scored.ok(), await scored.text()).toBe(true);
    await page.reload();
    await openActivity(page);
    const reloaded = await creationOf(page);
    expect(await partKinds(reloaded.parts)).toEqual(["cv_reading", "profile_created", "ats_score"]);
    await expect(reloaded.parts.first()).toContainText("Mistral");
    await expect(reloaded.parts.last()).toContainText(/\d+\/100/);
    // Version 1 and its ATS Score are no entries of their own.
    await expect(activityOf(page).locator(".activity-entry-title").getByText(kinds.ats_score, { exact: true })).toHaveCount(0);
    await expect(activityOf(page).locator(".activity-entry-title").getByText(kinds.master_cv, { exact: true })).toHaveCount(0);
  });

  test("the Onboarding Questionnaire: two answers counted, « Questions écrites par Jobbbox », « Sans IA », then saved, gone after a reload", async ({ page }) => {
    test.setTimeout(120_000);
    await signInWithMagicLink(page, newAddress("activity-profile-creation-questionnaire"));
    await page.goto("/profils/nouveau");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: fr.newProfile.startQuestionnaire }).click();
    // Two answers: « Création du profil » counts them, the questions written by Jobbbox, without AI.
    await reply(page, q.fullName, "Marie Dupont");
    await reply(page, q.targetRole, "Directrice financière");
    await expect(transcript(page).getByRole("listitem").last()).toContainText(q.location);
    await openActivity(page);
    const answering = await creationOf(page);
    expect(await partKinds(answering.parts)).toEqual(["questionnaire"]);
    await expect(answering.parts.first()).toContainText(`${history.writtenByJobbbox} · ${history.results.answered_other.replace("{{count}}", "2")} · ${history.cost.noAi}`);

    // The third answer a Profile needs; every other question skipped.
    await reply(page, q.location, "Lyon");
    for (const question of [q.email, q.phone, q.jobTitle.replace("{{number}}", "1"), q.degree.replace("{{number}}", "1"), q.skills, q.languages, q.summary]) await reply(page, question, "skip");
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
    await page.getByRole("button", { name: fr.cvReview.save }).click();
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);

    await openActivity(page);
    const saved = await creationOf(page);
    expect(await partKinds(saved.parts)).toEqual(["questionnaire", "review", "profile_created"]);
    await expect(saved.parts.first()).toContainText(`${history.results.answered_other.replace("{{count}}", "3")} · ${history.results.skipped_other.replace("{{count}}", "7")}`);
    await expect(saved.entry.locator(".activity-entry-row")).toContainText(history.cost.noAi);

    await page.reload();
    await openActivity(page);
    expect(await partKinds((await creationOf(page)).parts)).toEqual(["profile_created"]);
  });
});

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { docxCv, MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { placeInput, placeNames, placeOptions, removePlace } from "./support/locations";
import { newAddress } from "./support/mailbox";
import { activityButtonOf, openSearchCriteria, profileSectionLink, unfoldedEntryOf } from "./support/conversation";
import { onboardingSummary, openReviewDetail, throughCvInterview } from "./support/onboarding-summary";

// Issue #4: a signed-in Candidate uploads a PDF or Word CV; it is read into a
// Master CV and Search Criteria they review and correct, then saved as their
// first Profile. The AI provider is faked inside the server (fake-mistral.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Uploads a CV on /profils/nouveau and, once read (`review`), goes through the interview from it (#1003) and opens the
 * review form.
 */
async function uploadCv(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, review = true) {
  await page.goto("/profils/nouveau");
  await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(file);
  await page.getByRole("button", { name: fr.cvUpload.submit }).click();
  if (!review) return;
  // The target role and place read, confirmed, the rest skipped (#1003); the summary (#1004), then the review form by « Voir le détail ».
  await throughCvInterview(page);
  await openReviewDetail(page);
}

/** The Search Criteria part of the review form. */
const criteriaOf = (page: Page) => page.getByRole("group", { name: fr.cvReview.searchCriteria });

const pdfFile = (lines: string[], name = "CV Marie Dupont.pdf") => ({ name, mimeType: PDF, buffer: Buffer.from(pdfCv(lines)) });

test.describe("creating the first Profile from a CV", () => {
  test("a new Candidate uploads a PDF CV, corrects what was read, and saves it as their first Profile", async ({ page, browser }) => {
    await signInWithMagicLink(page, newAddress("upload"));
    await expect(page.getByText(fr.profiles.none)).toBeVisible();
    await page.getByRole("link", { name: fr.profiles.create }).click();
    await expect(page).toHaveURL(`${origin}/profils/nouveau`);
    await expect(page).toHaveTitle(`${fr.newProfile.title} · ${fr.app.name}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.newProfile.title);

    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(pdfFile(MARIE_DUPONT_CV));
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();

    // The reading shows in Activité (#1003), opened by itself on a wide screen; the thread says so in one line, no card.
    const thread = page.getByRole("list", { name: fr.questionnaire.transcript });
    await expect(thread.getByText(fr.newProfile.fromCv.reading)).toBeVisible();
    await expect(activityButtonOf(page)).toHaveAttribute("aria-expanded", "true");
    await expect(thread.getByRole("list", { name: fr.newProfile.fromCv.building })).toHaveCount(0);
    // Read: « Création du profil »'s part « Lecture du CV » with the fields read, one absent said absent.
    await expect(thread.getByText(fr.newProfile.fromCv.questionsStart)).toBeVisible();
    const reading = (await unfoldedEntryOf(page, new RegExp(`^${fr.aiActivity.kinds.profile_creation}$`))).locator('[data-kind="cv_reading"]');
    await expect(reading.getByRole("definition").filter({ hasText: "Directrice financière (lu par l'IA)" })).toBeVisible();
    await expect(reading.getByRole("definition").filter({ hasText: fr.newProfile.fromCv.missing })).toHaveCount(2);
    // Then the interview from what it read: the target role and the place to confirm, no question on what the CV gave;
    // then only contracts (a deduction proposed), remote work and salary, each skippable.
    const suggestions = page.getByRole("group", { name: fr.conversationFirst.suggestions });
    await expect(suggestions.getByRole("button", { name: fr.questionnaire.skip, exact: true })).toHaveCount(0);
    await suggestions.getByRole("button", { name: "Oui, Directrice financière (lu par l'IA)" }).click();
    await suggestions.getByRole("button", { name: "Oui, Lyon" }).click();
    await expect(suggestions.getByRole("button", { name: "Oui, CDI" })).toBeVisible();
    for (let question = 0; question < 3; question++) {
      const answered = await thread.locator("li.chat-candidate").count();
      await suggestions.getByRole("button", { name: fr.questionnaire.skip, exact: true }).click();
      await expect(thread.locator("li.chat-candidate")).toHaveCount(answered + 1);
    }

    // What was read, summed up in the thread (#1004): « Ai-je bien compris ? ».
    await expect(page.getByRole("list", { name: fr.questionnaire.transcript })).toContainText(fr.onboardingSummary.question);
    await expect(onboardingSummary(page)).toContainText("Directrice financière (lu par l'IA)");
    // The parsed CV and pre-filled Search Criteria, by « Voir le détail », in the Work Pane beside the page's conversation (ADR-0070).
    await openReviewDetail(page);
    await expect(page.locator("aside.work-pane").getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveValue("Directrice financière (lu par l'IA)");
    await expect(placeNames(criteriaOf(page))).toHaveText(["Lyon"]);
    await expect(page.getByLabel(fr.cvReview.fullName)).toHaveValue("Marie Dupont");
    await expect(page.getByLabel(fr.cvReview.headline)).toHaveValue("Directrice financière");
    const job1 = page.getByRole("group", { name: "Poste 1" });
    await expect(job1.getByLabel(fr.cvReview.employer)).toHaveValue("Groupe Seb");
    await expect(page.getByRole("group", { name: "Formation 1" }).getByLabel(fr.cvReview.institution)).toHaveValue("ESSEC");
    await expect(page.getByRole("group", { name: "Compétence 1" }).getByLabel(fr.cvReview.skill)).toHaveValue("Consolidation");
    await expect(page.getByRole("group", { name: "Compétence 2" }).getByLabel(fr.cvReview.skill)).toHaveValue("IFRS");
    await expect(page.getByRole("group", { name: "Langue 1" }).getByLabel(fr.cvReview.language)).toHaveValue("Anglais");

    // The Profile is born at the target role and place confirmed (ADR-0106, #999), named after its target role until finished.
    const elsewhere = await browser.newContext({ baseURL: origin, storageState: await page.context().storageState() });
    const accountPage = await elsewhere.newPage();
    await accountPage.goto("/compte");
    await expect(accountPage.getByRole("link", { name: "Directrice financière (lu par l'IA)", exact: true })).toBeVisible();

    // The Candidate corrects and completes the draft.
    await criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true }).fill("Directrice administrative et financière");
    await page.getByLabel(fr.cvReview.minSalary).fill("110 000");
    await page.getByRole("group", { name: fr.cvReview.contractType }).getByRole("checkbox", { name: fr.cvReview.contractTypes.cdi }).check();
    await page.getByRole("group", { name: fr.cvReview.contractType }).getByRole("checkbox", { name: fr.cvReview.contractTypes.freelance }).check();
    await page.getByRole("group", { name: fr.cvReview.remoteWork }).getByRole("checkbox", { name: fr.cvReview.remoteWorkOptions.hybrid }).check();
    // A second place to search (ADR-0025).
    await placeInput(criteriaOf(page)).fill("Gren");
    await placeOptions(page).filter({ hasText: "Grenoble (38)" }).click();
    await expect(placeNames(criteriaOf(page))).toHaveText(["Lyon", "Grenoble (38)"]);
    await expect(placeInput(criteriaOf(page))).toBeFocused();
    await job1.getByLabel(fr.cvReview.period).fill("2015 – 2025");
    await page.getByRole("button", { name: fr.cvReview.addExperience }).click();
    const job2 = page.getByRole("group", { name: "Poste 2" });
    await job2.getByLabel(fr.cvReview.jobTitle).fill("Contrôleuse de gestion");
    await job2.getByLabel(fr.cvReview.employer).fill("Renault");
    await page.getByRole("button", { name: fr.cvReview.addSkill }).click();
    await page.getByRole("group", { name: "Compétence 3" }).getByLabel(fr.cvReview.skill).fill("SAP");
    await page.getByRole("button", { name: "Retirer la langue 1" }).click();
    await page.getByRole("button", { name: fr.cvReview.save }).click();

    // The Profile page shows what was saved.
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice administrative et financière");
    await expect(page).toHaveTitle(`Directrice administrative et financière · ${fr.app.name}`);
    // Its Search Criteria, in the dialog its Fiche's « Modifier les critères » opens (#605).
    const savedCriteria = await openSearchCriteria(page);
    await expect(savedCriteria.getByLabel(fr.cvReview.minSalary)).toHaveValue("110000");
    const option = (legend: string, name: string) => savedCriteria.getByRole("group", { name: legend }).getByRole("checkbox", { name, exact: true });
    const checked = (legend: string) => savedCriteria.getByRole("group", { name: legend }).getByRole("checkbox", { checked: true });
    await expect(option(fr.cvReview.contractType, fr.cvReview.contractTypes.cdi)).toBeChecked();
    await expect(option(fr.cvReview.contractType, fr.cvReview.contractTypes.freelance)).toBeChecked();
    await expect(checked(fr.cvReview.contractType)).toHaveCount(2);
    await expect(option(fr.cvReview.remoteWork, fr.cvReview.remoteWorkOptions.hybrid)).toBeChecked();
    await expect(checked(fr.cvReview.remoteWork)).toHaveCount(1);
    await expect(placeNames(savedCriteria)).toHaveText(["Lyon", "Grenoble (38)"]);
    await page.keyboard.press("Escape");
    // Its Master CV, in the Work Pane (#605).
    await profileSectionLink(page, fr.profilePage.sections["cv-de-reference"]).click();
    await expect(page.getByRole("region", { name: fr.profile.masterCv }).getByText(/^Version 2 · /)).toBeVisible();
    // The whole Master CV, as its version page shows it.
    await page.goto(`${new URL(page.url()).pathname.replace(/\/cv-de-reference$/, "")}/versions/2`);
    await expect(page.getByText("Directrice financière · Groupe Seb · Lyon · 2015 – 2025")).toBeVisible();
    await expect(page.getByText("Contrôleuse de gestion · Renault")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "SAP" })).toBeVisible();
    await expect(page.getByRole("heading", { name: fr.cvReview.languages })).toHaveCount(0);

    await accountPage.reload();
    await expect(accountPage.getByRole("link", { name: "Directrice administrative et financière", exact: true })).toBeVisible();
    await expect(accountPage.getByRole("link", { name: fr.profiles.create })).toHaveCount(0);
    await elsewhere.close();
  });

  test("a Word (.docx) CV is accepted too", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("docx"));
    const lines = ["Jean Martin", "Directeur des achats", ...MARIE_DUPONT_CV.slice(2)];
    await uploadCv(page, { name: "cv-jean.docx", mimeType: DOCX, buffer: Buffer.from(await docxCv(lines)) });

    await expect(page.getByLabel(fr.cvReview.fullName)).toHaveValue("Jean Martin");
    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveValue("Directeur des achats (lu par l'IA)");
  });

  test("a Word (.docx) CV is read into experience, education, skills and languages from its own text", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("docx-sections"));
    // E2E_AI_DOWN makes the fake AI Coach fail, so every section comes from the DOCX text itself.
    const lines = [...MARIE_DUPONT_CV, "Centres d'intérêt", "E2E_AI_DOWN"];
    await uploadCv(page, { name: "cv-marie.docx", mimeType: DOCX, buffer: Buffer.from(await docxCv(lines)) });

    await expect(page.getByLabel(fr.cvReview.fullName)).toHaveValue("Marie Dupont");
    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveValue("Directrice financière");
    await expect(page.getByRole("group", { name: "Poste 1" }).getByLabel(fr.cvReview.employer)).toHaveValue("Groupe Seb");
    await expect(page.getByRole("group", { name: "Poste 2" }).getByLabel(fr.cvReview.employer)).toHaveValue("Renault");
    await expect(page.getByRole("group", { name: "Formation 1" }).getByLabel(fr.cvReview.institution)).toHaveValue("ESSEC");
    const skills = page.getByRole("group", { name: fr.cvReview.skills, exact: true }).getByLabel(fr.cvReview.skill, { exact: true });
    await expect(skills.first()).toBeVisible();
    expect(await skills.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value).join("\n"))).toMatch(/IFRS/);
    await expect(page.getByRole("group", { name: "Langue 1" }).getByLabel(fr.cvReview.language)).toHaveValue("Anglais");
    await expect(page.getByRole("group", { name: "Langue 2" }).getByLabel(fr.cvReview.level)).toHaveValue("notions");
  });

  test("when the AI Coach cannot read the CV, its sections are still read from the text", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("fallback"));
    await uploadCv(page, pdfFile([...MARIE_DUPONT_CV, "Centres d'intérêt", "E2E_AI_DOWN"]));

    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveValue("Directrice financière");
    await expect(placeNames(criteriaOf(page))).toHaveText(["Lyon (69003)"]);
    await expect(page.getByRole("group", { name: "Poste 2" }).getByLabel(fr.cvReview.employer)).toHaveValue("Renault");
    await expect(page.getByRole("group", { name: "Langue 2" }).getByLabel(fr.cvReview.level)).toHaveValue("notions");
  });

  test("a Profile needs a target role and a location", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("required"));
    await uploadCv(page, pdfFile(MARIE_DUPONT_CV));
    await criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true }).fill("");
    await removePlace(criteriaOf(page), "Lyon").click();
    await expect(placeNames(criteriaOf(page))).toHaveCount(0);
    await page.getByRole("button", { name: fr.cvReview.save }).click();

    await expect(page.locator(".notice[role=alert]")).toHaveText(`Certains champs sont à compléter ou à corriger : ${fr.cvReview.targetRole}, ${fr.cvReview.locations}.`);
    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveAccessibleDescription(fr.cvReview.required);
    // The Profile born at the confirmed role and place (#999) keeps them: the refused save changed nothing.
    await page.goto("/compte");
    await expect(page.getByRole("link", { name: "Directrice financière (lu par l'IA)", exact: true })).toBeVisible();
  });

  test("a filled salary that is not a whole number is called invalid, not missing", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("salary"));
    await uploadCv(page, pdfFile(MARIE_DUPONT_CV));
    const salary = criteriaOf(page).getByLabel(fr.cvReview.minSalary, { exact: true });
    await salary.fill("110,000");
    await page.getByRole("button", { name: fr.cvReview.save }).click();

    await expect(salary).toHaveAttribute("aria-invalid", "true");
    await expect(salary).toHaveAccessibleDescription(fr.cvReview.invalidValue);
  });

  test("each job, degree and language box fits inside its section", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("layout"));
    await uploadCv(page, pdfFile(MARIE_DUPONT_CV));

    for (const [section, entry] of [
      [fr.cvReview.experience, "Poste 1"],
      [fr.cvReview.education, "Formation 1"],
      [fr.cvReview.languages, "Langue 1"],
    ]) {
      const outer = (await page.getByRole("group", { name: section, exact: true }).boundingBox())!;
      const inner = (await page.getByRole("group", { name: entry }).boundingBox())!;
      expect(inner.x + inner.width, `${entry} inside ${section}`).toBeLessThanOrEqual(outer.x + outer.width);
    }
  });

  test("only PDF and Word (.docx) files are accepted, with a message the Candidate can act on", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("formats"));
    // An old Word file is refused as soon as it is chosen (#468): nothing to send, a Note says why.
    await page.goto("/profils/nouveau");
    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles({ name: "cv.doc", mimeType: "application/msword", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]) });
    await expect(page.locator(".ds-note[role=alert]")).toHaveText(fr.cvUpload.errors.unsupported_format);
    await expect(page.getByRole("button", { name: fr.cvUpload.submit })).toHaveCount(0);

    await uploadCv(page, pdfFile([], "scan.pdf"), false);
    await expect(page.locator(".ds-note[role=alert]")).toHaveText(fr.cvUpload.errors.empty);

    await uploadCv(page, { name: "blank.pdf", mimeType: PDF, buffer: Buffer.alloc(0) }, false);
    await expect(page.locator(".ds-note[role=alert]")).toHaveText(fr.cvUpload.errors.empty);
    await expect(page.getByLabel(fr.cvUpload.fileLabel)).toBeVisible();
  });

  test("there is no LinkedIn import of any kind (ADR-0001)", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("no-import"));
    for (const path of ["/compte", "/profils/nouveau"]) {
      await page.goto(path);
      await expect(page.locator("body")).not.toContainText(/linkedin/i);
      await expect(page.locator('a[href*="linkedin" i], form[action*="linkedin" i]')).toHaveCount(0);
    }
    await page.goto("/profils/nouveau");
    await expect(page.getByLabel(fr.cvUpload.fileLabel)).toHaveAttribute("accept", /^(\.pdf|\.docx|application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)(,(\.pdf|\.docx|application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document))*$/);
    // No such endpoint: 404, or 405 now that /api/profiles/:id exists (it only takes PATCH).
    const linkedInImport = await page.request.post("/api/profiles/linkedin", { headers: { origin }, data: {} });
    expect([404, 405]).toContain(linkedInImport.status());
    expect((await page.request.post("/api/linkedin", { headers: { origin }, data: {} })).status()).toBe(404);
  });

  test("the upload and review pages use catalogue strings and meet the ADR-0009 floor", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("floor"));
    await page.goto("/profils/nouveau");
    const allowed = new Set(catalogueStrings(fr));
    // The Usage Meter's percentage, a catalogue string with the week's number in it.
    allowed.add(fr.usageMeter.percent.replace("{{percent}}", "0"));
    for (const t of await renderedTexts(page)) {
      expect.soft(allowed.has(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(pdfFile(MARIE_DUPONT_CV));
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();
    await throughCvInterview(page);
    await openReviewDetail(page);
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("CV and Profile endpoints", () => {
  test("refuse anonymous visitors and other sites, and never show another Candidate's Profile", async ({ page, browser }) => {
    // A Guest's CV is read (for their Match Score, issue #10), but they cannot keep a Profile.
    const guest = await page.request.post("/api/cv/draft", { headers: { origin }, multipart: { cv: pdfFile(MARIE_DUPONT_CV) } });
    expect(guest.status()).toBe(200);
    expect((await guest.json()).masterCv.fullName).toBe("Marie Dupont");
    expect((await page.request.post("/api/profiles", { headers: { origin }, data: {} })).status()).toBe(401);

    await signInWithMagicLink(page, newAddress("owner"));
    const crossSite = await page.request.post("/api/cv/draft", { headers: { origin: "https://evil.example" }, multipart: { cv: pdfFile(MARIE_DUPONT_CV) } });
    expect(crossSite.status()).toBe(403);

    const draft = await page.request.post("/api/cv/draft", { headers: { origin }, multipart: { cv: pdfFile(MARIE_DUPONT_CV) } });
    expect(draft.status()).toBe(200);
    const created = await page.request.post("/api/profiles", { headers: { origin }, data: await draft.json() });
    expect(created.status()).toBe(201);
    const { id } = await created.json();

    const other = await browser.newContext({ baseURL: origin });
    const otherPage = await other.newPage();
    await signInWithMagicLink(otherPage, newAddress("other"));
    const response = await otherPage.goto(`/profils/${id}`);
    expect(response?.status()).toBe(404);
    // Nor any of its Sections (ADR-0024).
    expect((await otherPage.goto(`/profils/${id}/cv-de-reference`))?.status()).toBe(404);
    await other.close();
  });
});

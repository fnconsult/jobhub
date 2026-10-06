import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { docxCv, MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { catalogueStrings, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #4: a signed-in Candidate uploads a PDF or Word CV; it is read into a
// Master CV and Search Criteria they review and correct, then saved as their
// first Profile. The AI provider is faked inside the server (fake-mistral.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function uploadCv(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/profils/nouveau");
  await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(file);
  await page.getByRole("button", { name: fr.cvUpload.submit }).click();
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
    await expect(page).toHaveTitle(`${fr.cvUpload.title} · ${fr.app.name}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.cvUpload.title);

    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(pdfFile(MARIE_DUPONT_CV));
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();

    // The parsed CV and pre-filled Search Criteria, ready for review.
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveValue("Directrice financière (lu par l'IA)");
    await expect(criteriaOf(page).getByLabel(fr.cvReview.location, { exact: true })).toHaveValue("Lyon");
    await expect(page.getByLabel(fr.cvReview.fullName)).toHaveValue("Marie Dupont");
    await expect(page.getByLabel(fr.cvReview.headline)).toHaveValue("Directrice financière");
    const job1 = page.getByRole("group", { name: "Poste 1" });
    await expect(job1.getByLabel(fr.cvReview.employer)).toHaveValue("Groupe Seb");
    await expect(page.getByRole("group", { name: "Formation 1" }).getByLabel(fr.cvReview.institution)).toHaveValue("ESSEC");
    await expect(page.getByLabel(fr.cvReview.skills, { exact: true })).toHaveValue("Consolidation\nIFRS");
    await expect(page.getByRole("group", { name: "Langue 1" }).getByLabel(fr.cvReview.language)).toHaveValue("Anglais");

    // Nothing is saved before the Candidate confirms.
    const elsewhere = await browser.newContext({ baseURL: origin, storageState: await page.context().storageState() });
    const accountPage = await elsewhere.newPage();
    await accountPage.goto("/compte");
    await expect(accountPage.getByText(fr.profiles.none)).toBeVisible();

    // The Candidate corrects and completes the draft.
    await criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true }).fill("Directrice administrative et financière");
    await page.getByLabel(fr.cvReview.minSalary).fill("110 000");
    await page.getByLabel(fr.cvReview.contractType).selectOption({ label: fr.cvReview.contractTypes.cdi });
    await page.getByLabel(fr.cvReview.remoteWork).selectOption({ label: fr.cvReview.remoteWorkOptions.hybrid });
    await job1.getByLabel(fr.cvReview.period).fill("2015 – 2025");
    await page.getByRole("button", { name: fr.cvReview.addExperience }).click();
    const job2 = page.getByRole("group", { name: "Poste 2" });
    await job2.getByLabel(fr.cvReview.jobTitle).fill("Contrôleuse de gestion");
    await job2.getByLabel(fr.cvReview.employer).fill("Renault");
    await page.getByLabel(fr.cvReview.skills, { exact: true }).fill("Consolidation\nIFRS\nSAP");
    await page.getByRole("button", { name: "Retirer la langue 1" }).click();
    await page.getByRole("button", { name: fr.cvReview.save }).click();

    // The Profile page shows what was saved.
    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice administrative et financière");
    await expect(page).toHaveTitle(`Directrice administrative et financière · ${fr.app.name}`);
    await expect(page.getByText(/^110\s000 € brut par an minimum$/)).toBeVisible();
    await expect(page.getByText(fr.cvReview.contractTypes.cdi, { exact: true })).toBeVisible();
    await expect(page.getByText(fr.cvReview.remoteWorkOptions.hybrid, { exact: true })).toBeVisible();
    await expect(page.getByText("Version 1")).toBeVisible();
    await expect(page.getByText("Directrice financière · Groupe Seb · Lyon · 2015 – 2025")).toBeVisible();
    await expect(page.getByText("Contrôleuse de gestion · Renault")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "SAP" })).toBeVisible();
    await expect(page.getByRole("heading", { name: fr.cvReview.languages })).toHaveCount(0);

    await accountPage.reload();
    await expect(accountPage.getByRole("link", { name: "Directrice administrative et financière" })).toBeVisible();
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

  test("when the AI Coach cannot read the CV, its sections are still read from the text", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("fallback"));
    await uploadCv(page, pdfFile([...MARIE_DUPONT_CV, "Centres d'intérêt", "E2E_AI_DOWN"]));

    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveValue("Directrice financière");
    await expect(criteriaOf(page).getByLabel(fr.cvReview.location, { exact: true })).toHaveValue("Lyon (69003)");
    await expect(page.getByRole("group", { name: "Poste 2" }).getByLabel(fr.cvReview.employer)).toHaveValue("Renault");
    await expect(page.getByRole("group", { name: "Langue 2" }).getByLabel(fr.cvReview.level)).toHaveValue("notions");
  });

  test("a Profile needs a target role and a location", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("required"));
    await uploadCv(page, pdfFile(MARIE_DUPONT_CV));
    await criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true }).fill("");
    await criteriaOf(page).getByLabel(fr.cvReview.location, { exact: true }).fill("  ");
    await page.getByRole("button", { name: fr.cvReview.save }).click();

    await expect(page.locator(".notice[role=alert]")).toHaveText(`Certains champs sont à compléter ou à corriger : ${fr.cvReview.targetRole}, ${fr.cvReview.location}.`);
    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(criteriaOf(page).getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveAccessibleDescription(fr.cvReview.required);
    await page.goto("/compte");
    await expect(page.getByText(fr.profiles.none)).toBeVisible();
  });

  test("only PDF and Word (.docx) files are accepted, with a message the Candidate can act on", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("formats"));
    await uploadCv(page, { name: "cv.doc", mimeType: "application/msword", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]) });
    await expect(page.locator(".notice[role=alert]")).toHaveText(fr.cvUpload.errors.unsupported_format);

    await uploadCv(page, pdfFile([], "scan.pdf"));
    await expect(page.locator(".notice[role=alert]")).toHaveText(fr.cvUpload.errors.empty);
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
    const linkedInImport = await page.request.post("/api/profiles/linkedin", { headers: { origin }, data: {} });
    expect(linkedInImport.status()).toBe(404);
  });

  test("the upload and review pages use catalogue strings and meet the ADR-0009 floor", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("floor"));
    await page.goto("/profils/nouveau");
    const allowed = new Set(catalogueStrings(fr));
    for (const t of await renderedTexts(page)) {
      expect.soft(allowed.has(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
    await page.getByLabel(fr.cvUpload.fileLabel).setInputFiles(pdfFile(MARIE_DUPONT_CV));
    await page.getByRole("button", { name: fr.cvUpload.submit }).click();
    await expect(page.getByRole("heading", { level: 2, name: fr.cvReview.title })).toBeVisible();
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("CV and Profile endpoints", () => {
  test("refuse anonymous visitors and other sites, and never show another Candidate's Profile", async ({ page, browser }) => {
    const anonymous = await page.request.post("/api/cv/draft", { headers: { origin }, multipart: { cv: pdfFile(MARIE_DUPONT_CV) } });
    expect(anonymous.status()).toBe(401);
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
    await other.close();
  });
});

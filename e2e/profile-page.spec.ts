import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fromCatalogue, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #137: the Profile page redesigned as in the approved prototype (#132):
// it reads like a document, the Profile's name and Search Criteria are edited in
// place and saved on change, and the Master CV's edits gather into one new
// version saved from a sticky bar (ADR-0012). Never below the ADR-0009 floor.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "catherine.morel@exemple.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "Plus de 25 ans dans l'industrie et la distribution.",
  experience: [
    { title: "Directrice administrative et financière", employer: "Groupe Sorelis", location: "Lyon", period: "2015 – 2026", description: "Refinancement de 45 M€ de dette." },
    { title: "Responsable du contrôle de gestion", employer: "Distrimag", location: "Villeurbanne", period: "2007 – 2015", description: "Budget de 42 magasins." },
  ],
  education: [{ degree: "Master CCA", institution: "IAE Lyon", year: "1999" }],
  skills: ["Consolidation IFRS", "Excel avancé, Power BI"],
  languages: [{ name: "Anglais", level: "courant" }],
};

/** Signs a new Candidate in with one Profile, and returns its id. */
async function candidateWithProfile(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", location: "Lyon", minSalary: 85000, contractType: "cdi" } },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).id;
}

const title = (page: Page) => page.getByLabel(fr.profileActions.name, { exact: true });
const criteria = (page: Page) => page.getByRole("group", { name: fr.cvReview.searchCriteria });
const masterCvSection = (page: Page) => page.getByRole("region", { name: fr.profile.masterCv });
const saveBar = (page: Page) => page.getByRole("region", { name: fr.profilePage.savebarLabel });
const saveVersion = (version: number) => fr.profilePage.saveVersion.replace("{{version}}", String(version));

test.describe("the Profile page as a document", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("reads top-down: eyebrow, the name as title, the Search Criteria as properties, then the Master CV", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-doc");
    await page.goto(`/profils/${id}`);

    await expect(page.getByText(fr.profilePage.eyebrow, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice administrative et financière");
    await expect(title(page)).toHaveValue("Directrice administrative et financière");
    await expect(criteria(page).getByLabel(fr.cvReview.targetRole)).toHaveValue("Directrice administrative et financière");
    await expect(criteria(page).getByLabel(fr.cvReview.location, { exact: true })).toHaveValue("Lyon");
    await expect(criteria(page).getByLabel(fr.cvReview.minSalary)).toHaveValue("85000");
    await expect(criteria(page).getByLabel(fr.cvReview.contractType)).toHaveValue("cdi");
    await expect(page.getByRole("button", { name: fr.jobSearch.start })).toBeVisible();
    await expect(page.getByRole("link", { name: fr.profilePage.jobDigestLink.none })).toHaveAttribute("href", `/profils/${id}#job-digest-title`);

    const cv = masterCvSection(page);
    await expect(cv.getByText(/^Version 1 · enregistrée le \w+ \d+ \w+ \d{4}$/)).toBeVisible();
    await expect(cv.getByLabel(fr.cvReview.headline)).toHaveValue(masterCv.headline);
    await expect(cv.getByLabel(fr.cvReview.summary)).toHaveValue(masterCv.summary);
    await expect(cv.getByLabel("Missions et réalisations : Directrice administrative et financière · Groupe Sorelis")).toHaveValue("Refinancement de 45 M€ de dette.");
    await expect(cv.getByText("2007 – 2015 · Villeurbanne")).toBeVisible();
    await expect(cv.getByLabel(fr.profilePage.skills)).toHaveValue("Consolidation IFRS\nExcel avancé, Power BI");
    await expect(cv.getByRole("link", { name: fr.profile.editMasterCv })).toHaveAttribute("href", `/profils/${id}/cv`);
    await expect(saveBar(page)).toHaveCount(0);
  });

  test("the name and each Search Criterion save on change, with a saved flag", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-inline");
    await page.goto(`/profils/${id}`);

    // The name: Enter saves it, the sidebar follows.
    await title(page).fill("DAF industrie");
    await title(page).press("Enter");
    await expect(page.getByRole("status").filter({ hasText: fr.profilePage.nameSaved })).toBeVisible();
    await expect(page.getByRole("navigation", { name: fr.profileSwitcher.label }).getByRole("button")).toHaveText(
      fr.profileSwitcher.current.replace("{{name}}", "DAF industrie"),
    );

    // A required value left blank goes back to the saved one; Escape does too.
    await title(page).fill("   ");
    await title(page).blur();
    await expect(title(page)).toHaveValue("DAF industrie");
    await title(page).fill("Autre nom");
    await title(page).press("Escape");
    await expect(title(page)).toHaveValue("DAF industrie");

    // A text criterion saves when the Candidate leaves it, a select as soon as it changes.
    await criteria(page).getByLabel(fr.cvReview.location, { exact: true }).fill("Lyon et 50 km autour");
    await criteria(page).getByLabel(fr.cvReview.location, { exact: true }).press("Tab");
    await expect(criteria(page).getByRole("status").filter({ hasText: fr.profilePage.criteriaSaved })).toHaveCount(1);
    await criteria(page).getByLabel(fr.cvReview.remoteWork).selectOption("hybrid");
    await expect(criteria(page).getByRole("status").filter({ hasText: fr.profilePage.criteriaSaved })).toHaveCount(2);

    // An invalid value says what is wrong, on the field, and is not saved.
    const salary = criteria(page).getByLabel(fr.cvReview.minSalary);
    await salary.fill("beaucoup");
    await salary.press("Enter");
    await expect(salary).toHaveAttribute("aria-invalid", "true");
    await expect(criteria(page).getByRole("alert")).toHaveText(fr.cvReview.invalidValue);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAF industrie");
    await expect(criteria(page).getByLabel(fr.cvReview.location, { exact: true })).toHaveValue("Lyon et 50 km autour");
    await expect(criteria(page).getByLabel(fr.cvReview.remoteWork)).toHaveValue("hybrid");
    await expect(criteria(page).getByLabel(fr.cvReview.minSalary)).toHaveValue("85000");
    // The name does not follow the target role.
    await expect(criteria(page).getByLabel(fr.cvReview.targetRole)).toHaveValue("Directrice administrative et financière");
  });

  test("Master CV edits gather into one new version, or are cancelled", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-cv-version");
    await page.goto(`/profils/${id}`);
    const cv = masterCvSection(page);

    await cv.getByLabel(fr.cvReview.summary).fill("Plus de 15 ans dans l'industrie et la distribution.");
    await expect(saveBar(page)).toContainText(fr.profilePage.unsaved);
    await expect(saveBar(page).getByRole("button", { name: saveVersion(2) })).toBeVisible();

    // Cancelling puts the saved text back.
    await saveBar(page).getByRole("button", { name: fr.profilePage.cancel }).click();
    await expect(saveBar(page)).toHaveCount(0);
    await expect(cv.getByLabel(fr.cvReview.summary)).toHaveValue(masterCv.summary);
    await expect(cv.getByRole("status")).toHaveText(fr.profilePage.cancelled);

    // Several edits, one version.
    await cv.getByLabel(fr.cvReview.summary).fill("Plus de 15 ans dans l'industrie et la distribution.");
    await cv.getByLabel(fr.profilePage.skills).fill("Consolidation IFRS\nExcel avancé\nPower BI\nTagetik");
    await cv.getByLabel("Missions et réalisations : Responsable du contrôle de gestion · Distrimag").fill("Budget et reporting de 42 magasins.");
    await saveBar(page).getByRole("button", { name: saveVersion(2) }).click();
    await expect(cv.getByRole("status")).toHaveText(fr.profilePage.savedVersion.replace("{{version}}", "2"));
    await expect(saveBar(page)).toHaveCount(0);
    await expect(cv.getByText(/^Version 2 · enregistrée le/)).toBeVisible();

    // The next edit proposes version 3.
    await cv.getByLabel(fr.cvReview.headline).fill("DAF");
    await expect(saveBar(page).getByRole("button", { name: saveVersion(3) })).toBeVisible();

    const versions = await page.request.get(`/profils/${id}/versions`);
    expect(await versions.text()).toContain(fr.versions.version.replace("{{version}}", "2"));
    await page.reload();
    await expect(cv.getByLabel(fr.profilePage.skills)).toHaveValue("Consolidation IFRS\nExcel avancé\nPower BI\nTagetik");
    await expect(cv.getByLabel("Missions et réalisations : Responsable du contrôle de gestion · Distrimag")).toHaveValue("Budget et reporting de 42 magasins.");
    await expect(cv.getByLabel(fr.cvReview.headline)).toHaveValue(masterCv.headline);
  });

  test("a save based on an outdated version is refused and overwrites nothing (ADR-0012)", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-cv-conflict");
    await page.goto(`/profils/${id}`);
    const cv = masterCvSection(page);
    await cv.getByLabel(fr.cvReview.headline).fill("DAF");

    // Another tab saves version 2 meanwhile.
    const elsewhere = await page.request.put(`/api/profiles/${id}/master-cv`, {
      headers: { origin },
      data: { basedOnVersion: 1, content: { ...masterCv, summary: "Saisi dans un autre onglet." } },
    });
    expect(elsewhere.status()).toBe(200);

    await saveBar(page).getByRole("button", { name: saveVersion(2) }).click();
    await expect(saveBar(page).getByRole("alert")).toHaveText(fr.cvEditor.conflict.replace("{{version}}", "2"));
    await expect(cv.getByLabel(fr.cvReview.headline)).toHaveValue("DAF");

    await page.reload();
    await expect(cv.getByLabel(fr.cvReview.summary)).toHaveValue("Saisi dans un autre onglet.");
    await expect(cv.getByLabel(fr.cvReview.headline)).toHaveValue(masterCv.headline);
  });

  test("an archived Profile shows its Search Criteria read-only", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-archived");
    const archived = await page.request.patch(`/api/profiles/${id}`, { headers: { origin }, data: { archived: true } });
    expect(archived.ok()).toBe(true);
    await page.goto(`/profils/${id}`);
    await expect(page.getByText(fr.profileActions.archivedNotice)).toBeVisible();
    const properties = page.getByRole("term");
    await expect(properties.filter({ hasText: fr.cvReview.location })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /^Lyon$/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: fr.cvReview.location, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: fr.jobSearch.start })).toHaveCount(0);
  });
});

test.describe("the Profile page on the ADR-0009 floor", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`at ${viewport.width}px: catalogue strings, 16px and AA contrast, visible edit affordances, 44px targets, no sideways scroll`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const id = await candidateWithProfile(page, `profile-floor-${viewport.width}`);
      await page.goto(`/profils/${id}`);
      await masterCvSection(page).getByLabel(fr.cvReview.headline).fill("DAF");
      await expect(saveBar(page)).toBeVisible();

      const own = new Set(
        [
          masterCv.fullName,
          ...masterCv.experience.flatMap((job) => [`${job.title} · ${job.employer}`, `${job.period} · ${job.location}`]),
          "Directrice administrative et financière",
          fr.profileSwitcher.current.replace("{{name}}", "Directrice administrative et financière"),
        ].map((text) => text.trim()),
      );
      const known = fromCatalogue(fr);
      for (const t of await renderedTexts(page)) {
        // Values in fields are the Candidate's own text.
        if (t.tag === "select" || t.tag === "textarea" || own.has(t.text)) continue;
        expect.soft(known(t.text), `"${t.text}" comes from the catalogue`).toBe(true);
      }
      for (const t of await renderedTexts(page)) {
        expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
        expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
      }

      // Editable values show it without hover: a dashed underline.
      for (const field of await page.locator("main .inline-edit").all()) {
        if (await field.evaluate((el) => el === document.activeElement)) continue;
        await expect(field).toHaveCSS("border-bottom-style", "dashed");
      }
      // Every control of the page is at least 2.75rem (44px) tall.
      for (const control of await page.locator("main").getByRole("button").or(page.locator("main").getByRole("textbox")).or(page.locator("main select")).all()) {
        if (!(await control.isVisible())) continue;
        const box = (await control.boundingBox())!;
        expect.soft(box.height, `height of ${await control.evaluate((el) => el.outerHTML.slice(0, 80))}`).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
});

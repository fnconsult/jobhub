import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #6: the Candidate edits every entry of a Master CV. Each saved change
// creates a new version; previous versions can be viewed and restored.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "25 ans d'expérience dans l'industrie.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

/** Signs a new Candidate in with a Profile made of `masterCv`, and returns the Profile's id. */
async function candidateWithProfile(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).id;
}

const entry = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function openEditor(page: Page, id: string) {
  await page.goto(`/profils/${id}`);
  await page.getByRole("link", { name: fr.profile.editMasterCv }).click();
  await expect(page).toHaveURL(`${origin}/profils/${id}/cv`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.cvEditor.title);
}

test.describe("editing the Master CV", () => {
  test("the Candidate adds, edits, reorders and removes entries in every section, and saving creates a new version", async ({ page }) => {
    const id = await candidateWithProfile(page, "editor");
    await openEditor(page, id);
    await expect(page.getByText("Vous modifiez la version 1.")).toBeVisible();

    // Identity and summary.
    await page.getByLabel(fr.cvReview.headline).fill("Directrice administrative et financière");
    await page.getByLabel(fr.cvReview.summary).fill("Finance d'entreprise, industrie.");

    // Experience: add a job, move it first, edit the other one.
    await button(page, fr.cvReview.addExperience).click();
    await entry(page, "Poste 2").getByLabel(fr.cvReview.jobTitle).fill("Contrôleuse de gestion");
    await entry(page, "Poste 2").getByLabel(fr.cvReview.employer).fill("Renault");
    await button(page, "Monter : Poste 2").click();
    await expect(entry(page, "Poste 1").getByLabel(fr.cvReview.employer)).toHaveValue("Renault");
    await expect(button(page, "Descendre : Poste 1")).toBeFocused();
    await entry(page, "Poste 2").getByLabel(fr.cvReview.period).fill("2015 – 2025");

    // Education: add one, remove the first.
    await button(page, fr.cvReview.addEducation).click();
    await entry(page, "Formation 2").getByLabel(fr.cvReview.degree).fill("DSCG");
    await button(page, "Retirer la formation 1").click();
    await expect(entry(page, "Formation 1").getByLabel(fr.cvReview.degree)).toHaveValue("DSCG");

    // Skills: add one, move it up, remove one.
    await button(page, fr.cvReview.addSkill).click();
    await entry(page, "Compétence 3").getByLabel(fr.cvReview.skill).fill("Consolidation");
    await button(page, "Monter : Compétence 3").click();
    await button(page, "Retirer la compétence 3").click(); // SAP
    await entry(page, "Compétence 1").getByLabel(fr.cvReview.skill).fill("Normes IFRS");

    // Languages: add one, move it down past nothing, remove the first.
    await button(page, fr.cvReview.addLanguage).click();
    await entry(page, "Langue 2").getByLabel(fr.cvReview.language).fill("Allemand");
    await entry(page, "Langue 2").getByLabel(fr.cvReview.level).fill("notions");
    await button(page, "Descendre : Langue 1").click();
    await button(page, "Retirer la langue 2").click(); // Anglais

    await button(page, fr.cvEditor.save).click();

    await expect(page).toHaveURL(`${origin}/profils/${id}`);
    await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(page.getByText("Directrice administrative et financière", { exact: true })).toBeVisible();
    await expect(page.getByText("Finance d'entreprise, industrie.")).toBeVisible();
    const jobs = page.locator(".cv-entry");
    await expect(jobs).toHaveText(["Contrôleuse de gestion · Renault", "Directrice financière · Groupe Seb · Lyon · 2015 – 2025"]);
    const items = (heading: string) => page.locator(`h3:text-is("${heading}") + ul > li`);
    await expect(items(fr.cvReview.education)).toHaveText(["DSCG"]);
    await expect(items(fr.cvReview.skills)).toHaveText(["Normes IFRS", "Consolidation"]);
    await expect(items(fr.cvReview.languages)).toHaveText(["Allemand · notions"]);

    // The editor now starts from version 2.
    await openEditor(page, id);
    await expect(page.getByText("Vous modifiez la version 2.")).toBeVisible();
    await expect(entry(page, "Poste 1").getByLabel(fr.cvReview.employer)).toHaveValue("Renault");
  });

  test("every section supports add, edit, reorder and remove, and the saved version keeps the result", async ({ page }) => {
    const id = await candidateWithProfile(page, "every-section");
    await openEditor(page, id);

    // Experience: add, move the new job first, edit it, remove the original.
    await button(page, fr.cvReview.addExperience).click();
    await entry(page, "Poste 2").getByLabel(fr.cvReview.jobTitle).fill("Responsable comptable");
    await entry(page, "Poste 2").getByLabel(fr.cvReview.employer).fill("Michelin");
    await button(page, "Monter : Poste 2").click();
    await entry(page, "Poste 1").getByLabel(fr.cvReview.period).fill("2005 – 2015");
    await button(page, "Retirer le poste 2").click(); // Groupe Seb
    await expect(entry(page, "Poste 2")).toHaveCount(0);

    // Education: add two, move the original down, edit it, remove the last.
    await button(page, fr.cvReview.addEducation).click();
    await entry(page, "Formation 2").getByLabel(fr.cvReview.degree).fill("DSCG");
    await button(page, fr.cvReview.addEducation).click();
    await entry(page, "Formation 3").getByLabel(fr.cvReview.degree).fill("Licence AES");
    await button(page, "Descendre : Formation 1").click();
    await expect(entry(page, "Formation 1").getByLabel(fr.cvReview.degree)).toHaveValue("DSCG");
    await entry(page, "Formation 2").getByLabel(fr.cvReview.degree).fill("Master Finance (ESSEC)");
    await button(page, "Retirer la formation 3").click(); // Licence AES

    // Skills: add, move to the top, edit, remove.
    await button(page, fr.cvReview.addSkill).click();
    await entry(page, "Compétence 3").getByLabel(fr.cvReview.skill).fill("Trésorerie");
    await button(page, "Monter : Compétence 3").click();
    await button(page, "Monter : Compétence 2").click();
    await entry(page, "Compétence 3").getByLabel(fr.cvReview.skill).fill("SAP FI");
    await button(page, "Retirer la compétence 2").click(); // IFRS

    // Languages: add two, move one up, edit, remove.
    await button(page, fr.cvReview.addLanguage).click();
    await entry(page, "Langue 2").getByLabel(fr.cvReview.language).fill("Espagnol");
    await entry(page, "Langue 2").getByLabel(fr.cvReview.level).fill("intermédiaire");
    await button(page, fr.cvReview.addLanguage).click();
    await entry(page, "Langue 3").getByLabel(fr.cvReview.language).fill("Italien");
    await button(page, "Monter : Langue 2").click();
    await entry(page, "Langue 2").getByLabel(fr.cvReview.level).fill("bilingue"); // Anglais
    await button(page, "Retirer la langue 3").click(); // Italien

    await button(page, fr.cvEditor.save).click();
    await expect(page).toHaveURL(`${origin}/profils/${id}`);
    await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(page.locator(".cv-entry")).toHaveText(["Responsable comptable · Michelin · 2005 – 2015"]);
    const items = (heading: string) => page.locator(`h3:text-is("${heading}") + ul > li`);
    await expect(items(fr.cvReview.education)).toHaveText([/^DSCG/, /^Master Finance \(ESSEC\)/]);
    await expect(items(fr.cvReview.skills)).toHaveText(["Trésorerie", "SAP FI"]);
    await expect(items(fr.cvReview.languages)).toHaveText(["Espagnol · intermédiaire", "Anglais · bilingue"]);

    // Reopening the editor shows exactly the saved entries, in order.
    await openEditor(page, id);
    await expect(entry(page, "Poste 2")).toHaveCount(0);
    await expect(entry(page, "Formation 3")).toHaveCount(0);
    await expect(entry(page, "Compétence 1").getByLabel(fr.cvReview.skill)).toHaveValue("Trésorerie");
    await expect(entry(page, "Langue 1").getByLabel(fr.cvReview.language)).toHaveValue("Espagnol");
  });

  test("the first entry cannot move up and the last cannot move down", async ({ page }) => {
    const id = await candidateWithProfile(page, "reorder-bounds");
    await openEditor(page, id);
    await button(page, fr.cvReview.addExperience).click();

    await expect(button(page, "Monter : Poste 1")).toBeDisabled();
    await expect(button(page, "Descendre : Poste 1")).toBeEnabled();
    await expect(button(page, "Descendre : Poste 2")).toBeDisabled();
    // Moving an entry to an end keeps the keyboard on that entry.
    await button(page, "Descendre : Poste 1").click();
    await expect(button(page, "Monter : Poste 2")).toBeFocused();
  });

  test("moving a saved entry to an end keeps the keyboard on it after a full page load", async ({ page }) => {
    // Saved entries are rendered on the server and hydrated, unlike entries added in the page.
    const id = await candidateWithProfile(page, "reorder-focus-hydrated");
    for (const [from, to] of [
      ["Descendre : Compétence 1", "Monter : Compétence 2"],
      ["Monter : Compétence 2", "Descendre : Compétence 1"],
    ]) {
      // Load the editor twice, so the server has rendered it before this load too.
      await page.goto(`/profils/${id}/cv`);
      await page.goto(`/profils/${id}/cv`);
      await page.waitForLoadState("networkidle");
      await button(page, from).focus();
      await page.keyboard.press("Enter");
      await expect(entry(page, "Compétence 1").getByLabel(fr.cvReview.skill)).toHaveValue("SAP");
      await expect(button(page, to)).toBeFocused();
    }
  });

  test("a save made elsewhere in the meantime is not overwritten", async ({ page, browser }) => {
    const id = await candidateWithProfile(page, "conflict");
    const other = await browser.newContext({ baseURL: origin, storageState: await page.context().storageState() });
    const otherPage = await other.newPage();
    await openEditor(page, id);
    await openEditor(otherPage, id);

    await otherPage.getByLabel(fr.cvReview.headline).fill("DAF");
    await button(otherPage, fr.cvEditor.save).click();
    await expect(otherPage).toHaveURL(`${origin}/profils/${id}`);

    await page.getByLabel(fr.cvReview.headline).fill("Directrice financière groupe");
    await button(page, fr.cvEditor.save).click();
    await expect(page.locator(".notice[role=alert]")).toHaveText(fr.cvEditor.conflict.replace("{{version}}", "2"));
    await expect(page).toHaveURL(`${origin}/profils/${id}/cv`);

    await page.goto(`/profils/${id}`);
    await expect(page.getByText("DAF", { exact: true })).toBeVisible();
    await other.close();
  });

  test("leaving without saving creates no version", async ({ page }) => {
    const id = await candidateWithProfile(page, "cancel");
    await openEditor(page, id);
    await page.getByLabel(fr.cvReview.headline).fill("Autre chose");
    await page.getByRole("link", { name: fr.cvEditor.cancel }).click();

    await expect(page).toHaveURL(`${origin}/profils/${id}`);
    await expect(page.getByText("Version 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Directrice financière", { exact: true }).first()).toBeVisible();
  });
});

test.describe("Master CV version history", () => {
  test("the Candidate views a previous version and restores it as a new version", async ({ page }) => {
    const id = await candidateWithProfile(page, "history");
    await openEditor(page, id);
    await page.getByLabel(fr.cvReview.headline).fill("DAF groupe");
    await button(page, fr.cvEditor.save).click();
    await expect(page.getByText("Version 2", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: fr.profile.versionHistory }).click();
    await expect(page).toHaveURL(`${origin}/profils/${id}/versions`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.versions.title);
    const versions = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(versions.getByRole("heading", { level: 2 })).toHaveText(["Version 2", "Version 1"]);
    await expect(versions.first()).toContainText(fr.versions.current);
    await expect(versions.first().getByRole("button")).toHaveCount(0);
    await expect(versions.first().getByText(/^Enregistrée le .+\d{4}/)).toBeVisible();

    await page.getByRole("link", { name: "Voir la version 1" }).click();
    await expect(page).toHaveURL(`${origin}/profils/${id}/versions/1`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Version 1 du CV de référence");
    await expect(page.getByText("Directrice financière", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("DAF groupe")).toHaveCount(0);

    await button(page, "Restaurer la version 1").click();
    await expect(page).toHaveURL(`${origin}/profils/${id}`);
    await expect(page.getByText("Version 3", { exact: true })).toBeVisible();
    await expect(page.getByText("DAF groupe")).toHaveCount(0);

    await page.getByRole("link", { name: fr.profile.versionHistory }).click();
    await expect(versions.getByRole("heading", { level: 2 })).toHaveText(["Version 3", "Version 2", "Version 1"]);
    await expect(versions.first()).toContainText("Restaurée depuis la version 1");
    // Version 2 is still there and can be restored in turn.
    await button(page, "Restaurer la version 2").click();
    await expect(page.getByText("Version 4", { exact: true })).toBeVisible();
    await expect(page.getByText("DAF groupe", { exact: true })).toBeVisible();
  });

  test("a version that does not exist is not found", async ({ page }) => {
    const id = await candidateWithProfile(page, "missing-version");
    for (const path of [`/profils/${id}/versions/9`, `/profils/${id}/versions/abc`]) {
      expect((await page.goto(path))?.status()).toBe(404);
    }
  });

  test("the editor and history pages meet the ADR-0009 floor", async ({ page }) => {
    const id = await candidateWithProfile(page, "floor");
    for (const path of [`/profils/${id}/cv`, `/profils/${id}/versions`, `/profils/${id}/versions/1`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (const t of await renderedTexts(page)) {
        expect.soft(t.fontSizePx, `${path}: font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
        expect.soft(t.contrast, `${path}: contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

test.describe("Master CV endpoints", () => {
  test("refuse anonymous visitors, other sites and other Candidates", async ({ page, browser }) => {
    const id = await candidateWithProfile(page, "endpoints-owner");
    const save = { basedOnVersion: 1, content: { ...masterCv, headline: "Pirate" } };

    const anonymous = await browser.newContext({ baseURL: origin });
    expect((await anonymous.request.put(`/api/profiles/${id}/master-cv`, { headers: { origin }, data: save })).status()).toBe(401);
    expect((await anonymous.request.post(`/api/profiles/${id}/master-cv/restore`, { headers: { origin }, data: { version: 1 } })).status()).toBe(401);
    await anonymous.close();

    expect((await page.request.put(`/api/profiles/${id}/master-cv`, { headers: { origin: "https://evil.example" }, data: save })).status()).toBe(403);
    expect((await page.request.post(`/api/profiles/${id}/master-cv/restore`, { headers: { origin: "https://evil.example" }, data: { version: 1 } })).status()).toBe(403);
    expect((await page.request.put(`/api/profiles/${id}/master-cv`, { headers: { origin }, data: { basedOnVersion: 1, content: "x" } })).status()).toBe(400);
    expect((await page.request.post(`/api/profiles/${id}/master-cv/restore`, { headers: { origin }, data: { version: 5 } })).status()).toBe(404);

    const other = await browser.newContext({ baseURL: origin });
    const otherPage = await other.newPage();
    await signInWithMagicLink(otherPage, newAddress("endpoints-other"));
    expect((await otherPage.request.put(`/api/profiles/${id}/master-cv`, { headers: { origin }, data: save })).status()).toBe(404);
    expect((await otherPage.request.post(`/api/profiles/${id}/master-cv/restore`, { headers: { origin }, data: { version: 1 } })).status()).toBe(404);
    for (const path of [`/profils/${id}/cv`, `/profils/${id}/versions`, `/profils/${id}/versions/1`]) {
      expect((await otherPage.goto(path))?.status()).toBe(404);
    }
    await other.close();

    await page.goto(`/profils/${id}`);
    await expect(page.getByText("Version 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Pirate")).toHaveCount(0);
  });
});

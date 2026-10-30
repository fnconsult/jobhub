import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fromCatalogue, renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { placeInput, placeNames, placeOptions, removePlace, typePlace } from "./support/locations";
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
async function candidateWithProfile(page: Page, label: string, locations = ["Lyon"], more: Record<string, string[]> = {}): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", locations, minSalary: 85000, contractTypes: ["cdi"], ...more } },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).id;
}

const title = (page: Page) => page.getByLabel(fr.profileActions.name, { exact: true });
const criteria = (page: Page) => page.getByRole("group", { name: fr.cvReview.searchCriteria });
/** The Search Criteria's places, as chips (ADR-0025, #235). */
const places = (page: Page) => placeNames(criteria(page));
/** One checkbox of the contract types or remote-work options. */
const choice = (page: Page, legend: string, option: string) => criteria(page).getByRole("group", { name: legend }).getByRole("checkbox", { name: option, exact: true });
const masterCvSection = (page: Page) => page.getByRole("region", { name: fr.profile.masterCv });
const saveBar = (page: Page) => page.getByRole("region", { name: fr.profilePage.savebarLabel });
const saveVersion = (version: number) => fr.profilePage.saveVersion.replace("{{version}}", String(version));
/** The list of the Profile page's Sections (ADR-0024). */
const sectionsNav = (page: Page) => page.getByRole("navigation", { name: fr.profilePage.sections.sectionsLabel });
const sectionLink = (page: Page, name: string) => sectionsNav(page).getByRole("link", { name });

test.describe("the Profile page as a document", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("reads top-down: eyebrow, the name as title, the Search Criteria as properties, then the Sections, the Master CV first", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-doc");
    await page.goto(`/profils/${id}`);

    await expect(page.getByText(fr.profilePage.eyebrow, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice administrative et financière");
    await expect(title(page)).toHaveValue("Directrice administrative et financière");
    await expect(criteria(page).getByLabel(fr.cvReview.targetRole)).toHaveValue("Directrice administrative et financière");
    await expect(places(page)).toHaveText(["Lyon"]);
    await expect(criteria(page).getByLabel(fr.cvReview.minSalary)).toHaveValue("85000");
    await expect(choice(page, fr.cvReview.contractType, fr.cvReview.contractTypes.cdi)).toBeChecked();
    await expect(choice(page, fr.cvReview.contractType, fr.cvReview.contractTypes.cdd)).not.toBeChecked();
    // No Job Search nor Job Digest from the Profile page: Recherches d'offres, the Coach Panel and the Job Digests page offer them (#238).
    await expect(page.getByRole("button", { name: fr.jobSearch.start, exact: true })).toHaveCount(0);
    await expect(page.locator(`a[href="/job-digests#job-digest-${id}"]`)).toHaveCount(0);

    // No Action Cards yet: no Propositions; the page shows its first Section, the Master CV.
    const s = fr.profilePage.sections;
    await expect(sectionsNav(page).getByRole("link")).toHaveText([s["cv-de-reference"], s["ats-score"], s["entreprises-cibles"], s.telecharger, s.gerer]);
    await expect(sectionLink(page, s["cv-de-reference"])).toHaveAttribute("aria-current", "page");
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

    // A place saves as soon as it is added, a checkbox as soon as it is ticked.
    await typePlace(criteria(page), "Lyon et 50 km autour");
    await expect(criteria(page).getByRole("status").filter({ hasText: fr.profilePage.criteriaSaved })).toHaveCount(1);
    await choice(page, fr.cvReview.remoteWork, fr.cvReview.remoteWorkOptions.hybrid).check();
    await expect(criteria(page).getByRole("status").filter({ hasText: fr.profilePage.criteriaSaved })).toHaveCount(2);

    // An invalid value says what is wrong, on the field, and is not saved.
    const salary = criteria(page).getByLabel(fr.cvReview.minSalary);
    await salary.fill("beaucoup");
    await salary.press("Enter");
    await expect(salary).toHaveAttribute("aria-invalid", "true");
    await expect(criteria(page).getByRole("alert")).toHaveText(fr.cvReview.invalidValue);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAF industrie");
    await expect(places(page)).toHaveText(["Lyon", "Lyon et 50 km autour"]);
    await expect(choice(page, fr.cvReview.remoteWork, fr.cvReview.remoteWorkOptions.hybrid)).toBeChecked();
    await expect(criteria(page).getByLabel(fr.cvReview.minSalary)).toHaveValue("85000");
    // The name does not follow the target role.
    await expect(criteria(page).getByLabel(fr.cvReview.targetRole)).toHaveValue("Directrice administrative et financière");
  });

  test("Search Criteria take several places, contract types and remote-work options, each change saving (ADR-0025)", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-several-values");
    await page.goto(`/profils/${id}`);
    const saved = () => criteria(page).getByRole("status").filter({ hasText: fr.profilePage.criteriaSaved });

    // A second place, chosen among the suggestions with the keyboard: it saves at once, the focus back on the input.
    await placeInput(criteria(page)).fill("bord");
    await expect(placeOptions(page)).toHaveText([`Bordeaux (33)${fr.cvReview.placeKinds.commune}`]);
    await expect(placeInput(criteria(page))).toHaveAttribute("aria-expanded", "true");
    await placeInput(criteria(page)).press("ArrowDown");
    await expect(placeInput(criteria(page))).toHaveAttribute("aria-activedescendant", (await placeOptions(page).first().getAttribute("id"))!);
    await placeInput(criteria(page)).press("Enter");
    await expect(places(page)).toHaveText(["Lyon", "Bordeaux (33)"]);
    await expect(saved()).toHaveCount(1);
    await expect(placeInput(criteria(page))).toBeFocused();
    await expect(placeInput(criteria(page))).toHaveValue("");
    // Freelance as well as CDI: both stay ticked.
    await choice(page, fr.cvReview.contractType, fr.cvReview.contractTypes.freelance).check();
    await choice(page, fr.cvReview.remoteWork, fr.cvReview.remoteWorkOptions.hybrid).check();
    // Each tick saves in turn: the last one sent before the page is reloaded.
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "PATCH" && (response.request().postData() ?? "").includes("full_remote")),
      choice(page, fr.cvReview.remoteWork, fr.cvReview.remoteWorkOptions.full_remote).check(),
    ]);
    await expect(choice(page, fr.cvReview.remoteWork, fr.cvReview.remoteWorkOptions.full_remote)).toBeChecked();

    await page.reload();
    await expect(places(page)).toHaveText(["Lyon", "Bordeaux (33)"]);
    await expect(choice(page, fr.cvReview.contractType, fr.cvReview.contractTypes.cdi)).toBeChecked();
    await expect(choice(page, fr.cvReview.contractType, fr.cvReview.contractTypes.freelance)).toBeChecked();
    await expect(choice(page, fr.cvReview.remoteWork, fr.cvReview.remoteWorkOptions.hybrid)).toBeChecked();
    await expect(choice(page, fr.cvReview.remoteWork, fr.cvReview.remoteWorkOptions.full_remote)).toBeChecked();

    // Communes, départements and régions are suggested; Escape closes the suggestions, then empties the input.
    await placeInput(criteria(page)).fill("loire");
    await expect(placeOptions(page)).toHaveText([
      `Loire-sur-Rhône (69)${fr.cvReview.placeKinds.commune}`,
      `Loire${fr.cvReview.placeKinds.departement}`,
      `Loire-Atlantique${fr.cvReview.placeKinds.departement}`,
      `Pays de la Loire${fr.cvReview.placeKinds.region}`,
    ]);
    await placeInput(criteria(page)).press("ArrowUp");
    await expect(placeOptions(page).last()).toHaveAttribute("aria-selected", "true");
    await placeInput(criteria(page)).press("Escape");
    await expect(placeInput(criteria(page))).toHaveAttribute("aria-expanded", "false");
    await expect(placeOptions(page)).toHaveCount(0);
    await expect(placeInput(criteria(page))).toHaveValue("loire");
    await placeInput(criteria(page)).press("Escape");
    await expect(placeInput(criteria(page))).toHaveValue("");

    // A suggestion can be clicked too.
    await placeInput(criteria(page)).fill("loire");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "PATCH" && (response.request().postData() ?? "").includes("Pays de la Loire")),
      placeOptions(page).filter({ hasText: "Pays de la Loire" }).click(),
    ]);
    await expect(places(page)).toHaveText(["Lyon", "Bordeaux (33)", "Pays de la Loire"]);
    await expect(placeInput(criteria(page))).toBeFocused();

    // A place already there, written with another case or without its accents, is refused with a message.
    await placeInput(criteria(page)).fill("pays de la loire");
    await placeInput(criteria(page)).press("Enter");
    await expect(criteria(page).getByRole("status").filter({ hasText: fr.cvReview.placeAlreadyListed.replace("{{place}}", "pays de la loire") })).toBeVisible();
    await expect(places(page)).toHaveText(["Lyon", "Bordeaux (33)", "Pays de la Loire"]);

    // A place with no suggestion (a foreign city) is said so, and added as typed with Enter.
    await placeInput(criteria(page)).fill("Genève");
    await expect(criteria(page).getByRole("status").filter({ hasText: fr.cvReview.noPlaceFound.replace("{{place}}", "Genève") })).toBeVisible();
    await placeInput(criteria(page)).press("Enter");
    await typePlace(criteria(page), "Remote");
    await expect(places(page)).toHaveText(["Lyon", "Bordeaux (33)", "Pays de la Loire", "Genève", "Remote"]);

    // Five places at most: the input goes, and says why; each place has its own "Retirer" button, in words.
    await expect(placeInput(criteria(page))).toHaveCount(0);
    await expect(criteria(page).getByText(fr.cvReview.placesFull.replace("{{max}}", "5"))).toBeVisible();
    await expect(removePlace(criteria(page), "Lyon")).toHaveText(fr.cvReview.removePlace);
    // Removing a place saves at once (the places without Bordeaux), the focus back on the input.
    const removal = (body: string) => body.includes("Remote") && !body.includes("Bordeaux");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/profiles/") && removal(response.request().postData() ?? "")),
      removePlace(criteria(page), "Bordeaux (33)").click(),
    ]);
    await expect(placeInput(criteria(page))).toBeFocused();

    await page.reload();
    await expect(places(page)).toHaveText(["Lyon", "Pays de la Loire", "Genève", "Remote"]);
  });

  test("suggestions start at three characters: two list nothing, three list the matching places (#235)", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-three-chars");
    await page.goto(`/profils/${id}`);
    await placeInput(criteria(page)).fill("lo");
    await expect(placeInput(criteria(page))).toHaveAttribute("aria-expanded", "false");
    await expect(placeOptions(page)).toHaveCount(0);
    await placeInput(criteria(page)).fill("loi");
    await expect(placeOptions(page).first()).toBeVisible();
    await expect(placeInput(criteria(page))).toHaveAttribute("aria-expanded", "true");
  });

  test("the last place cannot be removed: Locations is required", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-last-place", ["Lyon", "Paris"]);
    await page.goto(`/profils/${id}`);
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/profiles/")),
      removePlace(criteria(page), "Lyon").click(),
    ]);
    await expect(places(page)).toHaveText(["Paris"]);
    await expect(removePlace(criteria(page), "Paris")).toHaveCount(0);
    await page.reload();
    await expect(places(page)).toHaveText(["Paris"]);
  });

  test("Master CV edits gather into one new version, or are cancelled", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-cv-version");
    await page.goto(`/profils/${id}/cv-de-reference`);
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
    await page.goto(`/profils/${id}/cv-de-reference`);
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

  test("Sectors, Subsectors and Domains are chosen as chips, the Subsectors offered limited to the Sectors chosen, each change saving (#236)", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-sectors");
    await page.goto(`/profils/${id}`);
    const sectorInput = criteria(page).getByRole("combobox", { name: fr.cvReview.industryInputs.sectors, exact: true });
    const subsectorInput = criteria(page).getByRole("combobox", { name: fr.cvReview.industryInputs.subsectors, exact: true });
    const domainInput = criteria(page).getByRole("combobox", { name: fr.cvReview.industryInputs.domains, exact: true });
    const chips = (legend: string) => criteria(page).getByRole("group", { name: legend, exact: true }).getByRole("listitem").locator("> span");
    const options = criteria(page).getByRole("listbox").getByRole("option");
    const patched = (includes: string) =>
      page.waitForResponse((response) => response.request().method() === "PATCH" && (response.request().postData() ?? "").includes(includes));

    // No Subsector without a Sector.
    await expect(subsectorInput).toBeDisabled();
    await expect(criteria(page).getByText(fr.cvReview.subsectorsNeedSector)).toBeVisible();

    // A Sector, found by typing part of its label, chosen with the keyboard: it saves at once.
    await sectorInput.fill("financ");
    await expect(options).toHaveText(["Activités financières et d'assurance"]);
    await sectorInput.press("ArrowDown");
    await Promise.all([patched('"sectors":["K"]'), sectorInput.press("Enter")]);
    await expect(chips(fr.cvReview.sectors)).toHaveText(["Activités financières et d'assurance"]);
    await expect(sectorInput).toBeFocused();

    // The Subsectors offered are those of the Sector chosen alone, each said with its Sector.
    await subsectorInput.click();
    await expect(options).toHaveText([
      "Activités des services financiers, hors assurance et caisses de retraiteActivités financières et d'assurance",
      "AssuranceActivités financières et d'assurance",
      "Activités auxiliaires de services financiers et d'assuranceActivités financières et d'assurance",
    ]);
    await Promise.all([patched('"subsectors":["64"]'), options.first().click()]);
    await expect(chips(fr.cvReview.subsectors)).toHaveText(["Activités des services financiers, hors assurance et caisses de retraite"]);

    // A Domain, by its ROME label.
    await domainInput.fill("direction d'entreprise");
    await Promise.all([patched('"domains":["M13"]'), domainInput.press("Enter")]);
    await expect(chips(fr.cvReview.domains)).toHaveText(["Direction d'entreprise"]);

    await page.reload();
    await expect(chips(fr.cvReview.sectors)).toHaveText(["Activités financières et d'assurance"]);
    await expect(chips(fr.cvReview.subsectors)).toHaveText(["Activités des services financiers, hors assurance et caisses de retraite"]);
    await expect(chips(fr.cvReview.domains)).toHaveText(["Direction d'entreprise"]);

    // In the Search Criteria in words on Recherches d'offres.
    await page.goto(`/recherches?profil=${id}`);
    await expect(page.getByText(/· Secteur : Activités des services financiers, hors assurance et caisses de retraite · Domaine : Direction d'entreprise$/)).toBeVisible();

    // Removing the Sector takes its Subsector with it, in one save.
    await page.goto(`/profils/${id}`);
    await Promise.all([
      patched('"sectors":[],"subsectors":[]'),
      criteria(page).getByRole("button", { name: fr.cvReview.removeChoice.replace("{{label}}", "Activités financières et d'assurance"), exact: true }).click(),
    ]);
    await expect(chips(fr.cvReview.subsectors)).toHaveCount(0);
    await expect(subsectorInput).toBeDisabled();
    await page.reload();
    await expect(chips(fr.cvReview.sectors)).toHaveCount(0);
    await expect(chips(fr.cvReview.domains)).toHaveText(["Direction d'entreprise"]);
  });

  test("an archived Profile shows its Search Criteria read-only", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-archived");
    const archived = await page.request.patch(`/api/profiles/${id}`, { headers: { origin }, data: { archived: true } });
    expect(archived.ok()).toBe(true);
    await page.goto(`/profils/${id}`);
    await expect(page.getByText(fr.profileActions.archivedNotice)).toBeVisible();
    const properties = page.getByRole("term");
    await expect(properties.filter({ hasText: fr.cvReview.locations })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: /^Lyon$/ })).toBeVisible();
    await expect(placeInput(page)).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: fr.jobSearch.start, exact: true })).toHaveCount(0);
    await expect(page.locator(`a[href="/job-digests#job-digest-${id}"]`)).toHaveCount(0);
  });

  test("the Job Search and the Job Digest stay reachable without the Profile page (#238)", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-reach");
    await page.goto(`/profils/${id}`);
    await expect(page.getByRole("button", { name: fr.jobSearch.start, exact: true })).toHaveCount(0);
    await expect(page.locator("main").locator('a[href*="job-digest"]')).toHaveCount(0);

    // A Job Search starts from Recherches d'offres.
    await page.goto(`/recherches?profil=${id}`);
    await expect(page.getByRole("button", { name: fr.jobSearch.start, exact: true })).toBeVisible();

    // The Job Digest is reached from the sidebar.
    await page.goto(`/profils/${id}`);
    await page.locator('a[href="/job-digests"]').first().click();
    await expect(page).toHaveURL(/\/job-digests$/);
  });
});

test.describe("the Profile page on the ADR-0009 floor", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`at ${viewport.width}px: catalogue strings, 16px and AA contrast, visible edit affordances, 44px targets, no sideways scroll`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const id = await candidateWithProfile(page, `profile-floor-${viewport.width}`, ["Lyon", "Saint-Étienne-de-Saint-Geoirs (38)"]);
      await page.goto(`/profils/${id}/cv-de-reference`);
      await masterCvSection(page).getByLabel(fr.cvReview.headline).fill("DAF");
      await expect(saveBar(page)).toBeVisible();
      // The place suggestions shown, as the Candidate reads them.
      await placeInput(criteria(page)).fill("loire");
      await expect(placeOptions(page)).toHaveCount(4);

      const own = new Set(
        [
          masterCv.fullName,
          // The Master CV's skills, as tags over their field (#468).
          ...masterCv.skills,
          ...masterCv.experience.flatMap((job) => [`${job.title} · ${job.employer}`, `${job.period} · ${job.location}`]),
          "Directrice administrative et financière",
          fr.profileSwitcher.current.replace("{{name}}", "Directrice administrative et financière"),
          // The places, as chips, and the places suggested.
          "Lyon",
          "Saint-Étienne-de-Saint-Geoirs (38)",
          "Loire-sur-Rhône (69)",
          "Loire",
          "Loire-Atlantique",
          "Pays de la Loire",
        ].map((text) => text.trim()),
      );
      const catalogue = fromCatalogue(fr);
      // The Usage Meter's percentage, a catalogue string with the week's number in it.
      const meter = fr.usageMeter.percent.replace("{{percent}}", "0");
      const known = (text: string) => text === meter || catalogue(text);
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
      // Every control of the page is at least 2.75rem (44px) tall, but a glossary term in a sentence (#343): an inline
      // target, as long as its line (WCAG 2.5.8's inline exception).
      const main = page.locator("main");
      for (const control of await main.getByRole("button").or(main.getByRole("textbox")).or(main.getByRole("combobox")).or(main.getByRole("option")).or(main.locator("select")).all()) {
        if (!(await control.isVisible())) continue;
        if (await control.evaluate((el) => el.classList.contains("help-term"))) continue;
        const box = (await control.boundingBox())!;
        expect.soft(box.height, `height of ${await control.evaluate((el) => el.outerHTML.slice(0, 80))}`).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
});

// Firefox (and older Safari) has no `field-sizing: content`: the page's textareas
// must still grow with their text there, as in the prototype. Chromium stands in
// for such a browser: CSS.supports says no and the property is overridden.
test("where field-sizing is unsupported, the name and the Master CV's texts still show in full", async ({ page }) => {
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((...args: [string, string?]) => (args.join(" ").includes("field-sizing") ? false : supports(...(args as [string, string])))) as typeof CSS.supports;
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "textarea { field-sizing: fixed !important; }";
      document.head.append(style);
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  const id = await candidateWithProfile(page, "profile-no-field-sizing");
  await page.goto(`/profils/${id}/cv-de-reference`);
  const clipped = (field: ReturnType<Page["locator"]>) => field.evaluate((el) => el.scrollHeight - el.clientHeight);

  // "Directrice administrative et financière" wraps at 375px: it shows on every line it takes.
  await expect(title(page)).toHaveValue("Directrice administrative et financière");
  await expect(title(page)).toHaveCSS("field-sizing", "fixed");
  await expect.poll(() => clipped(title(page))).toBeLessThanOrEqual(0);
  // Two lines at the Top Bar's title size (ADR-0024).
  expect((await title(page).boundingBox())!.height).toBeGreaterThan(45);

  // It follows the text as the Candidate types.
  await title(page).fill("Directrice administrative et financière, groupe industriel international");
  await expect.poll(() => clipped(title(page))).toBeLessThanOrEqual(0);

  const skills = masterCvSection(page).getByLabel(fr.profilePage.skills);
  await skills.fill(Array.from({ length: 12 }, (_, i) => `Compétence ${i + 1}`).join("\n"));
  await expect.poll(() => clipped(skills)).toBeLessThanOrEqual(0);
});

// For the review against the prototype: PROFILE_SCREENSHOTS_DIR=<dir> keeps them there.
test.describe("the Profile page's Sections (ADR-0024)", () => {
  test("on a wide screen, each Section is listed beside the one shown and has its own address", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await candidateWithProfile(page, "profile-sections");
    const s = fr.profilePage.sections;
    await page.goto(`/profils/${id}`);

    await sectionLink(page, s["ats-score"]).click();
    await expect(page).toHaveURL(new RegExp(`/profils/${id}/ats-score$`));
    await expect(sectionLink(page, s["ats-score"])).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: fr.atsScore.title })).toBeVisible();
    await expect(masterCvSection(page)).toHaveCount(0);
    // The page's head stays on every Section.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice administrative et financière");
    await expect(places(page)).toHaveText(["Lyon"]);

    await sectionLink(page, s.telecharger).click();
    await expect(page).toHaveURL(new RegExp(`/profils/${id}/telecharger$`));
    await expect(page.getByRole("region", { name: fr.cvExport.title })).toBeVisible();

    await sectionLink(page, s.gerer).click();
    await expect(page.getByRole("region", { name: fr.profileActions.title })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/profils/${id}/telecharger$`));
    await expect(page.getByRole("region", { name: fr.cvExport.title })).toBeVisible();
  });

  test("on a phone, the Profile's page is the list of its Sections, each shown alone with a way back", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const id = await candidateWithProfile(page, "profile-sections-phone");
    const s = fr.profilePage.sections;
    await page.goto(`/profils/${id}`);
    await expect(sectionsNav(page)).toBeVisible();
    await expect(masterCvSection(page)).toBeHidden();

    await sectionLink(page, s["cv-de-reference"]).click();
    await expect(page).toHaveURL(new RegExp(`/profils/${id}/cv-de-reference$`));
    await expect(masterCvSection(page)).toBeVisible();
    await expect(sectionsNav(page)).toBeHidden();

    await page.getByRole("link", { name: s.backToSections, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/profils/${id}$`));
    await expect(sectionsNav(page)).toBeVisible();
  });

  test("a Section the Profile does not have is not found, nor listed", async ({ page }) => {
    const id = await candidateWithProfile(page, "profile-sections-absent");
    // No Action Cards: Propositions leads back to the Profile's page.
    await page.goto(`/profils/${id}/propositions`);
    await expect(page).toHaveURL(new RegExp(`/profils/${id}$`));

    // The Job Digest is not one of a Profile's Sections: it has its own page (ADR-0024).
    expect((await page.request.get(`/profils/${id}/job-digest`)).status()).toBe(404);
    await page.goto(`/profils/${id}`);
    await expect(sectionLink(page, fr.profilePage.sections.gerer)).toBeVisible();
  });
});

test("screenshots of the Profile page at 375, 900 and 1440px, with unsaved Master CV edits", async ({ page }, testInfo) => {
  // Several places, as chips with their "Retirer" buttons (#235); Sectors, a Subsector and a Domain (#236).
  const id = await candidateWithProfile(page, "profile-screens", ["Lyon", "Bordeaux (33)", "Saint-Étienne-de-Saint-Geoirs (38)"], {
    sectors: ["C", "K"],
    subsectors: ["29"],
    domains: ["M13"],
  });
  const dir = process.env.PROFILE_SCREENSHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [width, height] of [
    [375, 812],
    [900, 1000],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(`/profils/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const top = dir ? `${dir}/${width}-profile.png` : testInfo.outputPath(`${width}-profile.png`);
    await page.screenshot({ path: top });
    await testInfo.attach(`${width}px profile`, { path: top, contentType: "image/png" });

    // Below 64rem the Profile's page is the list of its Sections: the Master CV is a Section of its own.
    await page.goto(`/profils/${id}/cv-de-reference`);
    await masterCvSection(page).getByLabel(fr.cvReview.summary).fill("Plus de 15 ans dans l'industrie et la distribution.");
    await expect(saveBar(page)).toBeVisible();
    const cv = dir ? `${dir}/${width}-master-cv.png` : testInfo.outputPath(`${width}-master-cv.png`);
    await page.screenshot({ path: cv, fullPage: true });
    await testInfo.attach(`${width}px Master CV`, { path: cv, contentType: "image/png" });
  }
});

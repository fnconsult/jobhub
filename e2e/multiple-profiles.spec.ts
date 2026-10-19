import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #7: a Candidate has several Profiles (positionings). They create one
// from scratch or from a CV, duplicate, rename and archive them, and move
// between them with the Profile switcher. A Free Candidate holds one active
// Profile (Plan Quota, issue #22): tests that need more subscribe first.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "" }],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

/** Signs a new Candidate in and puts them on `plan`, which allows several active Profiles. */
async function signInOn(page: Page, label: string, plan: "standard" | "premium" = "standard") {
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  await subscribe(page, email, plan);
}

/** Saves a Profile the way the review form does, and returns its id. */
async function createProfile(page: Page, targetRole: string): Promise<string> {
  const response = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole, location: "Lyon", contractType: "cdi" } },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

const switcherOf = (page: Page) => page.getByRole("navigation", { name: fr.profileSwitcher.label });
/** The button that opens the Profile switcher's menu, named after the Profile being shown. */
const switcherButtonOf = (page: Page) => switcherOf(page).getByRole("button");
const currentProfile = (name: string) => fr.profileSwitcher.current.replace("{{name}}", name);
/** The Profile page's title (#137): the Profile's name, edited in place. */
const profileName = (page: Page) => page.getByLabel(fr.profileActions.name, { exact: true });
/** The Profile page's Search Criteria (#137), each edited in place. */
const criteriaOf = (page: Page) => page.getByRole("group", { name: fr.cvReview.searchCriteria });
const masterCvOf = (page: Page) => page.getByRole("region", { name: fr.profile.masterCv });
/** Opens a Section of the Profile's page from the list beside it (ADR-0024). */
const openSection = (page: Page, name: string) =>
  page.getByRole("navigation", { name: fr.profilePage.sections.sectionsLabel }).getByRole("link", { name, exact: true }).click();

/** Opens the Profile switcher with the mouse and returns its menu. */
async function openSwitcher(page: Page) {
  await switcherButtonOf(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("several Profiles per Candidate", () => {
  test("a Candidate duplicates a Profile, renames the copy and switches between them", async ({ page }) => {
    await signInOn(page, "duplicate");
    const firstId = await createProfile(page, "Directrice financière");
    await page.goto(`/profils/${firstId}/gerer`);
    await expect(switcherButtonOf(page)).toHaveText(currentProfile("Directrice financière"));

    const duplicateName = page.getByLabel(fr.profileActions.duplicateName);
    await expect(duplicateName).toHaveValue("Directrice financière (copie)");
    await duplicateName.fill("Consultante transformation");
    await page.getByRole("button", { name: fr.profileActions.duplicate }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consultante transformation");
    await expect(page).not.toHaveURL(`${origin}/profils/${firstId}`);
    await expect(criteriaOf(page).getByLabel(fr.cvReview.contractType)).toHaveValue("cdi");
    await expect(masterCvOf(page).getByText("Directrice financière · Groupe Seb", { exact: true })).toBeVisible();
    await expect(masterCvOf(page).getByText(/^Version 1 · /)).toBeVisible();

    // Renamed in place: the title saves when the Candidate leaves it.
    const name = profileName(page);
    await expect(name).toHaveValue("Consultante transformation");
    await name.fill("Consultante en transformation financière");
    await name.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: fr.profilePage.nameSaved })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consultante en transformation financière");
    await expect(page).toHaveTitle(`Consultante en transformation financière · ${fr.app.name}`);

    const switcher = await openSwitcher(page);
    await expect(switcher.getByRole("menuitem", { name: "Consultante en transformation financière" })).toHaveAttribute("aria-current", "page");
    await switcher.getByRole("menuitem", { name: "Directrice financière" }).click();
    await expect(page).toHaveURL(`${origin}/profils/${firstId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice financière");
  });

  test("a Profile name never goes over the limit: target role capped, copy name shortened to fit", async ({ page }) => {
    await signInOn(page, "long-name");
    const tooLong = await page.request.post("/api/profiles", {
      headers: { origin },
      data: { masterCv, searchCriteria: { targetRole: "R".repeat(121), location: "Lyon" } },
    });
    expect(tooLong.status()).toBe(400);
    expect((await tooLong.json()).errors).toEqual([{ field: "searchCriteria.targetRole", code: "too_long" }]);

    await page.goto("/profils/nouveau");
    await page.getByRole("button", { name: fr.cvUpload.fromScratch }).click();
    await expect(page.getByLabel(fr.cvReview.targetRole)).toHaveAttribute("maxlength", "120");

    const id = await createProfile(page, "x".repeat(118));
    await page.goto(`/profils/${id}/gerer`);
    const duplicateName = page.getByLabel(fr.profileActions.duplicateName);
    const suggested = `${"x".repeat(112)} (copie)`;
    await expect(duplicateName).toHaveValue(suggested);
    await page.getByRole("button", { name: fr.profileActions.duplicate }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(suggested);
    await expect(page).not.toHaveURL(`${origin}/profils/${id}`);
  });

  test("renaming needs a name", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("rename-empty"));
    const id = await createProfile(page, "DAF");
    await page.goto(`/profils/${id}`);

    // A blank name is not saved: the title goes back to the saved name.
    const name = profileName(page);
    await name.fill("  ");
    await name.press("Enter");
    await expect(name).toHaveValue("DAF");
    await expect(page.getByRole("status").filter({ hasText: fr.profilePage.nameSaved })).toHaveCount(0);
    // The server refuses one too.
    const blank = await page.request.patch(`/api/profiles/${id}`, { headers: { origin }, data: { name: "  " } });
    expect(blank.status()).toBe(400);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAF");
  });

  test("archiving takes a Profile out of the switcher without losing it, and restoring brings it back", async ({ page }) => {
    await signInOn(page, "archive");
    await createProfile(page, "Directrice financière");
    const oldId = await createProfile(page, "Contrôleuse de gestion");
    await page.goto(`/profils/${oldId}/gerer`);

    await page.getByRole("button", { name: fr.profileActions.archive }).click();
    await expect(page.getByText(fr.profileActions.archivedNotice)).toBeVisible();
    await openSection(page, fr.profilePage.sections["cv-de-reference"]);
    await expect(masterCvOf(page).getByText("Directrice financière · Groupe Seb", { exact: true })).toBeVisible();
    let switcher = await openSwitcher(page);
    await expect(switcher.getByRole("menuitem", { name: "Contrôleuse de gestion" })).toHaveCount(0);
    await expect(switcher.getByRole("menuitem", { name: "Directrice financière" })).toBeVisible();

    await page.goto("/compte");
    const archived = page.getByRole("region", { name: fr.profiles.archivedTitle });
    await archived.getByRole("link", { name: "Contrôleuse de gestion" }).click();
    await openSection(page, fr.profilePage.sections.gerer);
    await page.getByRole("button", { name: fr.profileActions.restore }).click();
    await expect(page.getByText(fr.profileActions.archivedNotice)).toHaveCount(0);
    switcher = await openSwitcher(page);
    await expect(switcher.getByRole("menuitem", { name: "Contrôleuse de gestion" })).toBeVisible();
  });

  test("a Candidate who has a Profile can add another, from scratch, without a CV", async ({ page }) => {
    await signInOn(page, "scratch");
    await createProfile(page, "Directrice financière");
    await page.goto("/compte");
    await page.getByRole("link", { name: fr.profiles.add }).click();
    await expect(page).toHaveURL(`${origin}/profils/nouveau`);

    await page.getByRole("button", { name: fr.cvUpload.fromScratch }).click();
    const criteria = page.getByRole("group", { name: fr.cvReview.searchCriteria });
    await expect(criteria.getByLabel(fr.cvReview.targetRole, { exact: true })).toHaveValue("");
    await expect(page.getByLabel(fr.cvReview.fullName)).toHaveValue("");
    await criteria.getByLabel(fr.cvReview.targetRole, { exact: true }).fill("Consultante transformation");
    await criteria.getByLabel(fr.cvReview.location, { exact: true }).fill("Paris");
    await page.getByLabel(fr.cvReview.fullName).fill("Marie Dupont");
    await page.getByRole("button", { name: fr.cvReview.save }).click();

    await expect(page).toHaveURL(/\/profils\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consultante transformation");
    const switcher = await openSwitcher(page);
    await expect(switcher.getByRole("menuitem")).toHaveText(["Directrice financière", "Consultante transformation", fr.profiles.add]);
  });

  // Premium's Profile quota is unlimited: creating, duplicating and restoring are never refused.
  test("on Premium, the number of Profiles is not limited", async ({ page }) => {
    await signInOn(page, "no-quota", "premium");
    const roles = ["DAF", "Contrôleuse de gestion", "Consultante", "Trésorière", "Auditrice"];
    const ids: string[] = [];
    for (const role of roles) ids.push(await createProfile(page, role));

    const duplicate = await page.request.post(`/api/profiles/${ids[0]}/duplicate`, { headers: { origin }, data: { name: "DAF bis" } });
    expect(duplicate.status()).toBe(201);
    expect((await page.request.patch(`/api/profiles/${ids[1]}`, { headers: { origin }, data: { archived: true } })).status()).toBe(200);
    const restore = await page.request.patch(`/api/profiles/${ids[1]}`, { headers: { origin }, data: { archived: false } });
    expect(restore.status()).toBe(200);
    expect(await restore.json()).not.toHaveProperty("error");

    await page.goto("/compte");
    await expect(page.getByText(fr.profiles.quotaReached)).toHaveCount(0);
    await expect(page.getByRole("link", { name: fr.profiles.add }).first()).toBeVisible();
    const switcher = await openSwitcher(page);
    await expect(switcher.getByRole("menuitem")).toHaveText([...roles, "DAF bis", fr.profiles.add]);
  });

  test("a Free Candidate holds one active Profile: a second one is refused with an Upgrade Prompt to Standard", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("free-profiles"));
    const firstId = await createProfile(page, "Directrice financière");
    const upgrade = {
      message: "L'offre Gratuite comprend 1 profil. Avec l'offre Standard, vous pouvez en créer davantage.",
      action: "Découvrir l'offre Standard",
    };

    // The API refuses, and says what to show.
    const refused = await page.request.post("/api/profiles", {
      headers: { origin },
      data: { masterCv, searchCriteria: { targetRole: "Consultante", location: "Lyon" } },
    });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: "plan_quota_reached",
      prompt: { title: fr.billing.quotaReached.title, message: upgrade.message, upgradeTo: "standard", action: upgrade.action, href: "/abonnement" },
    });

    // Duplicating from the Profile page shows the Upgrade Prompt.
    await page.goto(`/profils/${firstId}/gerer`);
    await page.getByRole("button", { name: fr.profileActions.duplicate }).click();
    const prompt = page.getByRole("alert").filter({ hasText: fr.billing.quotaReached.title });
    await expect(prompt).toContainText(upgrade.message);
    await expect(prompt.getByRole("link", { name: upgrade.action })).toHaveAttribute("href", "/abonnement");
    await expect(page).toHaveURL(`${origin}/profils/${firstId}/gerer`);

    // So does the new Profile page, instead of the forms.
    await page.goto("/profils/nouveau");
    await expect(page.getByRole("button", { name: fr.cvUpload.fromScratch })).toHaveCount(0);
    await page.getByRole("alert").filter({ hasText: upgrade.message }).getByRole("link", { name: upgrade.action }).click();
    await expect(page).toHaveURL(`${origin}/abonnement`);

    // Archiving makes room for another; restoring the archived one is then refused too.
    expect((await page.request.patch(`/api/profiles/${firstId}`, { headers: { origin }, data: { archived: true } })).status()).toBe(200);
    await createProfile(page, "Consultante");
    const restore = await page.request.patch(`/api/profiles/${firstId}`, { headers: { origin }, data: { archived: false } });
    expect(restore.status()).toBe(409);
    expect(await restore.json()).toMatchObject({ error: "plan_quota_reached", prompt: { upgradeTo: "standard", href: "/abonnement" } });
  });

  // Issue #133: the switcher is a Radix dropdown menu (ADR-0018), so it follows the WAI-ARIA menu button pattern.
  test("the Profile switcher is a menu button a Candidate can use with the keyboard and a screen reader", async ({ page }) => {
    await signInOn(page, "switcher-keyboard");
    const firstId = await createProfile(page, "Directrice financière");
    const secondId = await createProfile(page, "Consultante transformation");
    await page.goto(`/profils/${secondId}`);

    // A screen reader announces a button named after the Profile shown, which opens a menu.
    const button = switcherOf(page).getByRole("button", { name: currentProfile("Consultante transformation") });
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // Enter opens it on the first item; the menu is named by its button and marks the Profile shown.
    await button.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: currentProfile("Consultante transformation") });
    await expect(menu).toBeVisible();
    // The menu is modal: while it is open, a screen reader reads only the menu (the rest of the page is aria-hidden).
    await expect(switcherOf(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: currentProfile("Consultante transformation"), includeHidden: true })).toHaveAttribute("aria-expanded", "true");
    const items = menu.getByRole("menuitem");
    await expect(items).toHaveText(["Directrice financière", "Consultante transformation", fr.profiles.add]);
    await expect(items.nth(1)).toHaveAttribute("aria-current", "page");
    await expect(items.nth(0)).not.toHaveAttribute("aria-current");
    await expect(items.nth(0)).toBeFocused();

    // Arrow keys move between items, with a visible focus ring (ADR-0009); Home and End jump to either end.
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await expect(items.nth(1)).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("End");
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(items.nth(0)).toBeFocused();

    // Escape closes it and gives focus back to the button.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // ArrowDown opens it too, and Enter on an item goes to that Profile.
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${origin}/profils/${firstId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice financière");
    await expect(switcherOf(page).getByRole("button", { name: currentProfile("Directrice financière") })).toHaveAttribute("aria-expanded", "false");
  });

  test("the Profile page meets the ADR-0009 floor", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("profile-floor"));
    const id = await createProfile(page, "DAF");
    await page.goto(`/profils/${id}`);
    await openSwitcher(page);
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("editing a Profile's Search Criteria (issue #70)", () => {
  test("a Candidate changes \"Poste recherché\" and the location; after a reload the new values show, the Profile keeps its name, and the Match Score on an Application of that Profile uses them", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("edit-criteria"));
    const id = await createProfile(page, "Directrice financière");

    // An Application of that Profile, saved before the change: its Match Score compares the offer with the old criteria.
    const offer = await page.request.post("/api/job-offers", {
      headers: { origin },
      data: { source: { url: `https://example.fr/offres/daf-${Date.now()}` }, title: "DAF (H/F)", content: `DAF à Paris (${Date.now()}).`, location: "Paris" },
    });
    expect(offer.status(), await offer.text()).toBe(200);
    const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await offer.json()).id, profileId: id } });
    expect(saved.ok(), await saved.text()).toBe(true);
    const applicationId = (await saved.json()).id;
    const locationScore = () =>
      page.getByRole("region", { name: fr.matchScore.title }).getByRole("listitem").filter({ hasText: fr.matchScore.criteria.location });
    const offerAndWanted = (wanted: string) => fr.matchScore.offerAndWanted.replace("{{offer}}", "Paris").replace("{{wanted}}", wanted);

    await page.goto(`/candidatures/${applicationId}/correspondance`);
    await expect(locationScore()).toContainText(offerAndWanted("Lyon"));
    await expect(locationScore().locator(".verdict")).toHaveText(fr.matchScore.statuses.mismatch);

    await page.goto(`/profils/${id}`);
    const criteria = criteriaOf(page);
    await expect(criteria.getByLabel(fr.cvReview.targetRole)).toHaveValue("Directrice financière");
    await criteria.getByLabel(fr.cvReview.targetRole).fill("Directrice administrative et financière");
    await criteria.getByLabel(fr.cvReview.targetRole).press("Tab");
    await expect(criteria.getByRole("status").filter({ hasText: fr.profilePage.criteriaSaved })).toHaveCount(1);
    await criteria.getByLabel(fr.cvReview.location, { exact: true }).fill("Paris");
    await criteria.getByLabel(fr.cvReview.location, { exact: true }).press("Enter");
    await expect(criteria.getByRole("status").filter({ hasText: fr.profilePage.criteriaSaved })).toHaveCount(2);

    await page.reload();
    await expect(criteria.getByLabel(fr.cvReview.targetRole)).toHaveValue("Directrice administrative et financière");
    await expect(criteria.getByLabel(fr.cvReview.location, { exact: true })).toHaveValue("Paris");
    await expect(criteria.getByLabel(fr.cvReview.contractType)).toHaveValue("cdi");
    // The name is not tied to the target role: the Candidate renames the Profile separately.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice financière");
    await openSection(page, fr.profilePage.sections["ats-score"]);
    await expect(page.getByText(fr.atsScore.intro.replace("{{role}}", "Directrice administrative et financière"))).toBeVisible();

    await page.goto(`/candidatures/${applicationId}/correspondance`);
    await expect(locationScore()).toContainText(offerAndWanted("Paris"));
    await expect(locationScore().locator(".verdict")).toHaveText(fr.matchScore.statuses.match);
  });

  test("invalid criteria name the fields to fix; another Candidate's Profile is not found; an archived Profile is read-only", async ({ page, browser }) => {
    await signInOn(page, "edit-criteria-refused");
    const id = await createProfile(page, "DAF");
    const patch = (data: object, on = page) => on.request.patch(`/api/profiles/${id}`, { headers: { origin }, data });

    const invalid = await patch({ searchCriteria: { targetRole: "", location: "Lyon", contractType: "stage" } });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).errors).toEqual(
      expect.arrayContaining([
        { field: "searchCriteria.targetRole", code: "required" },
        { field: "searchCriteria.contractType", code: "invalid" },
      ]),
    );

    const other = await browser.newContext({ baseURL: origin });
    const otherPage = await other.newPage();
    await signInWithMagicLink(otherPage, newAddress("edit-criteria-other"));
    expect((await patch({ searchCriteria: { targetRole: "Piraté", location: "Paris" } }, otherPage)).status()).toBe(404);
    await other.close();

    expect((await patch({ archived: true })).status()).toBe(200);
    const archived = await patch({ searchCriteria: { targetRole: "DAF", location: "Paris" } });
    expect(archived.status()).toBe(409);
    expect(await archived.json()).toEqual({ error: "archived" });
    await page.goto(`/profils/${id}`);
    await expect(criteriaOf(page)).toHaveCount(0);
    await expect(page.getByRole("term").filter({ hasText: fr.cvReview.targetRole })).toBeVisible();

    expect((await patch({ archived: false })).status()).toBe(200);
    expect((await patch({ name: "DAF industrie" })).status()).toBe(200);
    await page.goto(`/profils/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAF industrie");
    await expect(criteriaOf(page).getByLabel(fr.cvReview.location, { exact: true })).toHaveValue("Lyon");
  });
});

test.describe("Profile change endpoints", () => {
  test("refuse anonymous visitors and other sites, and never change another Candidate's Profile", async ({ page, browser }) => {
    const someId = "00000000-0000-4000-8000-000000000000";
    expect((await page.request.patch(`/api/profiles/${someId}`, { headers: { origin }, data: { name: "x" } })).status()).toBe(401);
    expect((await page.request.post(`/api/profiles/${someId}/duplicate`, { headers: { origin }, data: { name: "x" } })).status()).toBe(401);

    await signInWithMagicLink(page, newAddress("change-owner"));
    const id = await createProfile(page, "DAF");
    const crossSite = await page.request.patch(`/api/profiles/${id}`, { headers: { origin: "https://evil.example" }, data: { name: "x" } });
    expect(crossSite.status()).toBe(403);
    expect((await page.request.patch(`/api/profiles/${id}`, { headers: { origin }, data: { archived: "yes" } })).status()).toBe(400);

    const other = await browser.newContext({ baseURL: origin });
    const otherPage = await other.newPage();
    await signInWithMagicLink(otherPage, newAddress("change-other"));
    expect((await otherPage.request.patch(`/api/profiles/${id}`, { headers: { origin }, data: { name: "Piraté" } })).status()).toBe(404);
    expect((await otherPage.request.patch(`/api/profiles/${id}`, { headers: { origin }, data: { archived: true } })).status()).toBe(404);
    expect((await otherPage.request.post(`/api/profiles/${id}/duplicate`, { headers: { origin }, data: { name: "Copie" } })).status()).toBe(404);
    await other.close();

    await page.goto(`/profils/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAF");
    await expect(page.getByText(fr.profileActions.archivedNotice)).toHaveCount(0);
  });
});

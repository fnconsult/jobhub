import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #7: a Candidate has several Profiles (positionings). They create one
// from scratch or from a CV, duplicate, rename and archive them, and move
// between them with the Profile switcher.
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

async function openSwitcher(page: Page) {
  const switcher = switcherOf(page);
  await switcher.locator("summary").click();
  return switcher;
}

test.describe("several Profiles per Candidate", () => {
  test("a Candidate duplicates a Profile, renames the copy and switches between them", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("duplicate"));
    const firstId = await createProfile(page, "Directrice financière");
    await page.goto(`/profils/${firstId}`);
    await expect(switcherOf(page).locator("summary")).toHaveText(fr.profileSwitcher.current.replace("{{name}}", "Directrice financière"));

    const duplicateName = page.getByLabel(fr.profileActions.duplicateName);
    await expect(duplicateName).toHaveValue("Directrice financière (copie)");
    await duplicateName.fill("Consultante transformation");
    await page.getByRole("button", { name: fr.profileActions.duplicate }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consultante transformation");
    await expect(page).not.toHaveURL(`${origin}/profils/${firstId}`);
    await expect(page.getByText(fr.cvReview.contractTypes.cdi, { exact: true })).toBeVisible();
    await expect(page.getByText("Directrice financière · Groupe Seb · Lyon · 2015 – 2024")).toBeVisible();
    await expect(page.getByText("Version 1")).toBeVisible();

    const name = page.getByLabel(fr.profileActions.name, { exact: true });
    await expect(name).toHaveValue("Consultante transformation");
    await name.fill("Consultante en transformation financière");
    await page.getByRole("button", { name: fr.profileActions.rename }).click();
    await expect(page.getByRole("status").filter({ hasText: fr.profileActions.renamed })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Consultante en transformation financière");
    await expect(page).toHaveTitle(`Consultante en transformation financière · ${fr.app.name}`);

    const switcher = await openSwitcher(page);
    await expect(switcher.getByRole("link", { name: "Consultante en transformation financière" })).toHaveAttribute("aria-current", "page");
    await switcher.getByRole("link", { name: "Directrice financière" }).click();
    await expect(page).toHaveURL(`${origin}/profils/${firstId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Directrice financière");
  });

  test("renaming needs a name", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("rename-empty"));
    const id = await createProfile(page, "DAF");
    await page.goto(`/profils/${id}`);

    const name = page.getByLabel(fr.profileActions.name, { exact: true });
    await name.fill("  ");
    await page.getByRole("button", { name: fr.profileActions.rename }).click();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAccessibleDescription(fr.cvReview.required);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAF");
  });

  test("archiving takes a Profile out of the switcher without losing it, and restoring brings it back", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("archive"));
    await createProfile(page, "Directrice financière");
    const oldId = await createProfile(page, "Contrôleuse de gestion");
    await page.goto(`/profils/${oldId}`);

    await page.getByRole("button", { name: fr.profileActions.archive }).click();
    await expect(page.getByText(fr.profileActions.archivedNotice)).toBeVisible();
    await expect(page.getByText("Directrice financière · Groupe Seb · Lyon · 2015 – 2024")).toBeVisible();
    let switcher = await openSwitcher(page);
    await expect(switcher.getByRole("link", { name: "Contrôleuse de gestion" })).toHaveCount(0);
    await expect(switcher.getByRole("link", { name: "Directrice financière" })).toBeVisible();

    await page.goto("/compte");
    const archived = page.getByRole("region", { name: fr.profiles.archivedTitle });
    await archived.getByRole("link", { name: "Contrôleuse de gestion" }).click();
    await page.getByRole("button", { name: fr.profileActions.restore }).click();
    await expect(page.getByText(fr.profileActions.archivedNotice)).toHaveCount(0);
    switcher = await openSwitcher(page);
    await expect(switcher.getByRole("link", { name: "Contrôleuse de gestion" })).toBeVisible();
  });

  test("a Candidate who has a Profile can add another, from scratch, without a CV", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("scratch"));
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
    await expect(switcher.getByRole("link")).toHaveText(["Directrice financière", "Consultante transformation", fr.profiles.add]);
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

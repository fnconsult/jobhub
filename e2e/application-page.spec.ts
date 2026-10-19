import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #136: the Application page is redesigned as in the approved prototype
// (#132), inside the sidebar layout (#134): a document with its title, the Job
// Offer at a glance and its properties edited in place, the Tailored Documents
// in tabs, the Match Score's breakdown verdict first, then the Interviews; all
// on the ADR-0009 floor. Since ADR-0024 each part is a Section at its own address.
// The AI Coach is Mistral, faked by e2e/support/fake-mistral.mjs.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const td = fr.tailoredDocuments;
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TITLE = "Directeur administratif et financier (H/F)";

const masterCv = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "catherine.morel@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Sorelis", location: "Lyon", period: "2000 – 2026", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "Consolidation", "Trésorerie"],
  languages: [],
};

/** Signs a new Candidate in, saves an Application on a detailed Job Offer and opens it. */
async function openApplication(page: Page, label: string): Promise<{ id: string; sourceUrl: string }> {
  await signInWithMagicLink(page, newAddress(label));
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon", minSalary: 85_000, contractType: "cdi" } },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const sourceUrl = `https://www.apec.fr/offres/daf-${unique()}`;
  const captured = await page.request.post("/api/job-offers", {
    data: {
      source: { url: sourceUrl },
      title: TITLE,
      content: "Groupe Ferlac recrute son DAF. Vous pilotez la consolidation IFRS et la trésorerie du groupe.",
      employer: "Groupe Ferlac",
      location: "Villeurbanne (69)",
      contractType: "cdi",
      salary: { min: 95_000, max: 110_000 },
      skills: ["IFRS", "Consolidation", "SAP S/4HANA"],
      requiredExperienceYears: 15,
    },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", {
    data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id },
    headers: { origin },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  await page.goto(`/candidatures/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE);
  return { id, sourceUrl };
}

/** The link to one of the Application's Sections (ADR-0024). */
const sectionLink = (page: Page, name: string) => page.getByRole("navigation", { name: fr.application.sections.sectionsLabel }).getByRole("link", { name });
const documents = (page: Page) => page.getByRole("region", { name: fr.application.documentsTitle });
const tab = (page: Page, name: string) => documents(page).getByRole("tab", { name, exact: true });
const panel = (page: Page, name: string) => documents(page).getByRole("tabpanel", { name, exact: true });

/** Every visible text at the ADR-0009 floor: 16px at least, 4.5:1 contrast at least. */
async function expectAccessibilityFloor(page: Page) {
  for (const t of await renderedTexts(page)) {
    expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
    expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
  }
}

test.describe("the Application page", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("reads as a document: the title, the Job Offer at a glance and the Application's properties", async ({ page }) => {
    const { id, sourceUrl } = await openApplication(page, "application-page-head");
    const head = page.getByRole("main").locator("header").first();

    await expect(head.getByRole("link", { name: fr.application.backToApplications })).toHaveAttribute("href", "/candidatures");
    await expect(head.getByText("Groupe Ferlac · Villeurbanne (69) · CDI · De 95 000 à 110 000 € brut par an", { exact: true })).toBeVisible();

    // Properties: a label beside each value.
    const props = head.getByRole("definition");
    await expect(head.getByRole("term")).toHaveText([
      fr.application.statusLabel,
      fr.application.profileLabel,
      fr.application.matchLabel,
      fr.application.savedOnLabel,
      fr.application.offerLabel,
    ]);
    await expect(props.nth(0).getByRole("combobox", { name: fr.application.statusLabel })).toHaveValue("to_apply");
    await expect(props.nth(1).getByRole("combobox", { name: fr.application.profileLabel })).toHaveAccessibleDescription(fr.application.profileHint);
    await expect(props.nth(2).getByText(/^\d{1,3} \/ 100$/)).toBeVisible();
    await expect(props.nth(3)).toHaveText(new Intl.DateTimeFormat("fr", { dateStyle: "full", timeZone: "Europe/Paris" }).format(new Date()));
    await expect(props.nth(4).getByRole("link", { name: "Voir l'offre sur apec.fr" })).toHaveAttribute("href", sourceUrl);

    // The status is changed in place, and kept.
    await props.nth(0).getByRole("combobox").selectOption({ label: fr.applicationStatuses.applied });
    await expect(props.nth(0).getByRole("status")).toHaveText(fr.application.statusSaved);
    await page.reload();
    await expect(page.getByLabel(fr.application.statusLabel)).toHaveValue("applied");

    // "Voir le détail" leads to the Match Score's breakdown.
    await head.getByRole("link", { name: fr.application.matchDetail }).click();
    await expect(page).toHaveURL(new RegExp(`/candidatures/${id}/correspondance$`));
    await expect(page.getByRole("heading", { name: fr.matchScore.title })).toBeInViewport();

    await expectAccessibilityFloor(page);
  });

  test("the Match Score's breakdown gives each criterion's verdict in words first", async ({ page }) => {
    await openApplication(page, "application-page-score");
    // A Section of its own (ADR-0024), listed beside the one shown.
    await sectionLink(page, fr.application.sections.correspondance).click();
    await expect(page).toHaveURL(/\/correspondance$/);
    const score = page.getByRole("region", { name: fr.matchScore.title });
    await expect(score.getByRole("heading", { level: 2 })).toHaveText(fr.matchScore.title);
    await expect(score.getByText(/^\d{1,3} \/ 100$/)).toBeVisible();

    const criteria = score.getByRole("listitem").filter({ has: page.locator(".breakdown-criterion") });
    await expect(criteria.locator(".breakdown-criterion")).toHaveText(Object.values(fr.matchScore.criteria) as string[]);
    const verdicts = Object.values(fr.matchScore.statuses) as string[];
    for (const verdict of await criteria.locator(".verdict").allTextContents()) expect(verdicts).toContain(verdict);
    // Skills: IFRS and Consolidation covered, SAP S/4HANA missing. The salary and the contract type match.
    await expect(criteria.filter({ hasText: fr.matchScore.criteria.skills }).locator(".verdict")).toHaveText(fr.matchScore.statuses.partial);
    await expect(criteria.filter({ hasText: fr.matchScore.criteria.skills }).getByText("SAP S/4HANA")).toBeVisible();
    await expect(criteria.filter({ hasText: fr.matchScore.criteria.contractType }).locator(".verdict")).toHaveText(fr.matchScore.statuses.match);
  });

  test("the Tailored Documents are tabs, worked with the keyboard, and keep unsaved edits from one tab to another", async ({ page }) => {
    const { id } = await openApplication(page, "application-page-tabs");
    await page.goto(`/candidatures/${id}/documents`);
    await expect(documents(page).getByRole("heading", { level: 2 })).toHaveText(fr.application.documentsTitle);
    await expect(documents(page).getByRole("tab")).toHaveText([fr.tailoredCv.tailored, td.coverLetter.title, td.outreachMessage.title]);
    await expect(tab(page, fr.tailoredCv.tailored)).toHaveAttribute("aria-selected", "true");
    await expect(panel(page, fr.tailoredCv.tailored).getByRole("button", { name: fr.tailoredCv.propose })).toBeVisible();
    await expect(panel(page, td.coverLetter.title)).toBeHidden();

    // One Document Language, above the tabs, for all three.
    await expect(documents(page).getByLabel(td.languageLabel)).toHaveCount(1);
    await expect(documents(page).getByLabel(td.languageLabel)).toHaveValue("fr");

    // Arrow keys move between the tabs.
    await tab(page, fr.tailoredCv.tailored).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, td.coverLetter.title)).toBeFocused();
    await expect(tab(page, td.coverLetter.title)).toHaveAttribute("aria-selected", "true");
    const letter = panel(page, td.coverLetter.title);
    await expect(letter.getByText(td.draftsOnly)).toBeVisible();
    await expect(panel(page, fr.tailoredCv.tailored)).toBeHidden();

    await letter.getByRole("button", { name: td.coverLetter.draft }).click();
    await expect(letter.getByRole("status")).toHaveText(td.drafted);
    await letter.getByLabel(td.coverLetter.textLabel).fill("Madame, Monsieur,\n\nMa lettre, pas encore enregistrée.");

    await tab(page, td.outreachMessage.title).click();
    await expect(panel(page, td.outreachMessage.title).getByRole("button", { name: td.outreachMessage.draft })).toBeVisible();
    await tab(page, td.coverLetter.title).click();
    await expect(letter.getByLabel(td.coverLetter.textLabel)).toHaveValue("Madame, Monsieur,\n\nMa lettre, pas encore enregistrée.");

    await expectAccessibilityFloor(page);
  });

  test("works at phone width: properties stacked, nothing off the side, every text on the ADR-0009 floor", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openApplication(page, "application-page-phone");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    // Each label sits above its value.
    const head = page.getByRole("main").locator("header").first();
    const label = (await head.getByRole("term").first().boundingBox())!;
    const value = (await head.getByRole("definition").first().boundingBox())!;
    expect(value.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    await expectAccessibilityFloor(page);
  });

  test("names every button and link in words, never an icon alone", async ({ page }) => {
    await openApplication(page, "application-page-labels");
    const unlabelled = await page
      .getByRole("main")
      .evaluate((main) =>
        Array.from(main.querySelectorAll("button, a[href]"))
          .filter((el) => (el as HTMLElement).offsetParent !== null && !(el as HTMLElement).innerText.trim())
          .map((el) => el.outerHTML),
      );
    expect(unlabelled).toEqual([]);
  });
});

test("screenshots of the Application page at 3 widths", async ({ page }, testInfo) => {
  await openApplication(page, "application-page-screens");
  const dir = process.env.APPLICATION_SCREENSHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });
  for (const [width, height] of [
    [375, 812],
    [900, 1000],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const path = dir ? `${dir}/${width}-application.png` : testInfo.outputPath(`${width}-application.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(`${width}px Application`, { path, contentType: "image/png" });
  }
});

import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { MARIE_DUPONT_CV, pdfCv } from "../apps/web/src/cv/test-support";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { comparesScreenshots, SCREENSHOT_WIDTHS } from "./support/screenshots";

// Issue #468 (ADR-0053): Candidate pages in the Design System. Screenshot baselines, light, at three widths, of the
// Profile (its head, its Sections as tabs, its Master CV in cards, the ATS Score card, the save bar), the File upload's
// states (empty, a file chosen, a file refused, a file being read) and « Documents adaptés » (the saved Tailored CV in
// the Viewer, beside its aside). axe runs on each. Only the page (`#main`) is compared, or the File upload alone: the
// shell has its own baselines. Dates are masked. How to update a baseline on purpose: docs/agents/screenshot-baselines.md.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
/** A date written out (« 30 octobre 2026 »), with its day of the week or not. */
const MONTHS = /\d{1,2} (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}/;

const masterCv = {
  fullName: "Catherine Morel",
  headline: "Directrice administrative et financière",
  email: "catherine.morel@example.fr",
  phone: "06 11 22 33 44",
  location: "Lyon",
  summary: "Vingt ans de direction financière dans l'industrie : consolidation IFRS, trésorerie, refinancement.",
  experience: [
    { title: "Directrice administrative et financière", employer: "Groupe Sorelis", location: "Lyon", period: "2015 – aujourd'hui", description: "Refinancement de 45 M€ de dette." },
    { title: "Responsable du contrôle de gestion", employer: "Valmont Distribution", location: "Villeurbanne", period: "2007 – 2015", description: "Clôtures mensuelles en cinq jours." },
  ],
  education: [{ degree: "Master Finance", institution: "IAE Lyon", year: "2004" }],
  skills: ["Consolidation IFRS", "Trésorerie", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

async function newProfile(page: Page): Promise<string> {
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", locations: ["Lyon"], minSalary: 85000, contractTypes: ["cdi"] } },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

/** An Application with its Tailored CV proposed and saved through the HTTP API, every change accepted. */
async function applicationWithTailoredCv(page: Page): Promise<string> {
  const profileId = await newProfile(page);
  const captured = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: {
      source: { url: "https://www.apec.fr/offres/daf-screenshots-468" },
      title: "Directeur administratif et financier",
      content: "Groupe Ferlac recrute son DAF. Vous pilotez la consolidation IFRS et la trésorerie du groupe, sur SAP.",
      employer: "Groupe Ferlac",
      location: "Lyon",
      skills: ["IFRS", "SAP"],
    },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: (await captured.json()).id, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  const proposed = await page.request.post(`/api/applications/${id}/tailored-cv`, { headers: { origin }, data: { language: "fr" } });
  expect(proposed.status(), await proposed.text()).toBe(200);
  const { revision, changes } = (await proposed.json()).proposal as { revision: string; changes: { id: string }[] };
  const kept = await page.request.post(`/api/applications/${id}/tailored-cv/save`, { headers: { origin }, data: { revision, accepted: changes.map((change) => change.id) } });
  expect(kept.status(), await kept.text()).toBe(200);
  return id;
}

/** The page drawn and still: Inter loaded, every finite animation over. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const results = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
}

/** axe on `target`, nothing off the side, then, where screenshots are compared, `target` against its baseline. */
async function check(page: Page, target: Locator, selector: string, name: string, width: number, whole = true) {
  await settled(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name}: the page's width`).toBeLessThanOrEqual(width);
  await expectNoAxeViolations(page, selector);
  if (!comparesScreenshots()) return;
  // A page whole, its column drawn at once with nothing to scroll into view.
  if (whole) await page.setViewportSize({ width, height: await page.evaluate(() => document.documentElement.scrollHeight) });
  await settled(page);
  await expect(target).toHaveScreenshot(`${name}.png`, { mask: [page.getByText(MONTHS), page.locator(".provenance-line, .sidebar-count")] });
}

test.use({ colorScheme: "light" });

test.describe("Candidate pages in the Design System (#468)", () => {
  test("the Profile: its head, its Sections as tabs, its Master CV in cards, the ATS Score card and the save bar", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("shots-profile"));
    const id = await newProfile(page);
    for (const { name, width, height } of SCREENSHOT_WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto(`/profils/${id}/cv-de-reference`);
      const cv = page.getByRole("region", { name: fr.profile.masterCv });
      await expect(cv.getByLabel(fr.cvReview.summary)).toBeVisible();
      await check(page, page.locator("#main"), "#main", `profile-${name}`, width);

      // An edit waits in the save bar, stuck to the bottom.
      await page.setViewportSize({ width, height });
      await cv.getByLabel(fr.cvReview.headline).fill("Directrice financière groupe");
      const bar = page.getByRole("region", { name: fr.profilePage.savebarLabel });
      await expect(bar).toBeVisible();
      await check(page, bar, "#main", `profile-savebar-${name}`, width, false);
    }
  });

  test("the File upload's states: empty, a file chosen, a file refused, a file being read", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("shots-upload"));
    const upload = page.locator(".ds-upload");
    const input = page.getByLabel(fr.cvUpload.fileLabel);
    for (const { name, width, height } of SCREENSHOT_WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto("/profils/nouveau");
      await page.waitForLoadState("networkidle");
      await check(page, page.locator("#main"), "#main", `upload-empty-${name}`, width);

      await page.setViewportSize({ width, height });
      await input.setInputFiles({ name: "CV-Marie-Dupont.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20) });
      await expect(upload.locator(".ds-note")).toHaveText(fr.cvUpload.errors.too_large);
      await check(page, upload, "#main", `upload-refused-${name}`, width, false);

      await input.setInputFiles({ name: "CV-Marie-Dupont.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdfCv([...MARIE_DUPONT_CV, "Divers", "E2E_CV_SLOW"])) });
      await expect(upload.locator(".ds-upload__file")).toContainText("CV-Marie-Dupont.pdf");
      await check(page, upload, "#main", `upload-chosen-${name}`, width, false);

      await page.getByRole("button", { name: fr.cvUpload.submit }).click();
      await expect(upload.locator(".ds-upload__step")).toBeVisible();
      await check(page, upload, "#main", `upload-reading-${name}`, width, false);
      await upload.getByRole("button", { name: fr.aiActivity.live.stop.cv_reading }).click();
      await expect(upload.locator(".ds-upload__step")).toHaveCount(0);
    }
  });

  test("« Documents adaptés »: the saved Tailored CV in the Viewer, beside its aside", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("shots-documents"));
    const id = await applicationWithTailoredCv(page);
    for (const { name, width, height } of SCREENSHOT_WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto(`/candidatures/${id}/documents`);
      const viewer = page.getByRole("toolbar", { name: fr.designSystem.viewer.toolbar });
      await expect(viewer).toContainText(/Page 1 sur \d/);
      await expect(page.getByRole("img", { name: /^Page 1 sur \d$/ })).toBeVisible();
      await check(page, page.locator("#main"), "#main", `documents-${name}`, width);
    }
  });
});

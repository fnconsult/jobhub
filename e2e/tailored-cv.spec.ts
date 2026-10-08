import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { renderedTexts } from "./support/accessibility";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #18: the AI Coach proposes a Tailored CV for an Application, derived from
// the Profile's Master CV. It only rephrases, reorders, cuts and emphasises the
// Master CV's facts (ADR-0006): the Job Offer's requirements the Master CV lacks
// become questions, added only if the Candidate confirms them. The Candidate
// reviews the changes against the Master CV, with the Match Score of both,
// before saving it on the Application. Written in the Document Language.
// The AI Coach is Mistral, faked by e2e/support/fake-mistral.mjs: it tries to
// slip in "Power BI" and an invented figure, which must not reach the CV.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const tc = fr.tailoredCv;
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." },
    { title: "Contrôleuse de gestion", employer: "Danone", location: "Paris", period: "1995 – 2005", description: "Reporting mensuel." },
  ],
  education: [],
  skills: ["Consolidation", "IFRS", "SAP"],
  languages: [],
};

const FRENCH = {
  title: "Directeur administratif et financier (H/F)",
  content: "Acme Industrie recrute son DAF. Vous pilotez la consolidation IFRS sous SAP et le reporting sous Power BI.",
  skills: ["IFRS", "SAP", "Power BI"],
};
const ENGLISH = {
  title: "Chief Financial Officer",
  content: "Globex is looking for a CFO who will lead the finance team. You have 15 years of experience with IFRS and SAP.",
  skills: ["IFRS", "SAP"],
};

/** Signs a new Candidate in and opens a new Application on a Job Offer. */
async function openApplication(page: Page, offer: { title: string; content: string; skills: string[] }): Promise<string> {
  await signInWithMagicLink(page, newAddress("tailored-cv"));
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, ...offer, employer: "Acme Industrie", location: "Lyon" },
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
  await page.waitForLoadState("networkidle");
  return id;
}

const section = (page: Page) => page.getByRole("region", { name: tc.title });
const proposal = (page: Page) => section(page).getByRole("group", { name: tc.proposalTitle });

/** The Master and Tailored Match Scores shown in `scope`, as "62 → 84". */
async function scores(scope: Locator): Promise<{ master: number; tailored: number }> {
  const text = await scope.getByText(/^Score de correspondance : \d+ → \d+$/).textContent();
  const [, master, tailored] = /(\d+) → (\d+)/.exec(text ?? "")!;
  return { master: Number(master), tailored: Number(tailored) };
}

test.describe("Tailored CV with change review", () => {
  test("the Candidate reviews a proposed Tailored CV against the Master CV, answers the coach's questions and saves it on the Application", async ({ page }) => {
    await openApplication(page, FRENCH);
    await expect(section(page).getByText(tc.none)).toBeVisible();
    await expect(section(page).getByLabel(tc.languageLabel)).toHaveValue("fr");

    await section(page).getByRole("button", { name: tc.propose }).click();

    await expect(section(page).getByRole("status")).toHaveText(tc.proposed);
    const review = proposal(page);
    await expect(review.getByText(tc.writtenIn.fr)).toBeVisible();
    // The headline is rephrased, shown beside the Master CV's.
    const headline = review.getByRole("listitem").filter({ hasText: `${tc.sections.headline} · ${tc.kinds.rephrased}` });
    await expect(headline.getByText("Directrice financière", { exact: true })).toBeVisible();
    await expect(headline.getByText("Directrice financière (adapté, fr)")).toBeVisible();
    await expect(review.getByText(`${tc.sections.experience} · ${tc.kinds.cut} · Contrôleuse de gestion · Danone · 1995 – 2005`)).toBeVisible();
    await expect(review.getByText(`${tc.sections.skills} · ${tc.kinds.reordered}`)).toBeVisible();
    // Never invented (ADR-0006): the figure and the keyword the AI Coach slipped in are left out.
    await expect(review.getByText(/20 ans/)).toHaveCount(0);
    await expect(review.getByText(new RegExp(tc.kinds.added.replace(/[()]/g, "\\$&")))).toHaveCount(0);
    const before = await scores(review);
    expect(before.tailored).toBe(before.master);

    // Missing requirements are asked, and added only once confirmed.
    const powerBi = review.getByRole("group", { name: "Power BI" });
    await expect(powerBi.getByText(tc.question.replace("{{requirement}}", "Power BI"))).toBeVisible();
    await expect(review.getByRole("group", { name: "Management d'équipe" })).toBeVisible();
    await powerBi.getByRole("button", { name: tc.confirm }).click();
    await expect(powerBi.getByRole("button", { name: tc.confirm })).toHaveAttribute("aria-pressed", "true");
    await review.getByRole("group", { name: "Management d'équipe" }).getByRole("button", { name: tc.decline }).click();
    await expect(review.getByText(`${tc.sections.skills} · ${tc.kinds.added} · Power BI`)).toBeVisible();
    await expect(review.getByText(`${tc.sections.skills} · ${tc.kinds.added} · Management d'équipe`)).toHaveCount(0);
    const after = await scores(review);
    expect(after.master).toBe(before.master);
    expect(after.tailored).toBeGreaterThan(after.master);

    await review.getByRole("button", { name: tc.save }).click();

    await expect(section(page).getByRole("status")).toHaveText(tc.saved);
    await page.reload();
    const saved = section(page).getByRole("group", { name: tc.savedTitle });
    await expect(saved.getByText("Directrice financière (adapté, fr)")).toBeVisible();
    await expect(saved.getByText(/Power BI/)).toBeVisible();
    expect(await scores(saved)).toEqual(after);
    await expect(proposal(page)).toHaveCount(0);

    // The section's text meets the accessibility floor (ADR-0009).
    for (const t of await renderedTexts(page)) {
      expect.soft(t.fontSizePx, `font size of "${t.text}"`).toBeGreaterThanOrEqual(16);
      expect.soft(t.contrast, `contrast of "${t.text}"`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("a Tailored CV is written in the Job Offer's language by default, or in the Document Language the Candidate chooses", async ({ page }) => {
    await openApplication(page, ENGLISH);
    await expect(section(page).getByLabel(tc.languageLabel)).toHaveValue("en");
    await section(page).getByRole("button", { name: tc.propose }).click();
    await expect(proposal(page).getByText(tc.writtenIn.en)).toBeVisible();
    await expect(proposal(page).getByText("Directrice financière (adapté, en)")).toBeVisible();

    await section(page).getByLabel(tc.languageLabel).selectOption({ label: fr.tailoredDocuments.languages.fr });
    await proposal(page).getByRole("button", { name: tc.proposeAgain }).click();
    await expect(proposal(page).getByText("Directrice financière (adapté, fr)")).toBeVisible();

    // The Application keeps the language chosen, for all its Tailored Documents.
    await page.reload();
    await expect(section(page).getByLabel(tc.languageLabel)).toHaveValue("fr");
    await expect(page.getByLabel(fr.tailoredDocuments.languageLabel)).toHaveValue("fr");
  });

  test("when the AI Coach cannot propose one, the Candidate is told to try again later", async ({ page }) => {
    await openApplication(page, { title: "DAF (H/F)", content: "Vous pilotez la finance. E2E_AI_DOWN", skills: [] });

    await section(page).getByRole("button", { name: tc.propose }).click();

    await expect(section(page).getByRole("alert")).toHaveText(tc.unavailable);
    await expect(section(page).getByRole("button", { name: tc.propose })).toBeVisible();
  });
});

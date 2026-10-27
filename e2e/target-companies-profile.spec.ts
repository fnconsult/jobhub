import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #409: « Entreprises cibles », a Section of the Profile's page. The Profile's Target Companies (#406): La
// Bonne Boite's, credited to France Travail, and those the Candidate adds by name (resolved in the company register,
// faked by e2e/support/fake-company-sources.mjs), each with its city, activity, headcount, hiring score and the Job
// Offers found there. From a company the Candidate opens its Company Dossier (in the Spontaneous Application prepared
// for it), or sets it aside for good. The list is in the Data export.
// La Bonne Boite's companies are written straight in the database, as a Job Search would have left them: its run is
// e2e/job-discovery-target-companies.spec.ts (a worker spec).
// Building a dossier calls the (faked) register: allow it more than the default 5 s when the machine is busy.
const expect = baseExpect.configure({ timeout: 15_000 });

const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const t = fr.targetCompanies;
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const tr = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

async function withDb<T>(run: (db: pg.Pool) => Promise<T>): Promise<T> {
  const db = new pg.Pool({ connectionString: databaseUrl });
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

/** Signs a new Candidate in with one Profile (Directeur financier, Lyon); returns its id. */
async function candidateWithProfile(page: Page, label: string): Promise<string> {
  await signInWithMagicLink(page, newAddress(label));
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directeur financier", locations: ["Lyon"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

/** La Bonne Boite's companies for the Profile, as Job discovery keeps them (#406). */
async function laBonneBoiteGave(profileId: string) {
  await withDb((db) =>
    db.query(
      `INSERT INTO target_company (profile_id, candidate_id, company_key, name, origin, hiring_score, city, activity, headcount_min, headcount_max)
       SELECT id, candidate_id, 'siren:380129866', 'BETA LOGISTIQUE', 'la_bonne_boite', 64, 'Vénissieux', 'Entreposage et stockage non frigorifique', 50, 99 FROM profile WHERE id = $1
       UNION ALL
       SELECT id, candidate_id, 'siren:412345678', 'GAMMA CONSEIL', 'la_bonne_boite', 70.4, 'Lyon', 'Conseil pour les affaires', 10, 19 FROM profile WHERE id = $1`,
      [profileId],
    ),
  );
}

/** A Job Offer at `employer` that a Job Search of the Profile found. */
async function jobSearchFound(page: Page, profileId: string, title: string, employer: string) {
  const offer = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { title, content: `(réf. ${Date.now()}-${Math.random()}) ${title} chez ${employer}.`, employer, location: "Lyon" },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const jobOfferId: string = (await offer.json()).id;
  await withDb((db) =>
    // A done row carries metrics like the worker's own (job-search-metrics.spec.ts checks every one does).
    db.query(`INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, metrics) SELECT candidate_id, id, 'done', $2, now(), now(), $3 FROM profile WHERE id = $1`, [
      profileId,
      [jobOfferId],
      JSON.stringify({ funnel: { providerUrls: 1, fetched: 1, extracted: 1, alreadyStored: 0, afterDedup: 1, matched: 1 }, skipped: {}, costEur: 0, durationMs: 1000 }),
    ]),
  );
}

const sectionOf = (page: Page) => page.getByRole("region", { name: t.title });
const companiesOf = (page: Page) => sectionOf(page).getByRole("list", { name: t.listLabel });
const companyOf = (page: Page, name: string) => companiesOf(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });

/** Opens the Profile's « Entreprises cibles » Section, hydrated. */
async function openSection(page: Page, profileId: string) {
  await page.goto(`/profils/${profileId}/entreprises-cibles`);
  await expect(sectionOf(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.describe("« Entreprises cibles » on the Profile", () => {
  test("shows La Bonne Boite's companies credited to France Travail, with what is known of them and the Job Offers found there", async ({ page }) => {
    const profileId = await candidateWithProfile(page, "target-companies-list");
    await laBonneBoiteGave(profileId);
    await jobSearchFound(page, profileId, "Directeur financier H/F", "Beta Logistique SAS");

    await openSection(page, profileId);

    await expect(page.getByRole("navigation", { name: fr.profilePage.sections.sectionsLabel }).getByRole("link", { name: fr.profilePage.sections["entreprises-cibles"] })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sectionOf(page).getByRole("img", { name: "France Travail" })).toBeVisible();
    // Best hiring first.
    await expect(companiesOf(page).getByRole("heading")).toHaveText(["GAMMA CONSEIL", "BETA LOGISTIQUE"]);
    const beta = companyOf(page, "BETA LOGISTIQUE");
    await expect(beta.getByText("Vénissieux", { exact: true })).toBeVisible();
    await expect(beta.getByText("Entreposage et stockage non frigorifique", { exact: true })).toBeVisible();
    await expect(beta.getByText(tr(fr.companyDossier.headcountRange, { min: 50, max: 99 }), { exact: true })).toBeVisible();
    await expect(beta.getByText(tr(t.hiringScore, { score: 64 }), { exact: true })).toBeVisible();
    await expect(beta.getByText(tr(t.offersFound_one, { count: 1 }))).toBeVisible();
    await expect(beta.getByRole("link", { name: "Directeur financier H/F" })).toBeVisible();
    await expect(companyOf(page, "GAMMA CONSEIL").getByText(t.noOffers)).toBeVisible();

    const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) }))).toEqual([]);
  });

  test("adds a company by name, found in the company register, and opens its Company Dossier from the Section", async ({ page }) => {
    const profileId = await candidateWithProfile(page, "target-companies-add");
    await laBonneBoiteGave(profileId);
    await openSection(page, profileId);

    await sectionOf(page).getByLabel(t.addLabel).fill("Acme Industrie");
    await sectionOf(page).getByRole("button", { name: t.add, exact: true }).click();

    // As the register lists it, and before La Bonne Boite's.
    await expect(companiesOf(page).getByRole("heading")).toHaveText(["ACME INDUSTRIE", "GAMMA CONSEIL", "BETA LOGISTIQUE"]);
    await expect(companyOf(page, "ACME INDUSTRIE").getByText(t.yours, { exact: true })).toBeVisible();
    // Once only.
    await sectionOf(page).getByLabel(t.addLabel).fill("ACME INDUSTRIE");
    await sectionOf(page).getByRole("button", { name: t.add, exact: true }).click();
    await expect(sectionOf(page).getByText(t.errors.exists)).toBeVisible();
    await expect(sectionOf(page).getByLabel(t.addLabel)).toHaveAttribute("aria-invalid", "true");

    await companyOf(page, "ACME INDUSTRIE").getByRole("button", { name: t.openDossier }).click();

    // Its Company Dossier is the Spontaneous Application's: the Profile's job at the company.
    await expect(page).toHaveURL(/\/candidatures\/[0-9a-f-]{36}\/dossier$/);
    const dossier = page.getByRole("region", { name: fr.companyDossier.title });
    await page.waitForLoadState("networkidle");
    await dossier.getByRole("button", { name: fr.companyDossier.build }).click();
    await expect(dossier.getByText(fr.companyDossier.reliability.official)).toBeVisible();
    await expect(dossier.getByText("552100554", { exact: true })).toBeVisible();
    const applicationPath = new URL(page.url()).pathname.replace(/\/dossier$/, "");

    // Back on the Profile, the company leads to that Spontaneous Application.
    await openSection(page, profileId);
    const acme = companyOf(page, "ACME INDUSTRIE");
    await expect(acme.getByRole("link", { name: t.seeApplication })).toHaveAttribute("href", applicationPath);
    await expect(acme.getByRole("link", { name: t.openDossier })).toHaveAttribute("href", `${applicationPath}/dossier`);
    await expect(acme.getByRole("link", { name: t.findContacts })).toHaveAttribute("href", `${applicationPath}/contacts`);
  });

  test("sets a company aside for good, and the Data export still lists it, set aside", async ({ page }) => {
    const profileId = await candidateWithProfile(page, "target-companies-set-aside");
    await laBonneBoiteGave(profileId);
    await openSection(page, profileId);

    const gamma = companyOf(page, "GAMMA CONSEIL");
    await gamma.getByRole("button", { name: t.setAside }).click();
    // Asked first: it never comes back.
    await expect(gamma.getByText(tr(t.setAsideConfirm, { name: "GAMMA CONSEIL" }))).toBeVisible();
    await gamma.getByRole("button", { name: t.confirmSetAside }).click();

    await expect(companiesOf(page).getByRole("heading")).toHaveText(["BETA LOGISTIQUE"]);
    await expect(sectionOf(page).getByRole("status")).toHaveText(tr(t.setAsideDone, { name: "GAMMA CONSEIL" }));
    await page.reload();
    await expect(companiesOf(page).getByRole("heading")).toHaveText(["BETA LOGISTIQUE"]);

    await page.goto("/compte/donnees");
    const section = page.getByRole("region", { name: fr.accountData.title });
    const [file] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: fr.accountData.export }).click()]);
    const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
    const listed = [...exported.profiles.find((profile: { id: string }) => profile.id === profileId).targetCompanies].sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    expect(listed.map(({ name, origin, hiringScore, city, headcount, setAsideAt }: Record<string, unknown>) => ({ name, origin, hiringScore, city, headcount, setAside: setAsideAt !== null }))).toEqual([
      { name: "BETA LOGISTIQUE", origin: "la_bonne_boite", hiringScore: 64, city: "Vénissieux", headcount: { min: 50, max: 99 }, setAside: false },
      { name: "GAMMA CONSEIL", origin: "la_bonne_boite", hiringScore: 70.4, city: "Lyon", headcount: { min: 10, max: 19 }, setAside: true },
    ]);
  });
});

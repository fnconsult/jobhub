import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #17: the Company Dossier of an Application. A French employer is
// matched to its SIREN in the register, with financials when published; any
// other employer gets a web dossier labelled less reliable; a recruiting
// agency's posting only yields a Presumed Employer, looked up once the
// Candidate confirms it; no private person is ever named.
// The register, the web search and the offer analysis are faked in the web
// server (e2e/support/fake-company-sources.mjs, e2e/support/fake-mistral.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const t = fr.companyDossier;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

/** Signs a new Candidate in with one Profile, saves a Job Offer from `employer` and opens its Application page. */
async function openApplication(page: Page, employer: string | undefined, content = "Poste de DAF.") {
  await signInWithMagicLink(page, newAddress("company-dossier"));
  const profile = await page.request.post("/api/profiles", {
    data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } },
    headers: { origin },
  });
  expect(profile.status(), await profile.text()).toBe(201);
  const offer = await page.request.post("/api/job-offers", {
    data: { title: "DAF H/F", content: `(réf. ${unique()}) ${content}`, employer, location: "Lyon" },
    headers: { origin },
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const application = await page.request.post("/api/applications", {
    data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id },
    headers: { origin },
  });
  expect(application.ok(), await application.text()).toBe(true);
  await page.goto(`/candidatures/${(await application.json()).id}`);
  return page.getByRole("region", { name: t.title });
}

/** No private person's name from the register or the web search ever reaches the page. */
async function expectNoPrivatePersonNamed(page: Page) {
  await expect(page.locator("body")).not.toContainText(/PAULINE|MARTIN|DURAND|Müller/);
}

test.describe("Company Dossier", () => {
  test("a French employer is matched to its SIREN and shows its financials, executives by role only, and roles to contact", async ({ page }) => {
    const dossier = await openApplication(page, "Acme Industrie");
    await expect(dossier.getByText(t.intro)).toBeVisible();

    await dossier.getByRole("button", { name: t.build }).click();

    await expect(dossier.getByText(t.reliability.official)).toBeVisible();
    await expect(dossier.getByText("552100554", { exact: true })).toBeVisible();
    await expect(dossier.getByText("12 RUE DE LA REPUBLIQUE 69002 LYON")).toBeVisible();
    await expect(dossier.getByText("250 à 499 salariés")).toBeVisible();
    const figures = dossier.getByRole("table");
    await expect(figures.getByRole("row")).toHaveCount(3);
    await expect(figures.getByRole("row").nth(1).getByRole("rowheader")).toHaveText("2024");
    await expect(dossier.getByRole("heading", { name: t.executivesTitle })).toBeVisible();
    await expect(dossier.getByText("Directeur Général", { exact: true })).toBeVisible();
    await expect(dossier.getByText(t.contactRoles.hr_director)).toBeVisible();
    await expectNoPrivatePersonNamed(page);

    // Kept for the next visit.
    await page.reload();
    await expect(page.getByRole("region", { name: t.title }).getByText("552100554", { exact: true })).toBeVisible();
  });

  test("says so when the register publishes no financials", async ({ page }) => {
    const dossier = await openApplication(page, "Sans Chiffres");

    await dossier.getByRole("button", { name: t.build }).click();

    await expect(dossier.getByText(t.reliability.official)).toBeVisible();
    await expect(dossier.getByText(t.noFinancials)).toBeVisible();
    await expect(dossier.getByRole("table")).toHaveCount(0);
  });

  test("a foreign employer gets a dossier from web sources, labelled less reliable", async ({ page }) => {
    const dossier = await openApplication(page, "Globex Robotics GmbH");

    await dossier.getByRole("button", { name: t.build }).click();

    await expect(dossier.getByText(t.reliability.less_reliable)).toBeVisible();
    await expect(dossier.getByText(t.reliabilityDetail.less_reliable)).toBeVisible();
    await expect(dossier.getByText("Allemagne")).toBeVisible();
    await expect(dossier.getByText("Robotique industrielle")).toBeVisible();
    await expect(dossier.getByRole("link", { name: "https://globex-robotics.example/about" })).toBeVisible();
    await expect(dossier.getByText(t.reliability.official)).toHaveCount(0);
    await expectNoPrivatePersonNamed(page);
  });

  test("a recruiting agency's posting only proposes a Presumed Employer, looked up once the Candidate confirms it", async ({ page }) => {
    const dossier = await openApplication(page, "Cabinet Talents & Co", "Notre client, un industriel lyonnais, recrute son DAF. Client présumé : Acme Industrie");

    await dossier.getByRole("button", { name: t.build }).click();

    await expect(dossier.getByText("Cette offre est publiée par un cabinet de recrutement (Cabinet Talents & Co).", { exact: false })).toBeVisible();
    await expect(dossier.getByText(t.confirmBeforeLookup)).toBeVisible();
    await expect(dossier.getByLabel(t.employerLabel)).toHaveValue("Acme Industrie");
    // Nothing looked up yet: no dossier, no SIREN.
    await expect(dossier.getByText("552100554")).toHaveCount(0);
    await expect(dossier.getByText(t.reliability.official)).toHaveCount(0);

    await dossier.getByRole("button", { name: t.confirmEmployer }).click();

    await expect(dossier.getByText(t.reliability.official)).toBeVisible();
    await expect(dossier.getByText("552100554", { exact: true })).toBeVisible();
    await expectNoPrivatePersonNamed(page);
  });

  test("a Presumed Employer stays unlooked-up when the dossier is built again before the Candidate confirms it", async ({ page }) => {
    const dossier = await openApplication(page, "Cabinet Talents & Co", "Notre client recrute son DAF. Client présumé : Acme Industrie");
    await dossier.getByRole("button", { name: t.build }).click();
    await expect(dossier.getByText(t.confirmBeforeLookup)).toBeVisible();
    const api = `${new URL(page.url()).pathname.replace("/candidatures/", "/api/applications/")}/company-dossier`;

    const rebuilt = await page.request.post(api, { headers: { origin } });
    expect(rebuilt.status(), await rebuilt.text()).toBe(200);
    expect(await rebuilt.json()).toMatchObject({ status: "awaiting_confirmation", presumedEmployer: "Acme Industrie" });
    expect(await rebuilt.text()).not.toContain("552100554");

    const state = await page.request.get(api);
    expect(state.status()).toBe(200);
    expect(await state.json()).not.toHaveProperty("dossier");

    await page.reload();
    const again = page.getByRole("region", { name: t.title });
    await expect(again.getByText(t.confirmBeforeLookup)).toBeVisible();
    await expect(again.getByText("552100554")).toHaveCount(0);
    await expect(again.getByText(t.reliability.official)).toHaveCount(0);
  });

  test("the Candidate corrects the Presumed Employer before confirming, and the dossier is built for the employer they named", async ({ page }) => {
    const dossier = await openApplication(page, "Cabinet Talents & Co", "Notre client recrute son DAF. Client présumé : Acme Industrie");
    await dossier.getByRole("button", { name: t.build }).click();
    await expect(dossier.getByLabel(t.employerLabel)).toHaveValue("Acme Industrie");

    await dossier.getByLabel(t.employerLabel).fill("Globex Robotics GmbH");
    await dossier.getByRole("button", { name: t.confirmEmployer }).click();

    await expect(dossier.getByText(t.reliability.less_reliable)).toBeVisible();
    await expect(dossier.getByText("Robotique industrielle")).toBeVisible();
    await expect(dossier.getByText("552100554")).toHaveCount(0);
    await expect(dossier.getByText(t.reliability.official)).toHaveCount(0);
  });

  test("the dossier's HTTP API names no private person either, for French and foreign employers", async ({ page }) => {
    for (const employer of ["Acme Industrie", "Globex Robotics GmbH"]) {
      await page.context().clearCookies(); // a new Candidate for each employer
      await openApplication(page, employer);
      const api = `${new URL(page.url()).pathname.replace("/candidatures/", "/api/applications/")}/company-dossier`;
      const built = await page.request.post(api, { headers: { origin } });
      expect(built.status(), await built.text()).toBe(200);
      expect((await built.json()).status).toBe("built");
      const read = await page.request.get(api);
      for (const body of [await built.text(), await read.text()]) {
        expect(body).not.toMatch(/PAULINE|MARTIN|DURAND|Müller|Hans/);
      }
    }
  });

  test("a Candidate cannot read or build another Candidate's Company Dossier", async ({ page, browser }) => {
    await openApplication(page, "Acme Industrie");
    const api = `${new URL(page.url()).pathname.replace("/candidatures/", "/api/applications/")}/company-dossier`;

    const other = await browser.newPage({ baseURL: origin });
    await signInWithMagicLink(other, newAddress("company-dossier-other"));
    expect((await other.request.get(api)).status()).toBe(404);
    expect((await other.request.post(api, { headers: { origin } })).status()).toBe(404);
    expect((await other.request.put(`${api}/employer`, { data: { employer: "Acme Industrie" }, headers: { origin } })).status()).toBe(404);
    await other.close();
  });

  test("the Candidate names the employer a Job Offer leaves out, by its SIREN", async ({ page }) => {
    const dossier = await openApplication(page, undefined);
    await dossier.getByRole("button", { name: t.build }).click();
    await expect(dossier.getByText(t.employerUnknown)).toBeVisible();

    await dossier.getByLabel(t.employerLabel).fill("552 100 554");
    await dossier.getByRole("button", { name: t.nameEmployer }).click();

    await expect(dossier.getByText("552100554", { exact: true })).toBeVisible();
  });

  test("tells the Candidate to try later when the register is unavailable", async ({ page }) => {
    const dossier = await openApplication(page, "E2E_REGISTER_DOWN Industrie");

    await dossier.getByRole("button", { name: t.build }).click();

    await expect(dossier.getByRole("alert")).toHaveText(t.unavailable);
    await expect(dossier.getByRole("button", { name: t.build })).toBeVisible();
  });
});

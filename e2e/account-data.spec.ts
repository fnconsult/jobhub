import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { fakeCustomerId } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #25 / ADR-0010: from their account page, the Candidate downloads all
// their data (Profiles, every Master CV Version, Applications, Tailored
// Documents) and deletes their account: everything tied to them goes, the Job
// Offers stay.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

/** Signs a new Candidate in with a Profile (Master CV edited once) and an Application with a Cover Letter. */
async function candidateWithData(page: Page, email: string) {
  await signInWithMagicLink(page, email);
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const profileId = (await profile.json()).id as string;
  const edited = await page.request.put(`/api/profiles/${profileId}/master-cv`, {
    data: { basedOnVersion: 1, content: { ...masterCv, summary: "25 ans de finance." } },
    headers: { origin },
  });
  expect(edited.ok(), await edited.text()).toBe(true);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, title: "DAF H/F", content: "Acme Industrie recrute son DAF pour piloter la clôture des comptes.", employer: "Acme Industrie" },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const jobOfferId = (await captured.json()).id as string;
  const saved = await page.request.post("/api/applications", { data: { jobOfferId, profileId }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const applicationId = (await saved.json()).id as string;
  const drafted = await page.request.post(`/api/applications/${applicationId}/tailored-documents`, { data: { document: "cover_letter" }, headers: { origin } });
  expect(drafted.ok(), await drafted.text()).toBe(true);
  return { profileId, jobOfferId, applicationId };
}

test.describe("exporting my data and deleting my account", () => {
  test("the Candidate downloads all their data from their account page", async ({ page }) => {
    const email = newAddress("account-export");
    const { profileId, applicationId } = await candidateWithData(page, email);
    await page.goto("/compte");

    const section = page.getByRole("region", { name: fr.accountData.title });
    const [file] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: fr.accountData.export }).click()]);

    expect(file.suggestedFilename()).toMatch(/^jobbbox-donnees-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
    expect(exported.account).toMatchObject({ email });
    expect(exported.profiles).toEqual([
      expect.objectContaining({ id: profileId, masterCvVersions: [expect.objectContaining({ version: 2 }), expect.objectContaining({ version: 1 })] }),
    ]);
    expect(exported.applications).toEqual([
      expect.objectContaining({
        id: applicationId,
        jobOffer: expect.objectContaining({ title: "DAF H/F" }),
        tailoredDocuments: expect.objectContaining({ coverLetter: expect.objectContaining({ text: expect.any(String) }) }),
      }),
    ]);
  });

  test("only a signed-in Candidate can download their data", async ({ request }) => {
    expect((await request.get("/api/account/export")).status()).toBe(401);
  });

  test("the Candidate deletes their account after confirming their email: they are signed out, their data is gone, the Job Offer stays", async ({ page, browser }) => {
    const email = newAddress("account-delete");
    const { jobOfferId } = await candidateWithData(page, email);
    await subscribe(page, email, "standard");
    const stripe = process.env.E2E_STRIPE_URL!;
    await page.goto("/compte");

    const section = page.getByRole("region", { name: fr.accountData.title });
    await section.getByLabel(fr.accountData.confirmLabel).fill("someone.else@example.fr");
    await section.getByRole("button", { name: fr.accountData.delete }).click();
    await expect(section.getByRole("alert")).toHaveText(fr.accountData.confirmMismatch);
    await expect(page).toHaveURL(/\/compte$/);

    await section.getByLabel(fr.accountData.confirmLabel).fill(email);
    await section.getByRole("button", { name: fr.accountData.delete }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.accountDeleted.title);
    const calls = (await (await page.request.get(`${stripe}/__calls`)).json()) as { method: string; path: string }[];
    expect(calls).toContainEqual(expect.objectContaining({ method: "DELETE", path: `/v1/customers/${fakeCustomerId(email)}` }));
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/connexion$/);
    expect((await page.request.get("/api/profiles")).status()).toBe(401);

    // Another Candidate still finds the Job Offer.
    const other = await browser.newPage();
    await signInWithMagicLink(other, newAddress("account-delete-other"));
    await other.goto(`/offres/${jobOfferId}`);
    await expect(other.getByRole("heading", { level: 1 })).toHaveText("DAF H/F");
    await other.close();

    // Signing up again with the same email starts an empty account.
    await signInWithMagicLink(page, email);
    await expect(page.getByText(fr.profiles.none)).toBeVisible();
  });

  test("deleting an account needs the Candidate's own email, from the app itself", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("account-delete-guard"));

    expect((await page.request.delete("/api/account", { data: { email: "someone.else@example.fr" }, headers: { origin } })).status()).toBe(400);
    expect((await page.request.delete("/api/account", { data: { email: "x" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/compte$/);
  });
});

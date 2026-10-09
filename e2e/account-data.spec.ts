import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { checkoutSessionEvent, fakeCustomerId, signedEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #25 / ADR-0010: from their account page, the Candidate downloads all
// their data (Profiles, every Master CV Version, Applications, Tailored
// Documents) and deletes their account: everything tied to them goes, the Job
// Offers stay.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;

// Its own Administrator: two sign-ins of one address at once, from other spec files, can pick up each other's link.
const ADMINISTRATOR = "account-office@e2e.jobbbox.test";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

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

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The Administrator adds a Human Coach in the Back Office; returns their name and id. */
async function addCoach(admin: Page, email: string): Promise<{ name: string; id: string }> {
  const name = `Sophie Martin ${unique()}`;
  await admin.goto("/admin/coachs");
  await admin.getByLabel(fr.admin.humanCoaches.name).fill(name);
  await admin.getByLabel(fr.admin.humanCoaches.email).fill(email);
  await admin.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(`https://cal.com/sophie-${unique()}/seance`);
  await admin.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
  await expect(admin.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));
  const form = admin.locator("form").filter({ has: admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name }) }) });
  return { name, id: await form.locator('input[name="coachId"]').inputValue() };
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

  test("the export holds every Profile (archived ones too), every Master CV Version, and every Tailored Document, and nothing of another Candidate", async ({ page, browser }) => {
    const email = newAddress("account-export-full");
    const { profileId, applicationId } = await candidateWithData(page, email);
    await subscribe(page, email, "standard");

    // A second Profile (the Standard Plan allows more than one), archived.
    const second = await page.request.post("/api/profiles", { data: { masterCv: { ...masterCv, headline: "DAF de transition" }, searchCriteria: { targetRole: "DAF de transition", location: "Paris" } }, headers: { origin } });
    expect(second.status(), await second.text()).toBe(201);
    const archivedId = (await second.json()).id as string;
    const archived = await page.request.patch(`/api/profiles/${archivedId}`, { data: { archived: true }, headers: { origin } });
    expect(archived.ok(), await archived.text()).toBe(true);
    // A third Master CV Version on the first Profile.
    const edited = await page.request.put(`/api/profiles/${profileId}/master-cv`, {
      data: { basedOnVersion: 2, content: { ...masterCv, summary: "25 ans de finance, dont 10 en groupe coté." } },
      headers: { origin },
    });
    expect(edited.ok(), await edited.text()).toBe(true);
    // The other Tailored Documents: a saved Tailored CV and an Outreach Message.
    const proposed = await page.request.post(`/api/applications/${applicationId}/tailored-cv`, { data: { language: "fr" }, headers: { origin } });
    expect(proposed.ok(), await proposed.text()).toBe(true);
    const savedCv = await page.request.post(`/api/applications/${applicationId}/tailored-cv/save`, {
      data: { revision: (await proposed.json()).proposal.revision },
      headers: { origin },
    });
    expect(savedCv.ok(), await savedCv.text()).toBe(true);
    const outreach = await page.request.post(`/api/applications/${applicationId}/tailored-documents`, { data: { document: "outreach_message", channel: "email" }, headers: { origin } });
    expect(outreach.ok(), await outreach.text()).toBe(true);

    // Another Candidate's data never shows in this export.
    const other = await browser.newPage();
    const { profileId: otherProfileId, applicationId: otherApplicationId } = await candidateWithData(other, newAddress("account-export-other"));
    await other.close();

    await page.goto("/compte");
    const section = page.getByRole("region", { name: fr.accountData.title });
    const [file] = await Promise.all([page.waitForEvent("download"), section.getByRole("link", { name: fr.accountData.export }).click()]);
    const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));

    expect(exported.profiles.map((p: { id: string }) => p.id).sort()).toEqual([profileId, archivedId].sort());
    const first = exported.profiles.find((p: { id: string }) => p.id === profileId);
    expect(first.masterCvVersions.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(first.searchCriteria).toMatchObject({ targetRole: "DAF", location: "Lyon" });
    expect(exported.profiles.find((p: { id: string }) => p.id === archivedId)).toMatchObject({ archived: true, masterCvVersions: [expect.objectContaining({ version: 1 })] });

    expect(exported.applications).toHaveLength(1);
    expect(exported.applications[0].tailoredDocuments).toMatchObject({
      tailoredCv: expect.objectContaining({ language: "fr", content: expect.objectContaining({ fullName: "Marie Dupont" }) }),
      coverLetter: expect.objectContaining({ text: expect.any(String) }),
      outreachMessage: expect.objectContaining({ text: expect.any(String) }),
    });

    const raw = JSON.stringify(exported);
    expect(raw).not.toContain(otherProfileId);
    expect(raw).not.toContain(otherApplicationId);
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

  test("deletion takes effect at once: every session is signed out and nothing of the Candidate's data can be reached again", async ({ page, browser }) => {
    const email = newAddress("account-delete-everything");
    const { profileId, applicationId, jobOfferId } = await candidateWithData(page, email);
    // The same Candidate, signed in on another device.
    const elsewhere = await browser.newPage();
    await signInWithMagicLink(elsewhere, email);
    expect((await elsewhere.request.get(`/api/applications/${applicationId}`)).status()).toBe(200);

    const deleted = await page.request.delete("/api/account", { data: { email: email.toUpperCase() }, headers: { origin } });
    expect(deleted.status(), await deleted.text()).toBe(204);

    // Signed out everywhere, at once (not merely scheduled for later).
    expect((await elsewhere.request.get("/api/profiles")).status()).toBe(401);
    expect((await elsewhere.request.get("/api/account/export")).status()).toBe(401);
    await elsewhere.close();

    // Signing up again with the same email finds nothing of the old account.
    await signInWithMagicLink(page, email);
    expect((await page.request.get(`/api/profiles/${profileId}/master-cv/export?format=pdf&template=classic`)).status()).toBe(404);
    expect((await page.request.get(`/api/applications/${applicationId}`)).status()).toBe(404);
    expect((await page.request.get(`/api/applications/${applicationId}/tailored-cv`)).status()).toBe(404);
    const fresh = await page.request.get("/api/account/export");
    expect(fresh.status()).toBe(200);
    expect(await fresh.json()).toMatchObject({ account: { email }, profiles: [], applications: [] });
    // The shared Job Offer is still there.
    await page.goto(`/offres/${jobOfferId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("DAF H/F");
  });

  test("deletion removes the Candidate's Coach Access, Coach Reviews and Coaching Sessions; the Human Coach keeps their own account", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coachEmail = newAddress("account-delete-coach");
    const coach = await addCoach(admin, coachEmail);
    await admin.context().close();

    const email = newAddress("account-delete-coached");
    const { applicationId, jobOfferId } = await candidateWithData(page, email);

    // Coach Access, granted from the Candidate's Human Coaches page.
    await page.goto("/coachs");
    await page.getByRole("button", { name: tr(fr.humanCoaches.grant, { name: coach.name }) }).click();
    await expect(page.getByText(tr(fr.humanCoaches.accessGranted, { name: coach.name }))).toBeVisible();

    // A paid Coaching Session, recorded from Stripe's signed webhook.
    const started = await page.request.post("/api/coaching/checkout", { form: { coachId: coach.id }, headers: { origin }, maxRedirects: 0 });
    expect(started.status()).toBe(303);
    const calls: { path: string; params: Record<string, string> }[] = await (await fetch(`${process.env.E2E_STRIPE_URL}/__calls`)).json();
    const checkout = calls.filter((call) => call.path === "/v1/checkout/sessions" && call.params["metadata[coach_id]"] === coach.id).at(-1)!;
    const candidateId = checkout.params["metadata[candidate_id]"]!;
    const { payload, signature } = signedEvent(
      checkoutSessionEvent("checkout.session.completed", { id: `cs_e2e_${unique()}`, candidateId, coachId: coach.id, amount: 9000, currency: "eur", paymentStatus: "paid" }),
    );
    const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
    expect(delivered.status()).toBe(200);
    await page.goto("/coachs?session=paid");
    await expect(page.getByRole("link", { name: tr(fr.humanCoaches.pickSlot, { name: coach.name }) })).toHaveCount(1);

    // The Human Coach reads the Candidate's file and leaves a Coach Review (a Coaching Session note).
    const coachPage = await personPage(browser, coachEmail);
    await coachPage.goto("/espace-coach");
    await coachPage.getByRole("link", { name: email }).click();
    await coachPage.getByRole("link", { name: "DAF H/F · Acme Industrie" }).click();
    await coachPage.getByLabel(fr.coachSpace.reviewDocument).selectOption({ label: fr.coachReviews.documents.cover_letter });
    await coachPage.getByLabel(fr.coachSpace.reviewText).fill("Ouvrez sur votre dernier poste de DAF.");
    await coachPage.getByRole("button", { name: fr.coachSpace.reviewSubmit }).click();
    await expect(coachPage.getByRole("status")).toHaveText(fr.coachSpace.reviewSaved);
    await page.goto(`/candidatures/${applicationId}`);
    await expect(page.getByRole("region", { name: fr.coachReviews.title })).toContainText("Ouvrez sur votre dernier poste de DAF.");

    // The Candidate deletes their account from their account page.
    await page.goto("/compte");
    const section = page.getByRole("region", { name: fr.accountData.title });
    await section.getByLabel(fr.accountData.confirmLabel).fill(email);
    await section.getByRole("button", { name: fr.accountData.delete }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.accountDeleted.title);

    // The Human Coach no longer has access: the Candidate is gone from their coach space, their file and Application cannot be reached.
    await coachPage.goto("/espace-coach");
    await expect(coachPage.getByRole("heading", { level: 1 })).toHaveText(fr.coachSpace.title);
    await expect(coachPage.getByRole("link", { name: email })).toHaveCount(0);
    expect((await coachPage.goto(`/espace-coach/${encodeURIComponent(candidateId)}`))?.status()).toBe(404);
    expect((await coachPage.goto(`/espace-coach/${encodeURIComponent(candidateId)}/candidatures/${applicationId}`))?.status()).toBe(404);
    // The Human Coach's own account stays, and so does the shared Job Offer.
    await coachPage.goto(`/offres/${jobOfferId}`);
    await expect(coachPage.getByRole("heading", { level: 1 })).toHaveText("DAF H/F");
    await coachPage.context().close();

    // Signing up again with the same email: no Coach Access, no paid Coaching Session, nothing in the export.
    await signInWithMagicLink(page, email);
    await page.goto("/coachs?session=paid");
    await expect(page.getByText(tr(fr.humanCoaches.accessNotGranted, { name: coach.name }))).toBeVisible();
    await expect(page.getByRole("link", { name: tr(fr.humanCoaches.pickSlot, { name: coach.name }) })).toHaveCount(0);
    const fresh = await page.request.get("/api/account/export");
    expect(fresh.status()).toBe(200);
    const raw = await fresh.text();
    expect(raw).not.toContain("Ouvrez sur votre dernier poste de DAF.");
    expect(raw).not.toContain(applicationId);
  });

  test("deleting an account needs the Candidate's own email, from the app itself", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("account-delete-guard"));

    expect((await page.request.delete("/api/account", { data: { email: "someone.else@example.fr" }, headers: { origin } })).status()).toBe(400);
    expect((await page.request.delete("/api/account", { data: { email: "x" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    await page.goto("/compte");
    await expect(page).toHaveURL(/\/compte$/);
  });
});

import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { checkoutSessionEvent, FAKE_STRIPE_COACHING_SESSION_PRICES, signedEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";

// Issue #24: Human Coaches, added in the Back Office with their Cal.com booking
// link; Coaching Sessions paid through Stripe Checkout at the single Coaching
// Session Price (discounted on Premium), recorded from the signed webhook only;
// Coach Access granted and revoked by the Candidate, letting a Human Coach read
// their Profiles and Applications and review their Tailored Documents.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const hc = fr.humanCoaches;
const space = fr.coachSpace;
const origin = process.env.E2E_WEB_ORIGIN!;
const stripeUrl = process.env.E2E_STRIPE_URL!;
const ADMINISTRATOR = "back-office@e2e.jobbbox.test";

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};

/** A signed-in page of its own (cookies apart), as for another person on another computer. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
  const page = await context.newPage();
  await signInWithMagicLink(page, email);
  return page;
}

/** The Administrator adds a Human Coach in the Back Office; returns their name and booking link. */
async function addCoach(admin: Page, email: string) {
  const name = `Sophie Martin ${unique()}`;
  const bookingUrl = `https://cal.com/sophie-${unique()}/seance`;
  await admin.goto("/admin");
  await admin.getByRole("link", { name: fr.admin.sections.humanCoaches }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(fr.admin.humanCoaches.title);
  await admin.getByLabel(fr.admin.humanCoaches.name).fill(name);
  await admin.getByLabel(fr.admin.humanCoaches.email).fill(email);
  await admin.getByLabel(fr.admin.humanCoaches.bookingUrl).fill(bookingUrl);
  await admin.getByLabel(fr.admin.humanCoaches.bio).fill("Ancienne DRH dans l'industrie.");
  await admin.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
  await expect(admin.getByRole("status")).toHaveText(tr(fr.admin.humanCoaches.added, { name }));
  return { name, bookingUrl };
}

/** A Profile and an Application with a Cover Letter drafted by the AI Coach, for the Candidate signed in on `page`. */
async function applicationWithCoverLetter(page: Page): Promise<string> {
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const captured = await page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, title: "DAF (H/F)", content: "Acme Industrie recrute son DAF. Vous pilotez la clôture des comptes.", employer: "Acme Industrie" },
    headers: { origin },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await captured.json()).id, profileId: (await profile.json()).id }, headers: { origin } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  const drafted = await page.request.post(`/api/applications/${id}/tailored-documents`, { data: { document: "cover_letter" }, headers: { origin } });
  expect(drafted.ok(), await drafted.text()).toBe(true);
  return id;
}

async function checkoutsFor(coachId: string): Promise<Record<string, string>[]> {
  const calls: { path: string; params: Record<string, string> }[] = await (await fetch(`${stripeUrl}/__calls`)).json();
  return calls.filter((call) => call.path === "/v1/checkout/sessions" && call.params["metadata[coach_id]"] === coachId).map((call) => call.params);
}

test.describe("Human Coaches, Coaching Sessions and Coach Access", () => {
  test("the Back Office refuses a booking link that is not a Cal.com page", async ({ page }) => {
    await signInWithMagicLink(page, ADMINISTRATOR);
    await page.goto("/admin/coachs");
    await page.getByLabel(fr.admin.humanCoaches.name).fill("Luc Bernard");
    await page.getByLabel(fr.admin.humanCoaches.email).fill(newAddress("coach"));
    await page.getByLabel(fr.admin.humanCoaches.bookingUrl).fill("https://calendly.com/luc");
    await page.getByRole("button", { name: fr.admin.humanCoaches.add }).click();
    await expect(page.getByRole("alert").filter({ hasText: fr.admin.humanCoaches.invalid })).toBeVisible();
  });

  test("a Candidate pays a Coaching Session through Stripe, then picks its time on the Human Coach's Cal.com page", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach"));
    const coachId = await coachIdOf(admin, coach.name);
    const email = newAddress("coaching-session");
    await signInWithMagicLink(page, email);

    await page.getByRole("link", { name: fr.account.humanCoaches }).click();
    await expect(page).toHaveURL(/\/coachs$/);
    await expect(page.getByText(/Prix d'une séance : 90,00/)).toBeVisible();
    await expect(page.getByRole("link", { name: tr(hc.pickSlot, { name: coach.name }) })).toHaveCount(0);

    await page.route("https://*.stripe.test/**", (route) => route.fulfill({ body: "Stripe" }));
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/coaching/checkout"),
      page.getByRole("button", { name: tr(hc.book, { name: coach.name }) }).click(),
    ]);
    expect(response.status()).toBe(303);
    expect(response.headers().location).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    await page.waitForURL((url) => url.hostname.endsWith(".stripe.test") || url.protocol === "chrome-error:");
    const [checkout] = await checkoutsFor(coachId);
    expect(checkout).toMatchObject({ mode: "payment", "line_items[0][price]": FAKE_STRIPE_COACHING_SESSION_PRICES.regular, "metadata[purpose]": "coaching_session" });

    // The redirect back from Checkout grants nothing: only Stripe's signed webhook does.
    await page.goto("/coachs?session=paid");
    await expect(page.getByRole("status")).toHaveText(hc.paidPending);
    await expect(page.getByRole("link", { name: tr(hc.pickSlot, { name: coach.name }) })).toHaveCount(0);

    const event = checkoutSessionEvent("checkout.session.completed", {
      id: `cs_e2e_${unique()}`,
      candidateId: checkout!["metadata[candidate_id]"]!,
      coachId,
      amount: 9000,
      currency: "eur",
      paymentStatus: "paid",
    });
    const { payload, signature } = signedEvent(event);
    for (let delivery = 0; delivery < 2; delivery++) {
      // Stripe may deliver one event more than once: still one Coaching Session.
      const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
      expect(delivered.status()).toBe(200);
    }

    await page.goto("/coachs?session=paid");
    await expect(page.getByRole("status")).toHaveText(hc.paid);
    const pickSlot = page.getByRole("link", { name: tr(hc.pickSlot, { name: coach.name }) });
    await expect(pickSlot).toHaveCount(1);
    await expect(pickSlot).toHaveAttribute("href", coach.bookingUrl);
    await admin.context().close();
  });

  test("a Premium Candidate pays the discounted Coaching Session Price", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach"));
    const email = newAddress("coaching-premium");
    await signInWithMagicLink(page, email);
    await subscribe(page, email, "premium");

    await page.goto("/coachs");
    await expect(page.getByText(/Prix d'une séance avec votre offre Premium : 72,00.*au lieu de 90,00/)).toBeVisible();
    const checkout = await page.request.post("/api/coaching/checkout", { form: { coachId: await coachIdOf(admin, coach.name) }, headers: { origin }, maxRedirects: 0 });
    expect(checkout.status()).toBe(303);
    const calls: { path: string; params: Record<string, string> }[] = await (await fetch(`${stripeUrl}/__calls`)).json();
    expect(calls.filter((call) => call.path === "/v1/checkout/sessions").at(-1)?.params["line_items[0][price]"]).toBe(FAKE_STRIPE_COACHING_SESSION_PRICES.premium);
    await admin.context().close();
  });

  test("a Candidate grants Coach Access; the Human Coach reads their Profiles and Applications, reviews a Tailored Document, until it is revoked", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coachEmail = newAddress("coach");
    const coach = await addCoach(admin, coachEmail);
    await admin.context().close();
    const email = newAddress("coach-access");
    await signInWithMagicLink(page, email);
    const applicationId = await applicationWithCoverLetter(page);

    // Without Coach Access, the Human Coach sees no one.
    const coachPage = await personPage(browser, coachEmail);
    await coachPage.getByRole("link", { name: fr.account.coachSpace }).click();
    await expect(coachPage.getByRole("heading", { level: 1 })).toHaveText(space.title);
    await expect(coachPage.getByRole("link", { name: email })).toHaveCount(0);

    await page.goto("/coachs");
    await expect(page.getByText(tr(hc.accessNotGranted, { name: coach.name }))).toBeVisible();
    await page.getByRole("button", { name: tr(hc.grant, { name: coach.name }) }).click();
    await expect(page.getByText(tr(hc.accessGranted, { name: coach.name }))).toBeVisible();

    // The Human Coach reads the Candidate's file, read only.
    await coachPage.reload();
    await coachPage.getByRole("link", { name: email }).click();
    await expect(coachPage.getByRole("heading", { level: 1 })).toHaveText(email);
    await expect(coachPage.getByText(space.readOnly)).toBeVisible();
    await expect(coachPage.getByText("Pilotage financier.")).toBeVisible();
    await coachPage.getByRole("link", { name: "DAF (H/F) · Acme Industrie" }).click();
    await expect(coachPage).toHaveURL(new RegExp(`/candidatures/${applicationId}$`));
    await expect(coachPage.getByText("Lettre de motivation (fr) pour « DAF (H/F) ».")).toBeVisible();
    await expect(coachPage.getByRole("button", { name: fr.tailoredDocuments.save })).toHaveCount(0);

    await coachPage.getByLabel(space.reviewDocument).selectOption({ label: fr.coachReviews.documents.cover_letter });
    await coachPage.getByLabel(space.reviewText).fill("Ouvrez sur votre dernier poste de DAF.");
    await coachPage.getByRole("button", { name: space.reviewSubmit }).click();
    await expect(coachPage.getByRole("status")).toHaveText(space.reviewSaved);

    // The Candidate reads the Coach Review on the Application.
    await page.goto(`/candidatures/${applicationId}`);
    const reviews = page.getByRole("region", { name: fr.coachReviews.title });
    await expect(reviews).toContainText("Ouvrez sur votre dernier poste de DAF.");
    await expect(reviews).toContainText(coach.name);

    // Revoked: the Human Coach reads nothing more.
    await page.goto("/coachs");
    await page.getByRole("button", { name: tr(hc.revoke, { name: coach.name }) }).click();
    await expect(page.getByText(tr(hc.accessNotGranted, { name: coach.name }))).toBeVisible();
    const gone = await coachPage.reload();
    expect(gone?.status()).toBe(404);
    await coachPage.context().close();
  });

  test("the coach space is unseen by people who are not Human Coaches", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("not-a-coach"));
    await expect(page.getByRole("link", { name: fr.account.coachSpace })).toHaveCount(0);
    const response = await page.goto("/espace-coach");
    expect(response?.status()).toBe(404);
  });
});

/** The id of the Human Coach named `name`, from the Back Office's retire form. */
async function coachIdOf(admin: Page, name: string): Promise<string> {
  await admin.goto("/admin/coachs");
  const form = admin.locator("form").filter({ has: admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name }) }) });
  return (await form.locator('input[name="coachId"]').inputValue()) as string;
}

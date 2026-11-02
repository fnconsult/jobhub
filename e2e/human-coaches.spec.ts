import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { checkoutSessionEvent, FAKE_STRIPE_COACHING_SESSION_PRICES, signedEvent } from "../apps/web/src/billing/fake-stripe";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";
import { orderToStripe } from "./support/stripe-checkout";

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
// Its own Administrator: billing.spec.ts signs "back-office@" in from another worker, and two
// sign-ins of one address at once can pick up each other's link.
const ADMINISTRATOR = "coach-office@e2e.jobbbox.test";

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
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers: { origin } });
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

    const response = await orderToStripe(page, "/api/coaching/checkout", tr(hc.book, { name: coach.name }));
    expect(response.status()).toBe(303);
    expect(response.headers().location).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [checkout] = await checkoutsFor(coachId);
    expect(checkout).toMatchObject({ mode: "payment", "line_items[0][price]": FAKE_STRIPE_COACHING_SESSION_PRICES.regular, "metadata[purpose]": "coaching_session" });

    // The redirect back from Checkout grants nothing: only Stripe's signed webhook does.
    await page.goto("/coachs?session=paid");
    await expect(page.getByRole("status").filter({ hasText: hc.paidPending })).toHaveText(hc.paidPending);
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
    await expect(page.getByRole("status").filter({ hasText: hc.paid })).toHaveText(hc.paid);
    const pickSlot = page.getByRole("link", { name: tr(hc.pickSlot, { name: coach.name }) });
    await expect(pickSlot).toHaveCount(1);
    await expect(pickSlot).toHaveAttribute("href", coach.bookingUrl);
    await admin.context().close();
  });

  // Issue #248: a paid Coaching Session waits under « À planifier » on the Agenda, with the Human
  // Coach's booking link, until the Candidate enters the date booked; it then sits in the list on
  // its day in French time, linking to the Human Coach on /coachs, which links back to the Agenda.
  test("right after payment, a Coaching Session is « À planifier » on the Agenda; once its date is entered it is in the list on its day", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach"));
    const coachId = await coachIdOf(admin, coach.name);
    await admin.context().close();
    await signInWithMagicLink(page, newAddress("coaching-agenda"));
    const checkout = await page.request.post("/api/coaching/checkout", { form: { coachId }, headers: { origin }, maxRedirects: 0 });
    expect(checkout.status()).toBe(303);
    const [started] = await checkoutsFor(coachId);
    const { payload, signature } = signedEvent(
      checkoutSessionEvent("checkout.session.completed", { id: `cs_e2e_${unique()}`, candidateId: started!["metadata[candidate_id]"]!, coachId, amount: 9000, currency: "eur", paymentStatus: "paid" }),
    );
    const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
    expect(delivered.status()).toBe(200);

    await page.goto("/agenda");
    const toSchedule = page.getByRole("region", { name: fr.agenda.toSchedule });
    await expect(toSchedule).toBeVisible();
    await expect(toSchedule.getByRole("link", { name: tr(hc.pickSlot, { name: coach.name }) })).toHaveAttribute("href", coach.bookingUrl);
    await expect(page.getByText(fr.agenda.none)).toBeVisible();

    // 23:30 in Paris is the next day in UTC: it stays on its own day.
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + 3 * 86_400_000));
    await toSchedule.getByRole("button", { name: tr(fr.coachingSession.enterDateFor, { name: coach.name }) }).click();
    const dialog = page.getByRole("dialog", { name: tr(fr.coachingSession.title, { name: coach.name }) });
    await dialog.getByLabel(fr.coachingSession.videoLink).fill("javascript:alert(1)");
    await dialog.getByRole("button", { name: fr.coachingSession.save }).click();
    await expect(dialog.getByText(fr.coachingSession.requiredDate)).toBeVisible();
    await expect(dialog.getByText(fr.coachingSession.invalidVideoLink)).toBeVisible();
    await dialog.getByLabel(fr.coachingSession.date).fill(`${day}T23:30`);
    await dialog.getByLabel(fr.coachingSession.duration).fill("60");
    await dialog.getByLabel(fr.coachingSession.videoLink).fill("https://meet.google.com/abc-defg-hij");
    await dialog.getByRole("button", { name: fr.coachingSession.save }).click();
    await expect(dialog).toHaveCount(0);

    await expect(toSchedule).toHaveCount(0);
    const days = page.getByRole("region", { name: fr.agenda.upcomingTitle }).getByRole("region");
    await expect(days).toHaveCount(1);
    await expect(days.first().getByRole("heading").locator("time")).toHaveAttribute("datetime", day);
    const item = days.first().getByRole("listitem");
    await expect(item).toContainText("23:30");
    await expect(item).toContainText(tr(fr.agenda.withCoach, { name: coach.name }));
    await expect(item).toContainText(tr(fr.agenda.duration, { count: "60" }));

    // Its first link leads to its Human Coach; the other is its Calendar file (#252).
    const link = item.getByRole("link").first();
    const sessionId = (await link.getAttribute("href"))!.split("#seance-")[1]!;
    const calendarFile = await page.request.get((await item.getByRole("link", { name: new RegExp(`^${fr.agenda.calendarFile.add}`) }).getAttribute("href"))!);
    expect(calendarFile.status()).toBe(200);
    const calendarLines = (await calendarFile.text()).replace(/\r\n[ \t]/g, "").split("\r\n");
    expect(calendarLines).toEqual(expect.arrayContaining([`SUMMARY:${tr(fr.agenda.calendarFile.sessionTitle, { name: coach.name })}`, "URL:https://meet.google.com/abc-defg-hij"]));
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/coachs#seance-${sessionId}$`));
    const session = page.locator(`#seance-${sessionId}`);
    await expect(session.getByRole("link", { name: tr(hc.joinVideo, { name: coach.name }) })).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    await session.getByRole("link", { name: hc.seeInAgenda }).click();
    await expect(page).toHaveURL(/\/agenda$/);

    // Only its Candidate can set its date.
    const other = await personPage(browser, newAddress("coaching-agenda-other"));
    const refused = await other.request.patch(`/api/coaching/sessions/${sessionId}`, { data: { scheduledAt: `${day}T09:00` }, headers: { origin } });
    expect(refused.status()).toBe(404);
    await other.goto("/agenda");
    await expect(other.getByRole("region", { name: fr.agenda.toSchedule })).toHaveCount(0);
    await other.context().close();
    await page.reload();
    await expect(page.getByRole("region", { name: fr.agenda.upcomingTitle }).getByRole("listitem")).toContainText("23:30");
  });

  // Issue #250: a cancelled Coaching Session goes back under « À planifier », its cancellation in its
  // « Historique », whether the Candidate or its Human Coach cancelled it.
  test("cancelled from the Agenda by the Candidate, or by its Human Coach, a Coaching Session is back under « À planifier » with its history", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coachEmail = newAddress("coach-cancel");
    const coach = await addCoach(admin, coachEmail);
    const coachId = await coachIdOf(admin, coach.name);
    await admin.context().close();
    await signInWithMagicLink(page, newAddress("coaching-cancel"));
    await page.request.post("/api/coaching/checkout", { form: { coachId }, headers: { origin }, maxRedirects: 0 });
    const [started] = await checkoutsFor(coachId);
    const { payload, signature } = signedEvent(
      checkoutSessionEvent("checkout.session.completed", { id: `cs_e2e_${unique()}`, candidateId: started!["metadata[candidate_id]"]!, coachId, amount: 9000, currency: "eur", paymentStatus: "paid" }),
    );
    expect((await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } })).status()).toBe(200);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + 3 * 86_400_000));
    const [session] = (await (await page.request.get("/api/account/export")).json()).coachingSessions;
    const schedule = () => page.request.patch(`/api/coaching/sessions/${session.id}`, { data: { scheduledAt: `${day}T10:00` }, headers: { origin } });
    expect((await schedule()).ok()).toBe(true);

    await page.goto("/agenda");
    const upcoming = page.getByRole("region", { name: fr.agenda.upcomingTitle });
    await upcoming.getByRole("button", { name: tr(fr.agendaChanges.cancelSessionFor, { name: coach.name }) }).click();
    await expect(upcoming.getByRole("group", { name: fr.agendaChanges.cancelSessionConfirm })).toBeVisible();
    await upcoming.getByRole("button", { name: fr.agendaChanges.confirm }).click();

    const toSchedule = page.getByRole("region", { name: fr.agenda.toSchedule });
    await expect(toSchedule).toBeVisible();
    await expect(page.getByText(fr.agenda.none)).toBeVisible();
    await toSchedule.getByText(fr.agendaChanges.history).click();
    await expect(toSchedule.getByRole("listitem").getByRole("listitem")).toContainText(/annulé \(prévu le .* 10:00\), par vous/);

    // Booked again, then cancelled by the Human Coach from their Coach space.
    expect((await schedule()).ok()).toBe(true);
    const other = await personPage(browser, newAddress("coach-cancel-other"));
    expect((await other.request.post(`/api/coach-space/sessions/${session.id}/cancel`, { headers: { origin } })).status()).toBe(404);
    await other.context().close();
    const coachPage = await personPage(browser, coachEmail);
    expect((await coachPage.request.post(`/api/coach-space/sessions/${session.id}/cancel`, { headers: { origin } })).status()).toBe(200);
    await coachPage.context().close();

    await page.reload();
    await toSchedule.getByText(fr.agendaChanges.history).click();
    const history = toSchedule.getByRole("listitem").getByRole("listitem");
    await expect(history).toHaveCount(2);
    await expect(history.last()).toContainText(`par ${coach.name}`);
    const exported = await (await page.request.get("/api/account/export")).json();
    expect(exported.coachingSessions[0].reschedules).toEqual([expect.objectContaining({ newAt: null, by: "candidate" }), expect.objectContaining({ newAt: null, by: "coach" })]);
  });

  // Issue #248: a Retired Human Coach's past sessions still show on the Agenda, and the Data export
  // holds the date, duration, video link and note of a Coaching Session, never the booking link.
  test("a Retired Human Coach's past Coaching Session still shows, and the Data export holds its details but no booking link", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach"));
    const coachId = await coachIdOf(admin, coach.name);
    await signInWithMagicLink(page, newAddress("coaching-retired"));
    await page.request.post("/api/coaching/checkout", { form: { coachId }, headers: { origin }, maxRedirects: 0 });
    const [started] = await checkoutsFor(coachId);
    const { payload, signature } = signedEvent(
      checkoutSessionEvent("checkout.session.completed", { id: `cs_e2e_${unique()}`, candidateId: started!["metadata[candidate_id]"]!, coachId, amount: 9000, currency: "eur", paymentStatus: "paid" }),
    );
    const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
    expect(delivered.status()).toBe(200);

    await page.goto("/agenda");
    const toSchedule = page.getByRole("region", { name: fr.agenda.toSchedule });
    await toSchedule.getByRole("button", { name: tr(fr.coachingSession.enterDateFor, { name: coach.name }) }).click();
    const dialog = page.getByRole("dialog", { name: tr(fr.coachingSession.title, { name: coach.name }) });
    const pastDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() - 10 * 86_400_000));
    await dialog.getByLabel(fr.coachingSession.date).fill(`${pastDay}T10:00`);
    await dialog.getByLabel(fr.coachingSession.duration).fill("45");
    await dialog.getByLabel(fr.coachingSession.videoLink).fill("https://meet.google.com/abc-defg-hij");
    await dialog.getByLabel(fr.coachingSession.note).fill("Préparer mon pitch.");
    await dialog.getByRole("button", { name: fr.coachingSession.save }).click();
    await expect(dialog).toHaveCount(0);

    await admin.goto("/admin/coachs");
    await admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name: coach.name }) }).click();
    await expect(admin.getByRole("status")).toHaveText(fr.admin.humanCoaches.retired);
    await admin.context().close();

    await page.goto("/agenda?periode=passes");
    const past = page.getByRole("region", { name: fr.agenda.pastTitle }).getByRole("region");
    await expect(past).toHaveCount(1);
    await expect(past.first().getByRole("heading").locator("time")).toHaveAttribute("datetime", pastDay);
    await expect(past.first().getByRole("listitem")).toContainText(tr(fr.agenda.withCoach, { name: coach.name }));

    const exportResponse = await page.request.get("/api/account/export");
    expect(exportResponse.status()).toBe(200);
    const exported = await exportResponse.json();
    expect(exported.coachingSessions).toEqual([
      expect.objectContaining({ coach: { id: coachId, name: coach.name }, scheduledAt: expect.any(String), durationMinutes: 45, videoLink: "https://meet.google.com/abc-defg-hij", note: "Préparer mon pitch." }),
    ]);
    expect(JSON.stringify(exported)).not.toContain(coach.bookingUrl);
  });

  // Issue #249: the Human Coach enters or corrects the date and video link of their own Coaching
  // Sessions in the Coach space, without Coach Access; the Candidate's Agenda says the coach changed
  // it. Another Human Coach and a Retired Human Coach are refused.
  test("a Human Coach enters the date of their own Coaching Session in the Coach space; the Candidate's Agenda shows it, changed by the coach", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coachEmail = newAddress("coach");
    const coach = await addCoach(admin, coachEmail);
    const coachId = await coachIdOf(admin, coach.name);
    const otherCoachEmail = newAddress("coach-other");
    await addCoach(admin, otherCoachEmail);
    await signInWithMagicLink(page, newAddress("coaching-by-coach"));
    const named = await page.request.post("/api/auth/update-user", { data: { name: "Marie Dupont" }, headers: { origin } });
    expect(named.ok(), await named.text()).toBe(true);
    await page.request.post("/api/coaching/checkout", { form: { coachId }, headers: { origin }, maxRedirects: 0 });
    const [started] = await checkoutsFor(coachId);
    const { payload, signature } = signedEvent(
      checkoutSessionEvent("checkout.session.completed", { id: `cs_e2e_${unique()}`, candidateId: started!["metadata[candidate_id]"]!, coachId, amount: 9000, currency: "eur", paymentStatus: "paid" }),
    );
    const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
    expect(delivered.status()).toBe(200);

    // No Coach Access granted: the coach still sees the session, naming the Candidate « Marie D. ».
    const coachPage = await personPage(browser, coachEmail);
    await coachPage.goto("/espace-coach");
    const sessions = coachPage.getByRole("region", { name: space.sessionsTitle });
    const session = sessions.getByRole("listitem").filter({ hasText: "Marie D." });
    await expect(session).toHaveCount(1);
    await expect(session).toContainText(space.sessionToSchedule);
    await expect(sessions).not.toContainText("Marie Dupont");
    await expect(coachPage.getByRole("region", { name: space.candidatesTitle })).toContainText(space.none);

    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(Date.now() + 4 * 86_400_000));
    await session.getByRole("button", { name: tr(fr.coachingSession.coachEnterDateFor, { name: "Marie D." }) }).click();
    const dialog = coachPage.getByRole("dialog", { name: tr(fr.coachingSession.title, { name: "Marie D." }) });
    await expect(dialog.getByLabel(fr.coachingSession.note)).toHaveCount(0);
    await dialog.getByLabel(fr.coachingSession.date).fill(`${day}T18:15`);
    await dialog.getByLabel(fr.coachingSession.duration).fill("45");
    await dialog.getByLabel(fr.coachingSession.videoLink).fill("https://meet.google.com/coa-chco-ach");
    await dialog.getByRole("button", { name: fr.coachingSession.save }).click();
    await expect(dialog).toHaveCount(0);
    await expect(session).toContainText("18:15");
    await expect(session).not.toContainText(space.sessionToSchedule);
    await expect(session.getByRole("link", { name: tr(space.joinVideo, { name: "Marie D." }) })).toHaveAttribute("href", "https://meet.google.com/coa-chco-ach");
    const sessionId = (await session.getAttribute("id"))!.replace("seance-", "");

    await page.goto("/agenda");
    await expect(page.getByRole("region", { name: fr.agenda.toSchedule })).toHaveCount(0);
    const item = page.getByRole("region", { name: fr.agenda.upcomingTitle }).getByRole("listitem");
    await expect(item).toContainText("18:15");
    await expect(item).toContainText(tr(fr.agenda.withCoach, { name: coach.name }));
    await expect(item).toContainText(fr.agenda.changedByCoach);

    // Another Human Coach neither sees nor edits it.
    const otherCoach = await personPage(browser, otherCoachEmail);
    await otherCoach.goto("/espace-coach");
    await expect(otherCoach.getByRole("region", { name: space.sessionsTitle })).toContainText(space.sessionsNone);
    const refused = await otherCoach.request.patch(`/api/coach-space/sessions/${sessionId}`, { data: { scheduledAt: `${day}T09:00` }, headers: { origin } });
    expect(refused.status()).toBe(404);
    await otherCoach.context().close();

    // Retired, the Human Coach can no longer edit it; the Candidate keeps it.
    await admin.goto("/admin/coachs");
    await admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name: coach.name }) }).click();
    await expect(admin.getByRole("status")).toHaveText(fr.admin.humanCoaches.retired);
    await admin.context().close();
    const retired = await coachPage.request.patch(`/api/coach-space/sessions/${sessionId}`, { data: { scheduledAt: `${day}T09:00` }, headers: { origin } });
    expect(retired.status()).toBe(404);
    expect((await coachPage.goto("/espace-coach"))?.status()).toBe(404);
    await coachPage.context().close();
    await page.reload();
    await expect(page.getByRole("region", { name: fr.agenda.upcomingTitle }).getByRole("listitem")).toContainText("18:15");
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
    expect(calls.filter((call) => call.path === "/v1/checkout/sessions").at(-1)?.params["line_items[0][price]"]).toBe(FAKE_STRIPE_COACHING_SESSION_PRICES.discounted);
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
    await page.goto(`/candidatures/${applicationId}/avis`);
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

  test("the Back Office lists the Human Coaches it adds and retires them; retired ones can no longer be booked", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach"));
    const active = admin.getByRole("region", { name: fr.admin.humanCoaches.listTitle });
    await expect(active).toContainText(coach.name);
    await expect(active.getByRole("link", { name: coach.bookingUrl })).toHaveAttribute("href", coach.bookingUrl);

    await signInWithMagicLink(page, newAddress("retired-coach-candidate"));
    await page.goto("/coachs");
    await expect(page.getByRole("button", { name: tr(hc.book, { name: coach.name }) })).toBeVisible();

    await admin.goto("/admin/coachs");
    await admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name: coach.name }) }).click();
    await expect(admin.getByRole("status")).toHaveText(fr.admin.humanCoaches.retired);
    await expect(admin.getByRole("button", { name: tr(fr.admin.humanCoaches.retire, { name: coach.name }) })).toHaveCount(0);
    await expect(active).not.toContainText(coach.name);

    await page.reload();
    await expect(page.getByRole("button", { name: tr(hc.book, { name: coach.name }) })).toHaveCount(0);
    await admin.context().close();
  });

  test("the Human Coaches of the Back Office are for Administrators only", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("not-an-admin"));
    const response = await page.goto("/admin/coachs");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.errorPage.notFound.title);
    await expect(page.getByLabel(fr.admin.humanCoaches.bookingUrl)).toHaveCount(0);
  });

  test("a Coaching Session is not recorded from a webhook Stripe did not sign, and no Human Coach is paid through Stripe", async ({ page, browser }) => {
    const admin = await personPage(browser, ADMINISTRATOR);
    const coach = await addCoach(admin, newAddress("coach"));
    const coachId = await coachIdOf(admin, coach.name);
    await admin.context().close();
    await signInWithMagicLink(page, newAddress("forged-session"));
    const started = await page.request.post("/api/coaching/checkout", { form: { coachId }, headers: { origin }, maxRedirects: 0 });
    expect(started.status()).toBe(303);
    const [checkout] = await checkoutsFor(coachId);

    const event = checkoutSessionEvent("checkout.session.completed", {
      id: `cs_e2e_${unique()}`,
      candidateId: checkout!["metadata[candidate_id]"]!,
      coachId,
      amount: 9000,
      currency: "eur",
      paymentStatus: "paid",
    });
    const forged = signedEvent(event, "whsec_someone_else");
    const refused = await page.request.post("/api/billing/webhook", { data: forged.payload, headers: { "stripe-signature": forged.signature, "content-type": "application/json" } });
    expect(refused.status()).toBe(400);

    await page.goto("/coachs?session=paid");
    await expect(page.getByRole("status").filter({ hasText: hc.paidPending })).toHaveText(hc.paidPending);
    await expect(page.getByRole("link", { name: tr(hc.pickSlot, { name: coach.name }) })).toHaveCount(0);

    // Human Coaches are paid outside the platform: Jobbbox never asks Stripe for a transfer or payout.
    const calls: { path: string; params: Record<string, string> }[] = await (await fetch(`${stripeUrl}/__calls`)).json();
    expect(calls.filter((call) => /\/v1\/(transfers|payouts|accounts)/.test(call.path))).toEqual([]);
    expect(checkout!["payment_intent_data[transfer_data][destination]"]).toBeUndefined();
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

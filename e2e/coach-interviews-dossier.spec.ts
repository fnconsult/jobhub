import path from "node:path";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { fakeCustomerId, FAKE_STRIPE_PRICES, signedEvent, subscriptionEvent } from "../apps/web/src/billing/fake-stripe";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";
import { parisDay } from "./support/paris-days";

// Issue #1098 (ADR-0114): what the AI Coach reads and proposes in an Application's Entretiens, Dossier, Contacts and Avis.
// Driven through the public entry points: POST /api/coach (the Coach Panel's route) with the faked AI Coach calling the
// Coach Action a message names (`E2E_COACH_TOOL=<name>:<json>`, fake-mistral.mjs), the conversation's cards in the browser
// (« Appliquer »), the Application's own routes and pages, and the Back Office's Eval Cases. The reads' result comes back in
// the reply as « Résultat de l'outil « <name> » : <result> », which is what the model is sent. COACH_ACTIONS_ENABLED is on
// for this spec's server only; the register, the contact-data provider (Apollo) and Stripe are faked.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.coachProposals;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 1098;
const SUPER_ADMIN = "coach-interviews-office@e2e.jobbbox.test";
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const masterCv = {
  fullName: "Sophie Martin",
  headline: "Contrôleuse de gestion",
  email: "sophie.martin@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

let server: OwnServer;

async function query<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query<T>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

type Candidate = { page: Page; email: string; id: string; profileId: string };

/** A new Candidate, signed in on a wide screen, with a Profile; on Premium when asked, through Stripe's signed webhook. */
async function newCandidate(browser: Browser, { premium = false }: { premium?: boolean } = {}): Promise<Candidate> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const email = newAddress("coach-1098");
  await signInByEmail(page, server, email);
  const headers = { origin: server.origin };
  if (premium) {
    const checkout = await page.request.post("/api/billing/checkout", { form: { plan: "premium" }, headers, maxRedirects: 0 });
    expect(checkout.status()).toBe(303);
    const { payload, signature } = signedEvent(subscriptionEvent("customer.subscription.created", { customer: fakeCustomerId(email), price: FAKE_STRIPE_PRICES.premium, status: "active" }));
    const delivered = await page.request.post("/api/billing/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
    expect(delivered.status()).toBe(200);
  }
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const session = await (await page.request.get("/api/auth/get-session")).json();
  return { page, email, id: session.user.id as string, profileId: (await profile.json()).id as string };
}

/** An Application of `candidate` at `employer`, saved "Postulée". */
async function withApplication(candidate: Candidate, employer: string | undefined, content = "Poste de DAF."): Promise<string> {
  const headers = { origin: server.origin };
  const offer = await candidate.page.request.post("/api/job-offers", {
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, title: "DAF H/F", content: `(réf. ${unique()}) ${content}`, employer, location: "Lyon" },
    headers,
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await candidate.page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: candidate.profileId }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);
  const id = (await saved.json()).id as string;
  const applied = await candidate.page.request.patch(`/api/applications/${id}`, { data: { status: "applied" }, headers });
  expect(applied.ok(), await applied.text()).toBe(true);
  return id;
}

/** Asks the AI Coach through the Coach Panel's route to call `tool`; its reply (with a read's result) and its cards. */
async function ask(page: Page, tool: string, args: object, { focus, message = "Regarde." }: { focus?: { kind: string; id: string }; message?: string } = {}) {
  const asked = await page.request.post("/api/coach", {
    headers: { origin: server.origin },
    data: { message: `${message}\nE2E_COACH_TOOL=${tool}:${JSON.stringify(args)}`, ...(focus ? { focus } : {}) },
  });
  expect(asked.status(), await asked.text()).toBe(200);
  const body = await asked.json();
  return { reply: String(body.reply ?? ""), cards: (body.cards ?? []) as { id: string; status: string; change: Record<string, any> }[], conversationId: body.conversation.id as string };
}

const toolResult = (reply: string, tool: string) => {
  const marker = `Résultat de l'outil « ${tool} » : `;
  expect(reply, reply).toContain(marker);
  return reply.slice(reply.indexOf(marker) + marker.length);
};

const cardOf = (page: Page, what: string) => page.getByRole("region", { name: fr.conversationFirst.label }).getByRole("article", { name: new RegExp(what) });
const interviewOf = async (id: string) => (await query<{ note: string; cancelled_at: Date | null; scheduled_at: Date }>("SELECT note, cancelled_at, scheduled_at FROM interview WHERE id = $1", [id]))[0]!;

/** An Interview added to an Application (past ones too, as the Agenda's own form allows), by its route. */
async function addInterview(page: Page, applicationId: string, body: object): Promise<string> {
  const known = new Set((await query<{ id: string }>("SELECT id FROM interview WHERE application_id = $1", [applicationId])).map((row) => row.id));
  const added = await page.request.post(`/api/applications/${applicationId}/interviews`, { data: { moveToInterview: true, ...body }, headers: { origin: server.origin } });
  expect(added.status(), await added.text()).toBe(200);
  // The route answers the Application's id: the new Interview's is the one that was not there before.
  const [created] = (await query<{ id: string }>("SELECT id FROM interview WHERE application_id = $1", [applicationId])).filter((row) => !known.has(row.id));
  expect(created, "the Interview was saved").toBeTruthy();
  return created!.id;
}

test.describe.configure({ mode: "serial" });

test.describe("the AI Coach in an Application's Entretiens, Dossier, Contacts and Avis (#1098)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "coach_interviews_dossier", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-coach-interviews-dossier-e2e-coach-interviews-dos",
      MAIL_TRANSPORT: "console",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      PERPLEXITY_API_KEY: "e2e-perplexity-key",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      CONTACT_ENRICHMENT_PROVIDER: "apollo",
      APOLLO_API_KEY: "e2e-apollo-key",
      CONTACT_ENRICHMENT_DPA_SIGNED: "true",
      ADMIN_EMAILS: SUPER_ADMIN,
      COACH_ACTIONS_ENABLED: "true",
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs", "fake-company-sources.mjs", "fake-contact-provider.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  // ---------------------------------------------------------------------------------------------------- Entretiens

  test("read_application gives every Interview, past and cancelled ones too, with its id, date and time, duration, format, place or link, note and cancellation", async ({ browser }) => {
    const candidate = await newCandidate(browser);
    const applicationId = await withApplication(candidate, "Exemple Aéro");
    const past = await addInterview(candidate.page, applicationId, { scheduledAt: `${parisDay(-10)}T10:30`, durationMinutes: 45, format: "video", place: "https://meet.example.fr/e2e-room", note: "Prévoir les chiffres de clôture." });
    const cancelled = await addInterview(candidate.page, applicationId, { scheduledAt: `${parisDay(-20)}T16:15`, durationMinutes: 30, format: "on_site", place: "12 rue de la Paix, Lyon" });
    const cancelling = await candidate.page.request.post(`/api/applications/${applicationId}/interviews/${cancelled}/cancel`, { headers: { origin: server.origin } });
    expect(cancelling.ok(), await cancelling.text()).toBe(true);

    const { reply } = await ask(candidate.page, "read_application", { id: applicationId });
    const read = toolResult(reply, "read_application");
    // The past Interview, in full.
    const line = read.split("\n").find((each) => each.includes(`id ${past}`))!;
    expect(line, read).toBeTruthy();
    expect(line).toContain("45 min");
    expect(line).toContain("visio");
    expect(line).toContain("lien : https://meet.example.fr/e2e-room");
    expect(line).toContain("note : Prévoir les chiffres de clôture.");
    expect(line).toMatch(/10 ?[:h] ?30/);
    expect(line).not.toContain("annulé");
    // The cancelled one: its place and its cancellation.
    const cancelledLine = read.split("\n").find((each) => each.includes(`id ${cancelled}`))!;
    expect(cancelledLine, read).toBeTruthy();
    expect(cancelledLine).toContain("30 min");
    expect(cancelledLine).toContain("sur place");
    expect(cancelledLine).toContain("lieu : 12 rue de la Paix, Lyon");
    expect(cancelledLine).toMatch(/16 ?[:h] ?15/);
    expect(cancelledLine).toContain("[annulé le ");
  });

  test("a past Interview can be changed with a note and cancelled: the card shows the whole note, the current one folded under « Texte actuel », « Appliquer » writes it", async ({ browser }) => {
    const candidate = await newCandidate(browser);
    const applicationId = await withApplication(candidate, "Exemple Aéro");
    const past = await addInterview(candidate.page, applicationId, { scheduledAt: `${parisDay(-3)}T14:00`, durationMinutes: 60, note: "Ancienne note : DAF du site." });
    const newNote = "Questions posées : clôture en J+5, SAP, désaccord avec un chef d'atelier. Interlocuteurs : le DAF et la DRH.";

    // « note les questions qu'on m'a posées », the Application In view.
    const asked = await ask(candidate.page, "propose_interview_change", { interviewId: past, note: newNote }, { focus: { kind: "application", id: applicationId }, message: "Note les questions qu'on m'a posées." });
    expect(asked.cards).toHaveLength(1);
    expect(asked.cards[0]).toMatchObject({ status: "pending", change: { text: { name: "note", before: "Ancienne note : DAF du site.", after: newNote } } });
    // Proposed, nothing written.
    expect((await interviewOf(past)).note).toBe("Ancienne note : DAF du site.");

    await candidate.page.goto(`/conversations/${asked.conversationId}`);
    const card = cardOf(candidate.page, texts.fields.interview);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(texts.by);
    // The whole new note is on the card; the current one is folded under « Texte actuel ».
    await expect(card).toContainText(newNote);
    const folded = card.locator("details").filter({ hasText: texts.currentText });
    await expect(folded).toHaveCount(1);
    expect(await folded.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false);
    await folded.locator("summary").click();
    await expect(folded).toContainText("Ancienne note : DAF du site.");

    await card.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(card.getByRole("status")).toHaveText(new RegExp(`^${tr(texts.applied, { time: "\\d\\d:\\d\\d" })}$`));
    expect((await interviewOf(past)).note).toBe(newNote);

    // A past Interview is cancelled too.
    const cancelAsk = await ask(candidate.page, "propose_interview_cancel", { applicationId, interviewId: past }, { message: "Annule cet entretien." });
    expect(cancelAsk.cards).toHaveLength(1);
    await candidate.page.goto(`/conversations/${cancelAsk.conversationId}`);
    const cancelCard = cardOf(candidate.page, texts.fields.interview);
    await expect(cancelCard).toBeVisible({ timeout: 30_000 });
    await cancelCard.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(cancelCard.getByRole("status")).toBeVisible();
    expect((await interviewOf(past)).cancelled_at).not.toBeNull();
  });

  test("propose_interview takes a note, offered with an Application In view; a version conflict is refused; the « Ne propose pas de note » rule is gone", async ({ browser }) => {
    const candidate = await newCandidate(browser);
    const applicationId = await withApplication(candidate, "Exemple Aéro");

    // propose_interview with a note, the Application In view (sentByCandidate: the card stays offered).
    const day = parisDay(6);
    const note = "Préparer : budget 2026, SAP, la clôture mensuelle.";
    const proposed = await ask(candidate.page, "propose_interview", { applicationId, scheduledAt: `${day}T09:00`, note }, { focus: { kind: "application", id: applicationId }, message: "Ajoute mon entretien avec cette note." });
    expect(proposed.cards).toHaveLength(1);
    expect(proposed.cards[0]).toMatchObject({ status: "pending", change: { text: { name: "note", after: note } } });
    await candidate.page.goto(`/conversations/${proposed.conversationId}`);
    const newCard = cardOf(candidate.page, texts.fields.newInterview);
    await expect(newCard).toContainText(note);
    await newCard.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(newCard.getByRole("status")).toBeVisible();
    const [saved] = await query<{ id: string; note: string }>("SELECT id, note FROM interview WHERE application_id = $1", [applicationId]);
    expect(saved?.note).toBe(note);

    // A conflict: the note is changed elsewhere after the card was made, « Appliquer » refuses.
    const changed = await ask(candidate.page, "propose_interview_change", { interviewId: saved!.id, note: "Note du coach" }, { focus: { kind: "application", id: applicationId } });
    expect(changed.cards).toHaveLength(1);
    const edited = await candidate.page.request.patch(`/api/applications/${applicationId}/interviews/${saved!.id}`, { data: { note: "Note modifiée à la main" }, headers: { origin: server.origin } });
    expect(edited.ok(), await edited.text()).toBe(true);
    await candidate.page.goto(`/conversations/${changed.conversationId}`);
    const conflicted = cardOf(candidate.page, texts.fields.interview);
    await conflicted.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(conflicted.getByRole("alert")).toBeVisible();
    expect((await interviewOf(saved!.id)).note).toBe("Note modifiée à la main");

    // The rule is gone from the Coach Action's instructions.
    expect(readFileSync("apps/web/src/coach-actions/agenda.ts", "utf8")).not.toMatch(/Ne propose pas de note/i);
  });

  // -------------------------------------------------------------------------------------------------------- Dossier

  test("read_company_dossier gives the whole dossier, untrusted and with its source; the coach has no way to write its content; « Mettre à jour » shows the Plan Quota", async ({ browser }) => {
    const candidate = await newCandidate(browser);
    const applicationId = await withApplication(candidate, "Acme Industrie");

    // Not built: the AI Coach is told to propose the build.
    const before = await ask(candidate.page, "read_company_dossier", { id: applicationId });
    expect(toolResult(before.reply, "read_company_dossier")).toContain("propose_company_dossier_rebuild");

    // « Mettre à jour »: a card with the Plan Quota, nothing written until the Candidate applies it.
    const proposed = await ask(candidate.page, "propose_company_dossier_rebuild", { applicationId }, { message: "Constitue le dossier." });
    expect(proposed.cards).toHaveLength(1);
    expect(proposed.cards[0]!.change.quota?.label).toBe(texts.quota.companyDossier);
    expect(await query("SELECT 1 FROM company_dossier WHERE application_id = $1", [applicationId]).catch(() => [])).toHaveLength(0);
    await candidate.page.goto(`/conversations/${proposed.conversationId}`);
    const card = cardOf(candidate.page, texts.fields.companyDossier);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(texts.quota.companyDossier);
    await card.getByRole("button", { name: texts.update, exact: true }).click();
    await expect(card.getByText(texts.runResult.company_dossier)).toBeVisible({ timeout: 60_000 });

    // Built: the whole dossier is read, quoted with its source.
    const after = await ask(candidate.page, "read_company_dossier", { id: applicationId });
    const dossier = toolResult(after.reply, "read_company_dossier");
    expect(dossier).toContain("Source : registre français des entreprises");
    expect(dossier).toContain("Raison sociale : ");
    expect(dossier).toContain("ACME INDUSTRIE");
    expect(dossier).toContain("Cite-le en donnant sa source");
    const stored = await (await candidate.page.request.get(`/api/applications/${applicationId}/company-dossier`)).json();

    // The coach never writes the dossier's content: no such tool, and nothing changed.
    const attempt = await ask(candidate.page, "write_company_dossier", { applicationId, text: "Faux dossier" });
    expect(attempt.cards).toEqual([]);
    const unchanged = await (await candidate.page.request.get(`/api/applications/${applicationId}/company-dossier`)).json();
    expect(unchanged).toEqual(stored);
  });

  test("a Cabinet's posting: propose_dossier_employer is a card with a form that confirms or corrects the presumed employer", async ({ browser }) => {
    const candidate = await newCandidate(browser);
    const applicationId = await withApplication(candidate, "Cabinet Talents & Co", "Notre client, un industriel lyonnais, recrute son DAF. Client présumé : Acme Industrie");

    // The Dossier Section reads the posting: a Cabinet's, its client is only presumed until the Candidate confirms it.
    const started = await candidate.page.request.post(`/api/applications/${applicationId}/company-dossier`, { headers: { origin: server.origin } });
    expect(started.ok(), await started.text()).toBe(true);
    const read = toolResult((await ask(candidate.page, "read_company_dossier", { id: applicationId })).reply, "read_company_dossier");
    expect(read).toContain("Employeur présumé : Acme Industrie");
    expect(read).toContain("propose_dossier_employer");

    const proposed = await ask(candidate.page, "propose_dossier_employer", { applicationId, employer: "Acme Industrie" }, { focus: { kind: "application", id: applicationId }, message: "C'est bien Acme." });
    expect(proposed.cards).toHaveLength(1);
    await candidate.page.goto(`/conversations/${proposed.conversationId}`);
    const card = cardOf(candidate.page, texts.fields.dossierEmployer);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(tr(texts.values.presumedEmployer, { employer: "Acme Industrie" }));
    // The form: the employer as presumed, which the Candidate confirms as it is or corrects before applying.
    await card.getByRole("button", { name: texts.edit, exact: true }).click();
    const pane = candidate.page.getByRole("complementary", { name: tr(texts.editTitle, { what: texts.fields.dossierEmployer }) });
    const field = pane.getByRole("textbox", { name: texts.fields.employerName });
    await expect(field).toHaveValue("Acme Industrie");
    await field.fill("ACME INDUSTRIE");
    await pane.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(pane).toBeHidden({ timeout: 60_000 });
    await expect(card.getByRole("status")).toHaveText(new RegExp(`^${tr(texts.applied, { time: "\\d\\d:\\d\\d" })}$`), { timeout: 60_000 });
    const built = await (await candidate.page.request.get(`/api/applications/${applicationId}/company-dossier`)).json();
    expect(JSON.stringify(built)).toContain("ACME INDUSTRIE");
  });

  // ------------------------------------------------------------------------------------------------------ Contacts

  test("Premium: read_enriched_contacts gives id, name, role and revealed or not, never an email or a phone; search and reveal cards say the quota; the Outreach Message is addressed to the contact", async ({ browser }) => {
    const candidate = await newCandidate(browser, { premium: true });
    const applicationId = await withApplication(candidate, "Acme Industrie");
    const built = await candidate.page.request.post(`/api/applications/${applicationId}/company-dossier`, { headers: { origin: server.origin } });
    expect(built.ok(), await built.text()).toBe(true);

    // The search card: the quota (not counted), no Upgrade prompt.
    const search = await ask(candidate.page, "propose_contact_search", { applicationId }, { message: "Cherche des contacts." });
    expect(search.cards).toHaveLength(1);
    await candidate.page.goto(`/conversations/${search.conversationId}`);
    const searchCard = cardOf(candidate.page, texts.fields.contactSearch);
    await expect(searchCard).toBeVisible({ timeout: 30_000 });
    await expect(searchCard).toContainText(/contacts? enrichis? (sur 5 )?cette semaine|illimités/);
    await searchCard.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(searchCard.getByRole("status")).toBeVisible({ timeout: 30_000 });

    // Found, not revealed: id, name and role; no details.
    const found = toolResult((await ask(candidate.page, "read_enriched_contacts", { id: applicationId })).reply, "read_enriched_contacts");
    expect(found).toMatch(/contact \(id [^)]+\) Claire Ma\*\*\*n, DRH : trouvé, pas encore révélé/);
    expect(found).toMatch(/Hugo Be\*\*\*d, Responsable recrutement : trouvé, pas encore révélé/);
    const claireId = /contact \(id ([^)]+)\) Claire Ma/.exec(found)![1]!;

    // The reveal card: one counted, the week's room said.
    const reveal = await ask(candidate.page, "propose_contact_reveal", { applicationId, contactId: claireId }, { message: "Révèle Claire." });
    expect(reveal.cards).toHaveLength(1);
    await candidate.page.goto(`/conversations/${reveal.conversationId}`);
    const revealCard = cardOf(candidate.page, texts.fields.enrichedContact);
    await expect(revealCard).toBeVisible({ timeout: 30_000 });
    await expect(revealCard).toContainText(tr(texts.quota.contactReveal, { limit: "5", left: "4" }));
    await revealCard.getByRole("button", { name: texts.apply, exact: true }).click();
    await expect(revealCard.getByRole("status")).toBeVisible({ timeout: 30_000 });

    // Revealed: named, with her role, and never her email or phone, in what the model is sent.
    const revealedReply = (await ask(candidate.page, "read_enriched_contacts", { id: applicationId })).reply;
    const revealed = toolResult(revealedReply, "read_enriched_contacts");
    expect(revealed).toMatch(/contact \(id [^)]+\) Claire Martin, DRH : révélé/);
    expect(revealedReply).not.toContain("claire.martin@acme-industrie.example");
    expect(revealedReply).not.toMatch(/@acme-industrie|\+33|0[1-9]( ?\d\d){4}/);
    // Her details exist for the Candidate on the page, so the absence above is the model's, not the data's.
    const state = await (await candidate.page.request.get(`/api/applications/${applicationId}/enriched-contacts`)).json();
    expect(JSON.stringify(state)).toContain("claire.martin@acme-industrie.example");
    // Nor do they reach the provider-bound request the server logged for the model.
    expect(server.output()).not.toMatch(/tool call read_enriched_contacts[^\n]*claire\.martin@/);

    // « Écris un message d'approche à Claire »: addressed to her contact, by contactId.
    const contactId = state.contacts[0].id as string;
    const outreach = await ask(candidate.page, "propose_outreach_message", { applicationId, contactId }, { message: "Écris un message d'approche à Claire." });
    expect(outreach.cards).toHaveLength(1);
    expect(JSON.stringify(outreach.cards[0]!.change)).toContain("Claire Martin");
    await candidate.page.goto(`/conversations/${outreach.conversationId}`);
    const outreachCard = cardOf(candidate.page, texts.fields.draft.outreach_message);
    await expect(outreachCard).toBeVisible({ timeout: 30_000 });
    await expect(outreachCard).toContainText("Claire Martin");
  });

  test("a Plan without Enriched Contacts: the search and reveal cards show the Upgrade prompt in place of their buttons", async ({ browser }) => {
    const candidate = await newCandidate(browser);
    const applicationId = await withApplication(candidate, "Acme Industrie");
    const built = await candidate.page.request.post(`/api/applications/${applicationId}/company-dossier`, { headers: { origin: server.origin } });
    expect(built.ok(), await built.text()).toBe(true);

    const search = await ask(candidate.page, "propose_contact_search", { applicationId }, { message: "Cherche des contacts." });
    expect(search.cards).toHaveLength(1);
    expect(search.cards[0]!.change.quota).toMatchObject({ label: texts.quota.contactsNotIncluded.replace("{{limit}}", "0") });
    expect(search.cards[0]!.change.quota.prompt).toBeTruthy();
    await candidate.page.goto(`/conversations/${search.conversationId}`);
    const card = cardOf(candidate.page, texts.fields.contactSearch);
    await expect(card).toBeVisible({ timeout: 30_000 });
    // The Upgrade prompt says why, in place of the quota line, and offers Premium.
    await expect(card).toContainText("Les contacts enrichis ne sont pas compris dans l'offre Gratuit");
    await expect(card.getByRole("link", { name: /Premium/ })).toBeVisible();
    await expect(card.getByRole("button", { name: texts.apply, exact: true })).toHaveCount(0);
  });

  // ----------------------------------------------------------------------------------------------------------- Avis

  test("read_coach_reviews gives author (Prénom N.), date, Tailored Document and text, untrusted; Private Coach Notes are never read; no action edits or deletes a review", async ({ browser }) => {
    const candidate = await newCandidate(browser);
    const applicationId = await withApplication(candidate, "Exemple Aéro");
    const [coach] = await query<{ id: string }>(`INSERT INTO human_coach (name, email, booking_url) VALUES ($1, $2, $3) RETURNING id`, ["Marie Lambert", `marie-${unique()}@coachs.example`, "https://cal.com/marie-lambert/seance"]);
    await query("INSERT INTO coach_access (candidate_id, coach_id) VALUES ($1, $2)", [candidate.id, coach!.id]);
    const REVIEW = "Ouvrez sur votre dernier poste de DAF, pas sur votre formation.";
    await query("INSERT INTO coach_review (candidate_id, application_id, coach_id, document, text) VALUES ($1, $2, $3, 'cover_letter', $4)", [candidate.id, applicationId, coach!.id, REVIEW]);
    const PRIVATE = "Note privée : la candidate hésite à quitter Lyon et doute d'elle-même.";
    await query("INSERT INTO private_coach_note (coach_id, candidate_id, text) VALUES ($1, $2, $3)", [coach!.id, candidate.id, PRIVATE]);

    const { reply } = await ask(candidate.page, "read_coach_reviews", { id: applicationId }, { message: "Tiens compte de l'avis de Marie dans ma lettre." });
    const read = toolResult(reply, "read_coach_reviews");
    expect(read).toContain("avis de Marie L., le ");
    expect(read).toContain("sur la lettre de motivation");
    expect(read).toContain(REVIEW);
    expect(read).not.toContain("Lambert");
    // Private Coach Notes are never read, by this read or any other.
    for (const tool of [["read_coach_reviews", { id: applicationId }], ["read_application", { id: applicationId }], ["list_objects", {}]] as const) {
      const text = (await ask(candidate.page, tool[0], tool[1])).reply;
      expect(text).not.toContain("hésite à quitter Lyon");
      expect(text).not.toContain("Note privée");
    }

    // No action modifies or deletes a review: nothing is proposed, and the rows are as they were.
    for (const tool of ["propose_coach_review_change", "propose_coach_review_delete", "propose_coach_review_cancel"]) {
      expect((await ask(candidate.page, tool, { applicationId, text: "Avis modifié" })).cards).toEqual([]);
    }
    expect(await query("SELECT text FROM coach_review WHERE application_id = $1", [applicationId])).toEqual([{ text: REVIEW }]);
    expect(readFileSync("apps/web/src/coach-actions/index.ts", "utf8")).not.toMatch(/propose_coach_review/);
  });

  // ------------------------------------------------------------------------------------------------------ Eval Cases

  test("the Back Office plays the AI Coach's Eval Cases of this issue: the past Interview's note, the dossier, the revealed contact, the coach's review", async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ baseURL: server.origin, locale: "en-US" });
    const page = await context.newPage();
    await signInByEmail(page, server, SUPER_ADMIN);
    await page.goto("/admin/playbooks");
    const section = page.locator("section#ai-coach-evals");
    await section.getByRole("button", { name: fr.admin.evals.aiCoach.start }).click();
    await expect(page).toHaveURL(/\/admin\/evaluations\/[0-9a-f-]{36}$/, { timeout: 120_000 });
    for (const title of [
      "Note les questions posées à un entretien passé : la note entière proposée en carte (ADR-0114)",
      "Prépare aux questions sur la stratégie de l'employeur à partir du dossier entreprise, cité avec sa source (ADR-0114)",
      "Propose un message d'approche adressé à un contact enrichi révélé, par son contactId (ADR-0114)",
      "Tient compte de l'avis d'une coach humaine dans la lettre : son nouveau texte proposé en carte (ADR-0114)",
    ]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 120_000 });
    }
  });
});

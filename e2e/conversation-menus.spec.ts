import path from "node:path";
import { readFileSync } from "node:fs";
import AxeBuilder from "./support/axe";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { newAddress } from "./support/mailbox";
import { signInByEmail, startOwnServer, type OwnServer } from "./support/own-server";

// Issue #606 (ADR-0070): under « Conversation au centre », Recherches d'offres, Job Digests, the Agenda and Mes coachs
// humains are their menus' conversations, one per Candidate each, their content cards in the thread: the Job Digests by
// Profile (Recherches d'offres opens on the Offer box instead, its conversation after it: ADR-0090, #815), the Agenda's list (its week, month and « Ajouter un entretien » in the Work Pane), the
// Coaching Sessions and the Human Coaches. Recherches d'offres and Job Digests unfold in the Sidebar into their objects.
// The switch changes every Candidate's pages, so this spec runs on a server of its own (own-server.ts), switched on by
// its environment; the AI Coach is faked inside it (fake-mistral.mjs), and so are the reference data's sources.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const texts = fr.conversationFirst;
/** Inside the suite's own range of derived ports (e2e/support/ports.ts), apart from the other specs' servers. */
const PORT_OFFSET = 606;
const tr = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));

let server: OwnServer;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: server.origin, locale: "fr-FR", viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await signInByEmail(page, server, email);
  return page;
}

/** Creates the Candidate's Profile « DAF »: its id. */
async function createProfile(page: Page): Promise<string> {
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: ["cdi"] } }, headers: { origin: server.origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  return (await profile.json()).id;
}

/** Saves a Job Offer as an Application of `profileId`: its id. */
async function saveApplication(page: Page, profileId: string, title: string): Promise<string> {
  const headers = { origin: server.origin };
  const offer = await page.request.post("/api/job-offers", {
    data: { title, content: `${title} (réf. ${Math.random().toString(36).slice(2)}) : 15 ans d'expérience.`, employer: "Acme Industrie", location: "Lyon", contractType: "cdi" },
    headers,
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const application = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId }, headers });
  expect(application.ok(), await application.text()).toBe(true);
  return (await application.json()).id;
}

async function query<Row extends object>(sql: string, values: unknown[]): Promise<Row[]> {
  const db = new pg.Client({ connectionString: server.databaseUrl });
  await db.connect();
  try {
    return (await db.query<Row>(sql, values)).rows;
  } finally {
    await db.end();
  }
}

const candidateOf = async (email: string) => (await query<{ id: string }>("SELECT id::text FROM candidate WHERE email = $1", [email]))[0]!.id;

const menuConversationsOf = (email: string) =>
  query<{ subject: string; messages: number }>(
    `SELECT c.subject_kind || ':' || c.subject_menu AS subject, (SELECT count(*)::int FROM coach_message m WHERE m.conversation_id = c.id) AS messages
       FROM coach_conversation c JOIN candidate ON candidate.id = c.candidate_id
      WHERE candidate.email = $1 AND c.subject_kind = 'menu' ORDER BY subject`,
    [email],
  );

const conversation = (page: Page) => page.getByRole("region", { name: texts.label });
const messages = (page: Page) => conversation(page).getByRole("list", { name: fr.coachPanel.messagesLabel }).getByRole("listitem");
const suggestions = (page: Page) => conversation(page).getByRole("group", { name: texts.suggestions });
const sidebar = (page: Page) => page.locator(".sidebar-docked").getByRole("navigation", { name: fr.sidebar.label });
const workPane = (page: Page) => page.getByRole("complementary").filter({ has: page.getByRole("button", { name: texts.close, exact: true }) });

/** axe on the page's conversation, and on the Work Pane beside it when `withPane` (duplicate-id-aria included: two views share the page). */
async function noAxeViolations(page: Page, { withPane = false } = {}) {
  const builder = new AxeBuilder({ page }).include(".page-conversation");
  const axe = await (withPane ? builder.include(".work-pane") : builder).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map(({ id }) => id)).toEqual([]);
}

/** Sends `text` in the page's conversation; the caller waits for the reply where it is saved. */
async function send(page: Page, text: string) {
  await conversation(page).getByRole("textbox", { name: fr.coachPanel.messageLabel }).fill(text);
  await conversation(page).getByRole("button", { name: fr.coachPanel.send, exact: true }).click();
  await expect(messages(page).filter({ hasText: text })).toHaveCount(1);
}

test.describe.configure({ mode: "serial" });

test.describe("« Conversation au centre »: Recherches d'offres, Job Digests, Agenda, Mes coachs humains (#606)", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    server = await startOwnServer(PORT_OFFSET, "conversation_menus", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-menus-secret-e2e-menus-secret-e2e-menus",
      MAIL_TRANSPORT: "console",
      AI_SCORING_PROVIDER: "mistral",
      AI_WRITING_PROVIDER: "mistral",
      AI_COACHING_PROVIDER: "mistral",
      AI_CV_PARSING_PROVIDER: "mistral",
      AI_OFFER_ANALYSIS_PROVIDER: "mistral",
      AI_OFFER_EMAIL_READING_PROVIDER: "mistral",
      MISTRAL_API_KEY: "e2e-mistral-key",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      STRIPE_PRICE_STANDARD: "price_standard_monthly",
      STRIPE_PRICE_PREMIUM: "price_premium_monthly",
      STRIPE_PRICE_COACHING_SESSION: "price_coaching_session",
      STRIPE_PRICE_COACHING_SESSION_PREMIUM: "price_coaching_session_premium",
      STRIPE_API_URL: process.env.E2E_STRIPE_URL,
      NODE_OPTIONS: ["fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"].map((fake) => `--import=${path.resolve("e2e/support", fake)}`).join(" "),
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("Recherches d'offres opens on the Offer box (ADR-0090): « Offres à traiter » by day and Importance tier, « Suivre », « Lire l'offre », « Recherches par Profil » and « Reçues par email » in the Work Pane, the conversation after it", async ({ browser }) => {
    const email = newAddress("conversation-job-searches");
    const page = await signedIn(browser, email);
    const profileId = await createProfile(page);
    const candidateId = await candidateOf(email);
    const offer = async (title: string, details: object) => {
      const captured = await page.request.post("/api/job-offers", {
        data: { title, content: `${title} (réf. ${Math.random().toString(36).slice(2)}) : 15 ans d'expérience.`, ...details },
        headers: { origin: server.origin },
      });
      expect(captured.status(), await captured.text()).toBe(200);
      return (await captured.json()).id as string;
    };
    const strong = await offer("DAF H/F", { employer: "Acme Industrie", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] });
    const weak = await offer("Comptable", { employer: "Société Fictive", location: "Marseille", contractType: "cdd", skills: ["Excel"] });
    const earlier = await offer("Directeur financier adjoint", { employer: "Exemple Mécanique", location: "Lyon", contractType: "cdi", skills: ["IFRS", "SAP"] });
    const [unseen] = await query<{ id: string }>(
      "INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, notification_pending) VALUES ($1, $2, 'done', $3, now() - interval '1 day', now() - interval '1 day', true) RETURNING id::text",
      [candidateId, profileId, [strong]],
    );
    // What the doors record (ADR-0090): a Job Search's and an email's offers today, a Job Digest's three days ago.
    const arrived = (jobOfferId: string, profile: string | null, source: string, ago: string) =>
      query(
        `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources)
         VALUES ($1, $2, $3, now() - $5::interval, jsonb_build_object($4::text, to_char((now() - $5::interval) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
        [candidateId, jobOfferId, profile, source, ago],
      );
    await arrived(strong, profileId, "job_search", "0 minutes");
    await arrived(weak, null, "email", "1 minute");
    await arrived(earlier, profileId, "job_digest", "3 days");

    await page.goto("/recherches");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.sidebar.jobSearches);
    const box = conversation(page).getByRole("region", { name: fr.offerBox.title });
    await expect(box.locator(".offer-box-count b")).toHaveText("3");
    // French counts 0 in the singular: « 0 traitée ».
    await expect(box.getByText(tr(fr.offerBox.treated_one, { count: 0 }))).toBeVisible();
    const chips = box.getByRole("group", { name: fr.offerBox.chips });
    // « Toutes » and the six sources, « Extension » and « Partage » among them (#819).
    await expect(chips.getByRole("button")).toHaveCount(7);
    const today = box.getByRole("region", { name: fr.offerBox.today });
    await expect(today.getByRole("heading", { level: 4 })).toHaveText([`${fr.offerBox.tiers.not_to_miss} · ${fr.offerBox.tierHints.not_to_miss}`, `${fr.offerBox.tiers.less_suited} · ${fr.offerBox.tierHints.less_suited}`]);
    await expect(today.getByRole("listitem", { name: "Comptable" })).toContainText(fr.offerBox.unsorted);
    const previously = box.getByRole("region", { name: fr.offerBox.earlier });
    await expect(previously.getByRole("listitem", { name: "Directeur financier adjoint" })).toContainText(tr(fr.offerBox.arrivedOn, { date: "" }).trim());
    // Its header, the day and the tier stay in view while it scrolls; « À ne pas manquer » turns, unless motion is reduced.
    for (const sticky of [".offer-box-head", ".offer-box-day-heading", ".offer-box-tier-heading"]) await expect(box.locator(sticky).first()).toHaveCSS("position", "sticky");
    const notToMiss = today.getByRole("listitem", { name: "DAF H/F" });
    await expect(notToMiss).toHaveCSS("animation-name", "offer-box-turn");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(notToMiss).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: null });
    // The conversation follows the box, its Introduction after it; « Lancer une recherche » above its box.
    await expect(messages(page).first()).toContainText(fr.jobSearchesMenu.introduction);
    await expect(suggestions(page).getByRole("button", { name: fr.jobSearchesMenu.start })).toBeVisible();
    await noAxeViolations(page);

    // A source chip shows only the entries that came by it.
    await chips.getByRole("button", { name: tr(fr.offerBox.chipCount, { source: fr.offerBox.sources.email, count: 1 }) }).click();
    await expect(box.getByRole("listitem")).toHaveCount(1);
    await chips.getByRole("button", { name: tr(fr.offerBox.chipCount, { source: fr.offerBox.sources.all, count: 3 }) }).click();

    // « Lire l'offre » opens the Job Offer in the Work Pane, at its own address.
    await notToMiss.getByRole("link", { name: fr.offerBox.read }).click();
    await expect(page).toHaveURL(`${server.origin}/recherches?offre=${strong}`);
    await expect(workPane(page).getByRole("heading", { level: 2, name: "DAF H/F" })).toBeVisible();
    await workPane(page).getByRole("button", { name: texts.close, exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/recherches`);

    // « Suivre » makes its Application « À postuler »: the entry is « Suivie », folded under « Suivies aujourd'hui ».
    await notToMiss.getByRole("button", { name: fr.offerBox.follow }).click();
    await expect(today.getByText(tr(fr.offerBox.followedToday, { count: 1 }))).toBeVisible();
    await expect(box.locator(".offer-box-count b")).toHaveText("2");
    const applications = await page.request.get("/api/applications");
    expect((await applications.json()).applications).toEqual([expect.objectContaining({ title: "DAF H/F", status: "to_apply" })]);

    // A message goes to the menu's conversation; the page keeps its address.
    await send(page, "Quelles offres regarder ?");
    await expect(page).toHaveURL(`${server.origin}/recherches`);
    await expect.poll(() => menuConversationsOf(email)).toEqual([{ subject: "menu:jobSearches", messages: 2 }]);

    // The Sidebar still unfolds into the Job Searches, marked unseen.
    const sublist = sidebar(page).getByRole("list", { name: fr.sidebar.jobSearches });
    await expect(sublist.getByRole("link")).toHaveText([new RegExp(`^DAF · .*, ${texts.toHandle}$`), tr(texts.seeAll, { count: 1 })]);

    // « Reçues par email » opens in the Work Pane at its own address, and closes back to the menu's.
    await box.getByRole("link", { name: fr.offerBox.receivedByEmail }).click();
    await expect(page).toHaveURL(`${server.origin}/recherches?recues=1`);
    await expect(workPane(page).getByRole("heading", { level: 2, name: fr.receivedByEmail.title })).toBeVisible();
    await workPane(page).getByRole("button", { name: texts.close, exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/recherches`);

    // « Recherches par Profil », the former card, in the Work Pane: each line opens its Job Search.
    await box.getByRole("link", { name: fr.offerBox.byProfile }).click();
    await expect(page).toHaveURL(`${server.origin}/recherches?profils=1`);
    const group = workPane(page).getByRole("region", { name: "DAF" });
    await expect(group.getByRole("row")).toHaveCount(2);
    await expect(group.getByRole("row").nth(1)).toContainText(fr.jobSearch.statuses.done);
    await expect(group.getByRole("row").nth(1)).toContainText(fr.jobSearchesMenu.unseen);
    await noAxeViolations(page, { withPane: true });
    await group.getByRole("row").nth(1).getByRole("link").click();
    await expect(page).toHaveURL(`${server.origin}/recherches/${unseen!.id}`);
  });

  // The prototype of #939 modelled the Sidebar's CSS: beside its fold, « Recherches d'offres » ended in « … » from N = 1
  // (and its fold alone already cut it at 16rem). Measured here in the real page, at the Sidebar's real width.
  test("the Sidebar never cuts « Recherches d'offres » with « … » beside its fold and its « N », at its real width (#939)", async ({ browser }) => {
    const email = newAddress("conversation-job-searches-width");
    const page = await signedIn(browser, email);
    const profileId = await createProfile(page);
    const candidateId = await candidateOf(email);
    // A Job Search: the menu unfolds into it, so its fold stands beside its name.
    await query("INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, now(), now())", [candidateId, profileId, []]);
    const label = sidebar(page).locator(".sidebar-menu-row .sidebar-link-text", { hasText: fr.sidebar.jobSearches });
    /** Whether its name is cut, and on how many lines it stands. */
    const shown = () =>
      label.evaluate((name) => ({
        cut: name.scrollWidth > name.clientWidth || name.scrollHeight > name.clientHeight,
        lines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
      }));
    /** One more offer à traiter, arrived today by a Job Search. */
    const arrives = async (n: number) => {
      const offer = await page.request.post("/api/job-offers", {
        data: { title: `DAF ${n} H/F`, content: `DAF ${n} (réf. ${Math.random().toString(36).slice(2)}) : 15 ans d'expérience.`, employer: "Acme Industrie", location: "Lyon", contractType: "cdi" },
        headers: { origin: server.origin },
      });
      expect(offer.status(), await offer.text()).toBe(200);
      await query(
        `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources)
         VALUES ($1, $2, $3, now(), jsonb_build_object('job_search', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
        [candidateId, (await offer.json()).id, profileId],
      );
    };

    await page.goto("/agenda");
    // 16rem (Confort), at the default text size (Standard, a 17px root): 272 px.
    const rootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect((await page.locator(".sidebar-docked").boundingBox())?.width).toBe(16 * rootPx);
    await expect(sidebar(page).getByRole("button", { name: tr(texts.unfold, { menu: fr.sidebar.jobSearches }) })).toBeVisible();
    await expect(label).toHaveText(fr.sidebar.jobSearches);
    // No offer à traiter: its name stays on its line beside the fold.
    expect(await shown()).toEqual({ cut: false, lines: 1 });

    // One, then nine: « N » beside it, its name whole, on two lines at most (the app's fallback too).
    let arrived = 0;
    for (const count of [1, 9]) {
      for (; arrived < count; arrived += 1) await arrives(arrived + 1);
      await page.reload();
      const words = tr(count === 1 ? texts.offersToHandle_one : texts.offersToHandle_other, { count });
      await expect(sidebar(page).getByRole("link", { name: new RegExp(`^${fr.sidebar.jobSearches}\\s*, ${words}$`) })).toBeVisible();
      await expect(sidebar(page).locator(".sidebar-count")).toHaveText(String(count));
      const { cut, lines } = await shown();
      expect(cut, `« ${fr.sidebar.jobSearches} » cut at N = ${count}`).toBe(false);
      expect(lines).toBeLessThanOrEqual(2);
    }
  });

  test("Job Digests is its conversation: the Job Digests by Profile a card, each line to its page; the Sidebar unfolds into them", async ({ browser }) => {
    const email = newAddress("conversation-job-digests");
    const page = await signedIn(browser, email);
    const profileId = await createProfile(page);
    const [digest] = await query<{ id: string }>("INSERT INTO job_digest (profile_id, candidate_id, job_offer_ids, sent_at) VALUES ($1, $2, '{}', now() - interval '2 days') RETURNING id::text", [
      profileId,
      await candidateOf(email),
    ]);

    await page.goto("/job-digests");
    await expect(messages(page).first()).toContainText(fr.jobDigestsMenu.introduction);
    const card = conversation(page).getByRole("region", { name: fr.jobDigestsMenu.title });
    const rows = card.getByRole("region", { name: "DAF" }).getByRole("row");
    await expect(rows).toHaveCount(2);
    await noAxeViolations(page);
    const sublist = sidebar(page).getByRole("list", { name: fr.sidebar.jobDigests });
    await expect(sublist.getByRole("link")).toHaveText([/^DAF · /, tr(texts.seeAll, { count: 1 })]);

    await send(page, "Lesquelles regarder ?");
    await expect.poll(() => menuConversationsOf(email)).toEqual([{ subject: "menu:jobDigests", messages: 2 }]);

    await rows.nth(1).getByRole("link").click();
    await expect(page).toHaveURL(`${server.origin}/job-digests/${digest!.id}`);
  });

  test("the Agenda is its conversation: its list a card; the week and the month open in the Work Pane, as does « Ajouter un entretien »", async ({ browser }) => {
    const email = newAddress("conversation-agenda");
    const page = await signedIn(browser, email);
    await saveApplication(page, await createProfile(page), "DAF H/F");

    await page.goto("/agenda");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.agenda.title);
    await expect(messages(page).first()).toContainText(fr.agendaMenu.introduction);
    await expect(conversation(page).getByRole("heading", { name: fr.agenda.upcomingTitle })).toBeVisible();
    await expect(conversation(page).getByText(fr.agenda.none.split(".")[0]!)).toBeVisible();
    await noAxeViolations(page);

    // The week opens beside the conversation, at its own address; closing it goes back to the list's.
    await conversation(page).getByRole("link", { name: fr.agenda.weekView, exact: true }).click();
    await expect(page).toHaveURL(/\/agenda\?vue=semaine/);
    await expect(workPane(page).getByRole("heading", { level: 2, name: new RegExp(`^${tr(fr.agenda.weekTitle, { range: "" })}`) })).toBeVisible();
    await expect(conversation(page)).toBeVisible();
    // The list on the card and the week in the pane each have their own name: no id given twice.
    await expect(page.getByRole("region", { name: new RegExp(`^${tr(fr.agenda.weekTitle, { range: "" })}`) })).toBeVisible();
    await noAxeViolations(page, { withPane: true });
    await workPane(page).getByRole("button", { name: texts.close, exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/agenda`);
    await expect(workPane(page)).toHaveCount(0);

    // The month too.
    await conversation(page).getByRole("link", { name: fr.agenda.monthView, exact: true }).click();
    await expect(page).toHaveURL(/\/agenda\?vue=mois/);
    await expect(workPane(page).getByRole("table")).toBeVisible();
    await noAxeViolations(page, { withPane: true });
    await workPane(page).getByRole("button", { name: texts.close, exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/agenda`);

    // « Ajouter un entretien » opens its form in the Work Pane; once added, the pane closes and the list shows it.
    await suggestions(page).getByRole("link", { name: fr.agendaMenu.addInterview }).click();
    await expect(page).toHaveURL(`${server.origin}/agenda?ajouter=entretien`);
    const form = workPane(page);
    await expect(form.getByRole("heading", { level: 2, name: fr.agenda.addDialog.title })).toBeVisible();
    await form.getByLabel(fr.agenda.addDialog.application).selectOption({ label: `DAF H/F · Acme Industrie · ${fr.applicationStatuses.to_apply}` });
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await form.getByLabel(fr.application.interviewDate).fill(`${nextWeek}T10:00`);
    await form.getByRole("button", { name: fr.agenda.addDialog.submit }).click();
    await expect(page).toHaveURL(`${server.origin}/agenda`);
    await expect(workPane(page)).toHaveCount(0);
    await expect(conversation(page).locator(".agenda-item-link").filter({ hasText: "DAF H/F" })).toBeVisible();

    await send(page, "Comment préparer cet entretien ?");
    await expect.poll(() => menuConversationsOf(email)).toEqual([{ subject: "menu:agenda", messages: 2 }]);
  });

  test("Mes coachs humains is its conversation: the Coaching Sessions and the Human Coaches are cards in the thread", async ({ browser }) => {
    const email = newAddress("conversation-human-coaches");
    const page = await signedIn(browser, email);

    await page.goto("/coachs");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fr.humanCoaches.title);
    await expect(messages(page).first()).toContainText(fr.humanCoachesMenu.introduction);
    await expect(conversation(page).getByRole("region", { name: fr.humanCoaches.sessionsTitle })).toContainText(fr.humanCoachesMenu.sessionsNone);
    await expect(conversation(page).getByRole("region", { name: fr.humanCoaches.listTitle })).toBeVisible();
    await noAxeViolations(page);

    await send(page, "Comment préparer une séance ?");
    await expect.poll(() => menuConversationsOf(email)).toEqual([{ subject: "menu:humanCoaches", messages: 2 }]);
  });

  test("Mes coachs humains: booking stays as it is, from the Human Coach's card to the Order page", async ({ browser }) => {
    const email = newAddress("conversation-human-coaches-booking");
    const page = await signedIn(browser, email);
    const name = `Sophie Martin ${Date.now()}`;
    await query("INSERT INTO human_coach (name, email, booking_url, bio) VALUES ($1, $2, $3, $4)", [name, newAddress("coach"), `https://cal.com/sophie-${Date.now()}/seance`, "Ancienne DRH."]);

    await page.goto("/coachs");
    const card = conversation(page).getByRole("region", { name: fr.humanCoaches.listTitle });
    await expect(card).toContainText(name);
    await Promise.all([page.waitForURL(/\/commande\?/), card.getByRole("button", { name: tr(fr.humanCoaches.book, { name }) }).click()]);
  });

  test("the Help Articles of /recherches, /job-digests, /agenda and /coachs exist in French and English, and the Release Note fragment announces them", async () => {
    const pages = { "page-job-searches": "/recherches", "page-job-digests": "/job-digests", "page-agenda": "/agenda", "page-human-coaches": "/coachs" };
    for (const locale of ["fr", "en"] as const) {
      for (const [name, route] of Object.entries(pages)) {
        const article = readFileSync(`packages/help/articles/${locale}/${name}.md`, "utf8");
        expect(article, `${locale}/${name}`).toMatch(/^kind: page$/m);
        expect(article, `${locale}/${name}`).toContain(`route: ${route}`);
        expect(article, `${locale}/${name}`).toMatch(locale === "fr" ? /conversation avec votre coach IA/ : /conversation with your AI coach/);
      }
    }
    const fragment = readFileSync("packages/help/releases/unreleased/627.md", "utf8");
    expect(fragment).toMatch(/#606/);
    expect(fragment).toMatch(/## fr[\s\S]*Recherches d'offres[\s\S]*## en[\s\S]*Job searches/);
  });
});

import path from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Pool } from "pg";
import { migrateCoachPages } from "../../apps/web/src/coach-pages";
import { coachingOffers } from "../../apps/web/src/coaching-offers";
import { startOwnServer, signInByEmail, type OwnServer } from "../support/own-server";
import { comparesScreenshots, leaveOutRelease, SCREENSHOT_WIDTHS } from "../support/screenshots";
import { expectTextContrast, showInTheme, themedName, THEMES } from "../support/theme";

// The Human Coach epic's screens (#867, ADR-0107) checked against the Design System: the Coach space, the Candidate's
// « Mes coachs humains » and « Devenir coach », and the Association space, with « Espace coach v2 » on (the coach-v2
// project; this spec's own server has it on through env, e2e/support/own-server.ts). Each screen is shot light and dark
// at the desktop width, and light at the phone width, where dark is checked by axe and the contrast audit without a
// baseline of its own (about 30 images in all, as the product owner asked). Aujourd'hui, a session and Revenus are also
// shot in the Compact Density and at the largest Text Size (Grand), at the desktop width. Axe runs on every one.
// Only the page (`#main`) is compared: the shells have baselines of their own (shell-screenshots.spec.ts).
// Every name, date and amount is a fixture; the one session dated relative to today (tomorrow at 10:00, so it sits in
// « Demain » and before its window) has its day written as one fixed day before each shot (a mask hides a text, not its
// width). How to update a baseline on purpose: docs/agents/screenshot-baselines.md.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const OFFSET = 891;
const PARIS = "Europe/Paris";
const COACH = "sophie.martin@e2e.jobbbox.test";
const CANDIDATE = "marie.dupont@e2e.jobbbox.test";
const MANAGER = "paul.lefevre@e2e.jobbbox.test";
const COACH_NAME = "Sophie Martin";
/** The fixed day the relative session's day is written as before a shot. */
const FIXED_DAY = "jeudi 14 mars 2030";
const DESKTOP = SCREENSHOT_WIDTHS.find((width) => width.name === "desktop")!;
const PHONE = SCREENSHOT_WIDTHS.find((width) => width.name === "phone")!;

const masterCv = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: CANDIDATE,
  phone: "",
  location: "Lyon",
  summary: "Directrice financière, quinze ans en groupes industriels.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};

type Who = "coach" | "candidate" | "manager";
type Screen = {
  name: string;
  who: Who;
  path: () => string;
  /** Drawn: what shows the page has its data. */
  ready: (page: Page) => Locator;
  /** Also shot in the Compact Density and at the largest Text Size, at the desktop width. */
  variants?: true;
};

let own: OwnServer;
let database: Pool;
const contexts = {} as Record<Who, BrowserContext>;
const ids = { candidate: "", session: "", held: "" };
/** The relative session's day as the pages write it (« vendredi 13 novembre 2026 »). */
let sessionDay = "";

const title = (name: string) => (page: Page) => page.getByRole("heading", { level: 1, name, exact: true });
const SCREENS: Screen[] = [
  { name: "aujourdhui", who: "coach", path: () => "/espace-coach/aujourdhui", ready: (page) => page.getByRole("heading", { name: fr.coachWorkspace.tomorrow }), variants: true },
  { name: "candidates", who: "coach", path: () => "/espace-coach/candidates", ready: (page) => page.locator("#main").getByRole("link", { name: "Marie Dupont" }) },
  { name: "candidate", who: "coach", path: () => `/espace-coach/candidates/${ids.candidate}`, ready: (page) => page.getByRole("heading", { name: fr.coachSpace.profilesTitle }) },
  {
    name: "seance-avant",
    who: "coach",
    path: () => `/espace-coach/seances/${ids.session}`,
    ready: (page) => page.getByText(fr.coachWorkspace.phase.before, { exact: true }),
    variants: true,
  },
  { name: "revenus", who: "coach", path: () => "/espace-coach/revenus?mois=2026-06&fiscalYear=2026", ready: (page) => page.getByRole("article", { name: COACH_NAME }), variants: true },
  { name: "profil", who: "coach", path: () => "/espace-coach/profil", ready: (page) => page.getByRole("heading", { name: fr.coachPage.visible }) },
  { name: "contrat", who: "coach", path: () => "/espace-coach/contrat", ready: (page) => page.getByRole("heading", { name: fr.coachContract.history }) },
  { name: "coachs", who: "candidate", path: () => "/coachs", ready: (page) => page.getByRole("heading", { name: COACH_NAME, level: 3 }) },
  { name: "devenir-coach", who: "candidate", path: () => "/devenir-coach", ready: title(fr.coachEnrolment.title) },
  { name: "association", who: "manager", path: () => "/espace-association", ready: (page) => page.getByRole("heading", { name: "Luc Bernard" }) },
];

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

async function expectNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).include("#main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(
    results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map((node) => node.target.join(" ")) })),
    label,
  ).toEqual([]);
}

/** Opens `screen` and waits for its data; nothing runs off the side. */
async function open(page: Page, screen: Screen, width: number, label: string) {
  await page.goto(screen.path());
  await expect(screen.ready(page)).toBeVisible({ timeout: 20_000 });
  // Drawn with the Design System's components (ADR-0053).
  await expect(page.locator("#main :is(.ds-card, .ds-button, .ds-field, .ds-site__title)").first()).toBeAttached();
  await settled(page);
  // Named when it fails: the innermost elements that reach past the window's right edge.
  const past = await page.evaluate(() =>
    [...document.querySelectorAll("#main *")]
      .filter((element) => element.getBoundingClientRect().right > innerWidth + 1 && ![...element.children].some((child) => child.getBoundingClientRect().right > innerWidth + 1))
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join(".")} (${Math.round(element.getBoundingClientRect().right)}px)`),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${label}: the page's width (past the edge: ${past.join(", ")})`).toBeLessThanOrEqual(width);
}

/** The page whole, its relative day written as the fixed one, compared with its baseline `name`. */
async function shoot(page: Page, width: number, name: string) {
  await page.evaluate(
    ([from, to]) => {
      const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let text = texts.nextNode(); text; text = texts.nextNode()) {
        if (text.textContent?.includes(from!)) text.textContent = text.textContent.replaceAll(from!, to!);
      }
    },
    [sessionDay, FIXED_DAY],
  );
  await leaveOutRelease(page);
  // As tall as the page, plus what a conversation's thread (Mes coachs humains) holds below its own scroll.
  const height = await page.evaluate(
    () =>
      document.documentElement.scrollHeight +
      Math.max(0, ...[...document.querySelectorAll("#main, #main *")].filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY)).map((element) => element.scrollHeight - element.clientHeight)),
  );
  await page.setViewportSize({ width, height });
  await settled(page);
  await expect.soft(page.locator("#main")).toHaveScreenshot(`${name}.png`);
}

async function signedIn(browser: Browser, who: Who, email: string) {
  const context = await browser.newContext({ baseURL: own.origin, locale: "fr-FR", colorScheme: "light", timezoneId: PARIS });
  const page = await context.newPage();
  await signInByEmail(page, own, email);
  await page.close();
  contexts[who] = context;
  return context;
}

const candidateId = async (email: string) => (await database.query<{ id: string }>("SELECT id FROM candidate WHERE email=$1", [email])).rows[0]!.id;

/**
 * Sophie Martin, a Human Coach selling her own 60-minute offer, her public page approved; Marie Dupont (« Mimi »), who
 * gave her Coach Access, with a Profile, an Application, a session tomorrow at 10:00 with a Meet link and one held in
 * June 2026, paid; and Paul Lefèvre, who manages the association « Transitions Solidaires », its one coach Luc Bernard.
 * Both contracts accepted on 5 January 2026.
 */
async function seed(browser: Browser) {
  // Human Coaches before their sign-in: Two-step verification is set up as they sign in.
  const coachId = (
    await database.query<{ id: string }>(
      "INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES($1,$2,'https://cal.com/sophie-martin/seance',$3,true) RETURNING id",
      [COACH_NAME, COACH, "Ancienne DRH dans l'industrie, j'accompagne les cadres financiers dans leur transition."],
    )
  ).rows[0]!.id;
  const lucId = (
    await database.query<{ id: string }>(
      "INSERT INTO human_coach(name,email,booking_url,bio) VALUES('Luc Bernard','luc.bernard@e2e.jobbbox.test','',$1) RETURNING id",
      ["Coach bénévole, spécialiste des reconversions."],
    )
  ).rows[0]!.id;
  const coach = await signedIn(browser, "coach", COACH);
  const candidate = await signedIn(browser, "candidate", CANDIDATE);
  await signedIn(browser, "manager", MANAGER);
  ids.candidate = await candidateId(CANDIDATE);
  const managerId = await candidateId(MANAGER);
  const sophieAccount = await candidateId(COACH);

  // The public page, approved, with its specialties and languages.
  await migrateCoachPages(database);
  await database.query(`UPDATE coach_page_version SET content=content || $2::jsonb WHERE coach_id=$1`, [
    coachId,
    JSON.stringify({ specialties: ["Finance", "Transition de carrière"], languages: ["Français", "Anglais"] }),
  ]);

  // The association and its coach.
  const associationId = (
    await database.query<{ id: string }>("INSERT INTO coach_association(name,legal_status,siret) VALUES('Transitions Solidaires','Association loi 1901','11111111111111') RETURNING id")
  ).rows[0]!.id;
  await database.query("INSERT INTO coach_association_manager VALUES($1,$2)", [associationId, managerId]);
  await database.query("INSERT INTO coach_association_coach(association_id,coach_id,joined_at) VALUES($1,$2,'2026-01-05T09:00:00Z')", [associationId, lucId]);

  // The coach contract, accepted on a fixed day by Sophie for herself and by Paul for the association.
  for (const [account, kind, subject] of [
    [sophieAccount, "coach", coachId],
    [managerId, "association", associationId],
  ]) {
    await database.query(
      `INSERT INTO coach_contract_acceptance(candidate_id,holder,kind,subject_id,version,url,sha256,origin,accepted_at)
       VALUES($1,'e2e-fixture',$2,$3,'2026-01-01','/espace-coach/contrat/versions/2026-01-01',$4,'web','2026-01-05T09:00:00Z')`,
      [account, kind, subject, "e".repeat(64)],
    );
  }

  // Marie, named, with a Profile and an Application.
  const page = await candidate.newPage();
  const headers = { origin: own.origin };
  const named = await page.request.put("/api/account/identity", { data: { givenName: "Marie", familyName: "Dupont", preferredName: "Mimi" }, headers });
  expect(named.ok(), await named.text()).toBe(true);
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers });
  expect(profile.status(), await profile.text()).toBe(201);
  const offer = await page.request.post("/api/job-offers", {
    data: { source: { url: "https://www.apec.fr/offres/coach-space-v2-screenshots" }, title: "DAF (H/F)", content: "Acme Industrie recrute son DAF.", employer: "Acme Industrie" },
    headers,
  });
  expect(offer.status(), await offer.text()).toBe(200);
  const saved = await page.request.post("/api/applications", { data: { jobOfferId: (await offer.json()).id, profileId: (await profile.json()).id }, headers });
  expect(saved.ok(), await saved.text()).toBe(true);

  // Sophie sells her own offer: 90 €, 60 minutes.
  const offers = coachingOffers(database, { price: async () => ({ amount: 9000, currency: "eur" }), eligibleSeller: async () => true });
  const seller = (await offers.saveSeller({ kind: "human_coach", coachId, name: "Sophie Martin Conseil", status: "EI", siret: "12345678901234", commissionBps: 2000 }))!;
  expect(await offers.saveOffer({ coachId, sellerId: seller.id, durationMinutes: 60, amount: 9000 })).toBe(true);

  // The session tomorrow at 10:00 in Paris, paid on a fixed day, with a Meet link.
  const quote = (await offers.quote(ids.candidate, coachId))!;
  const checkoutSessionId = `cs_screens_${randomUUID()}`;
  await database.query("INSERT INTO coaching_session(stripe_checkout_session_id,candidate_id,coach_id,coaching_quote_id,amount,currency) VALUES($1,$2,$3,$4,9000,'eur')", [
    checkoutSessionId,
    ids.candidate,
    coachId,
    quote.id,
  ]);
  await offers.attachPaid({ candidateId: ids.candidate, coachId, quoteId: quote.id, checkoutSessionId, amount: 9000, currency: "eur" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: PARIS, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dated = (
    await database.query<{ id: string; scheduled_at: Date }>(
      `UPDATE coaching_session SET scheduled_at=(($2::date + 1) + time '10:00') AT TIME ZONE 'Europe/Paris',duration_minutes=60,paid_at='2026-11-02T09:00:00Z',
       video_link='https://meet.google.com/abc-defg-hij' WHERE stripe_checkout_session_id=$1 RETURNING id,scheduled_at`,
      [checkoutSessionId, today],
    )
  ).rows[0]!;
  ids.session = dated.id;
  sessionDay = new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(dated.scheduled_at);

  // A session held on 4 June 2026, paid on 1 June: Revenus' month.
  const snapshot = (await offers.quote(ids.candidate, coachId))!.sale;
  const payment = randomUUID();
  await database.query(
    `INSERT INTO coaching_connect_payment(id,candidate_id,coach_id,recipient_id,amount,currency,commission,payee_amount,request,sale_snapshot,payee_snapshot,created_at,paid_at,checkout_id)
     VALUES($1,$2,$3,$4,9000,'eur',1800,7200,'{}',$5,$6,'2026-06-01','2026-06-01',$7)`,
    [payment, ids.candidate, coachId, seller.id, { ...snapshot, seller }, seller, `cs_${payment}`],
  );
  await database.query("INSERT INTO coaching_connect_earning(payment_id,amount,commission,available) VALUES($1,9000,1800,true)", [payment]);
  ids.held = (
    await database.query<{ id: string }>(
      "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency,paid_at,scheduled_at,duration_minutes) VALUES($1,$2,$3,9000,'eur','2026-06-01T08:00:00Z','2026-06-04T08:00:00Z',60) RETURNING id",
      [ids.candidate, coachId, `cs_${payment}`],
    )
  ).rows[0]!.id;

  // Marie gives Sophie Coach Access; Sophie writes a private note.
  await page.goto("/coachs");
  await page.getByRole("button", { name: tr(fr.humanCoaches.grant, { name: COACH_NAME }) }).click();
  await expect(page.getByText(tr(fr.humanCoaches.accessGranted, { name: COACH_NAME }))).toBeVisible();
  await page.close();
  const coachPage = await coach.newPage();
  await coachPage.goto(`/espace-coach/candidates/${ids.candidate}`);
  await coachPage.getByLabel(fr.coachWorkspace.notes).fill("Préparer l'entretien chez Acme Industrie : chiffres clés de la clôture.");
  await expect(coachPage.getByText(fr.coachWorkspace.noteStatus.saved)).toBeVisible();
  await coachPage.close();
}

test.describe("Espace coach v2 in the Design System (#867)", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    own = await startOwnServer(OFFSET, "coach_space_v2_screens", {
      JOBHUB_TARGET: "e2e",
      JOBHUB_IGNORE_ROOT_ENV: "1",
      AUTH_SECRET: "e2e-screens-only-secret-e2e-screens-only-secret",
      MAIL_TRANSPORT: "console",
      CAL_COM_REMINDERS_DISABLED: "true",
      SECRETS_MASTER_KEYS: "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=",
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
      NODE_OPTIONS: ["fake-coach-contract.mjs", "fake-coaching-legal.mjs", "fake-coaching-notification-legal.mjs", "fake-google.mjs", "fake-mistral.mjs", "fake-reference-data.mjs"]
        .map((fake) => `--import=${path.resolve("e2e/support", fake)}`)
        .join(" "),
    });
    database = new Pool({ connectionString: own.databaseUrl });
    await seed(browser);
  });
  test.afterAll(async () => {
    for (const context of Object.values(contexts)) await context.close();
    await database?.end();
    await own?.stop();
  });

  // #1018: the session's line names the Seller frozen with its sale, here Sophie's own business, not Jobbbox.
  test("a session's page names the Seller of its sale (#1018)", async () => {
    const page = await contexts.coach.newPage();
    await page.goto(`/espace-coach/seances/${ids.session}`);
    await expect(page.getByText(tr(fr.coachingOffers.soldBy, { name: "Sophie Martin Conseil" }), { exact: true })).toBeVisible();
    await expect(page.getByText(fr.coachWorkspace.soldByJobbbox, { exact: true })).toHaveCount(0);
    await page.close();
  });

  // #1019: the session held in June stays listed with its date, without « Modifier la date » or « Annuler la séance »;
  // the one tomorrow keeps both. The routes refuse the held one too, as « trop tard » (#883).
  test("a session that has ended is neither moved nor cancelled, on the page or through the routes (#1019)", async () => {
    const page = await contexts.candidate.newPage();
    await page.goto("/coachs");
    const held = page.locator(`#seance-${ids.held}`);
    const next = page.locator(`#seance-${ids.session}`);
    await expect(held.getByText(/4 juin 2026/)).toBeVisible();
    await expect(held.getByRole("button", { name: new RegExp(fr.coachingSession.edit) })).toHaveCount(0);
    await expect(held.getByRole("button", { name: tr(fr.agendaChanges.cancelSessionFor, { name: COACH_NAME }) })).toHaveCount(0);
    await expect(next.getByRole("button", { name: new RegExp(fr.coachingSession.edit) })).toBeVisible();
    await expect(next.getByRole("button", { name: tr(fr.agendaChanges.cancelSessionFor, { name: COACH_NAME }) })).toBeVisible();
    const headers = { origin: own.origin };
    const moved = await page.request.patch(`/api/coaching/sessions/${ids.held}`, { data: { scheduledAt: "2030-03-20T10:00" }, headers });
    expect([moved.status(), await moved.json()]).toEqual([409, { error: "too_late" }]);
    const cancelled = await page.request.post(`/api/coaching/sessions/${ids.held}/cancel`, { data: {}, headers });
    expect([cancelled.status(), await cancelled.json()]).toEqual([409, { error: "too_late" }]);
    expect((await database.query("SELECT scheduled_at FROM coaching_session WHERE id=$1", [ids.held])).rows[0].scheduled_at).toEqual(new Date("2026-06-04T08:00:00Z"));
    await page.close();
  });

  // #1020: a form's fields as wide as the form, and the form as wide as what holds it, at every width and Text Size, so
  // no field is left at its label's width; at the desktop width the whole Meet link and the whole e-mail then show.
  // (An input's scrollWidth equals its clientWidth however long its value is, so the text is measured in the page's font.)
  const measure = (field: Locator) =>
    field.evaluate((input: HTMLInputElement) => {
      const style = getComputedStyle(input);
      const ruler = document.createElement("span");
      ruler.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing}`;
      ruler.textContent = input.value;
      document.body.append(ruler);
      const text = ruler.getBoundingClientRect().width;
      ruler.remove();
      const form = input.closest("form")!;
      const holder = form.parentElement!;
      const holderStyle = getComputedStyle(holder);
      return {
        field: input.closest(".ds-field")!.getBoundingClientRect().width,
        form: form.getBoundingClientRect().width,
        holder: holder.clientWidth - parseFloat(holderStyle.paddingLeft) - parseFloat(holderStyle.paddingRight),
        text,
        room: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
    });

  test("form fields take their form's width, and the whole Meet link and e-mail show on a desktop (#1020)", async () => {
    for (const textSize of [null, "xlarge"]) {
      for (const { name, width, height } of [DESKTOP, PHONE]) {
        const coach = await contexts.coach.newPage();
        const candidate = await contexts.candidate.newPage();
        for (const page of [coach, candidate]) {
          await page.setViewportSize({ width, height });
          if (textSize) await page.addInitScript((size) => localStorage.setItem("jobbbox.textSize", size), textSize);
        }
        const label = `at ${width}px, text size ${textSize ?? "default"}`;
        await coach.goto(`/espace-coach/seances/${ids.session}`);
        const link = coach.getByLabel(fr.coachMeeting.target);
        await expect(link).toHaveValue("https://meet.google.com/abc-defg-hij");
        const meeting = await measure(link);
        expect(meeting, `the Meet link's field ${label}`).toMatchObject({ field: meeting.form, form: meeting.holder });
        await candidate.goto("/devenir-coach");
        const email = candidate.getByLabel(fr.coachEnrolment.fields.email);
        await expect(email).toHaveValue(CANDIDATE);
        const enrolment = await measure(email);
        expect(enrolment, `the e-mail's field ${label}`).toMatchObject({ field: enrolment.form, form: enrolment.holder });
        // Every Field of one form is as wide as the next: the SIRET's too.
        expect((await measure(candidate.getByLabel(fr.coachEnrolment.fields.siret))).field, `the SIRET's field ${label}`).toBe(enrolment.field);
        if (name === "desktop") {
          expect(meeting.text, `the whole Meet link ${label}`).toBeLessThanOrEqual(meeting.room);
          expect(enrolment.text, `the whole e-mail ${label}`).toBeLessThanOrEqual(enrolment.room);
        }
        // The Text Size is kept per browser: cleared, so it stays out of the screens shot from these same contexts.
        for (const page of [coach, candidate]) {
          await page.evaluate(() => localStorage.removeItem("jobbbox.textSize"));
          await page.close();
        }
      }
    }
  });

  for (const screen of SCREENS) {
    test(`${screen.name}: light and dark at the desktop and phone widths${screen.variants ? ", Compact and Grand at the desktop width" : ""}, axe passes, matches its baselines`, async () => {
      test.setTimeout(120_000);
      const page = await contexts[screen.who].newPage();
      for (const { name, width, height } of [DESKTOP, PHONE]) {
        await page.setViewportSize({ width, height });
        await open(page, screen, width, `${screen.name}-${name}`);
        for (const theme of THEMES) {
          await showInTheme(page, theme);
          await settled(page);
          await expectNoAxeViolations(page, `${screen.name}-${name} in ${theme}`);
          if (theme === "dark") await expectTextContrast(page, `${screen.name}-${name}`);
          // The phone width's dark is checked above; its baseline would add little to light's and desktop's dark.
          if (comparesScreenshots() && !(name === "phone" && theme === "dark")) await shoot(page, width, themedName(`${screen.name}-${name}`, theme));
        }
        await showInTheme(page, "light");
      }
      if (screen.variants) {
        // The Compact Density, as the Back Office and the Design System page set it: on the page's Density scope.
        await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
        await open(page, screen, DESKTOP.width, `${screen.name}-compact`);
        await page.locator(".coach-space-v2").evaluate((scope) => scope.setAttribute("data-density", "compact"));
        await settled(page);
        await expectNoAxeViolations(page, `${screen.name}-compact`);
        if (comparesScreenshots()) await shoot(page, DESKTOP.width, `${screen.name}-compact-desktop`);
        // The largest Text Size, Grand, as Préférences keeps it on the device (TextSizeControl).
        await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
        await page.evaluate(() => localStorage.setItem("jobbbox.textSize", "xlarge"));
        await open(page, screen, DESKTOP.width, `${screen.name}-grand`);
        await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
        await expectNoAxeViolations(page, `${screen.name}-grand`);
        if (comparesScreenshots()) await shoot(page, DESKTOP.width, `${screen.name}-grand-desktop`);
        await page.evaluate(() => localStorage.removeItem("jobbbox.textSize"));
      }
      await page.close();
    });
  }
});

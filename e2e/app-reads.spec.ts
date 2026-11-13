import { approvedLegacyCoach } from "./support/legacy-coach";
import {
  API_CLIENT_HEADER,
  API_VERSION,
  API_VERSION_HEADER,
  APP_OUTDATED,
  MOBILE_CLIENT,
  SECOND_STEP_REQUIRED,
} from "@jobhub/shared";
import {
  agendaResponseSchema,
  applicationResponseSchema,
  applicationsResponseSchema,
  coachConversationResponseSchema,
  coachConversationsResponseSchema,
  coachingResponseSchema,
  jobDigestResponseSchema,
  jobDigestsResponseSchema,
  jobSearchResponseSchema,
  jobSearchesResponseSchema,
  offerBoxOfferResponseSchema,
  offerBoxResponseSchema,
  profileResponseSchema,
  profilesResponseSchema,
  tailoredDocumentsResponseSchema,
} from "@jobhub/shared/reads";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import pg from "pg";
import type { ZodType } from "zod";
import { fromNewAddress, requestSignInLink, signInWithMagicLink } from "./support/candidate";
import { emailsTo, linkIn, newAddress } from "./support/mailbox";
import { subscribe } from "./support/plan";
import { forgetTwoStepVerification, twoStepSetup } from "./support/two-step";

// Issue #684 (ADR-0076): the Jobbbox app reads the Candidate's data over HTTP, the way the pages do: GET routes on the
// same server modules, typed in @jobhub/shared/reads. Driven through the public entry point, HTTP, as the app calls it:
// the session cookie, API_CLIENT_HEADER "mobile" and the API Version. Each answer is parsed with the shared type's own
// schema (the contract test), and a Candidate reads only their own data.
const origin = process.env.E2E_WEB_ORIGIN!;
// In ADMIN_EMAILS (playwright.config.ts): an account whose Two-step verification is mandatory (#665), so a magic link
// leaves it pending its second step with nothing set up.
const PENDING_ACCOUNT = "app-reads-office@e2e.jobbbox.test";
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** What the Jobbbox app sends on every call (a native fetch sends no Origin). */
const APP = { [API_CLIENT_HEADER]: MOBILE_CLIENT, [API_VERSION_HEADER]: String(API_VERSION) };

const masterCv = (headline: string) => ({
  fullName: "Marie Dupont",
  headline,
  email: "",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: headline, employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "" }],
  education: [],
  skills: ["IFRS"],
  languages: [],
});

const get = (page: Page, path: string, headers: Record<string, string> = APP) => page.request.get(path, { headers });

/** The answer's body, which must be a 200 in the shape of its shared type: the schema's parse is the contract test. */
async function read<T>(response: APIResponse, schema: ZodType<T>): Promise<T> {
  expect(response.status(), await response.text()).toBe(200);
  const parsed = schema.safeParse(await response.json());
  expect(parsed.success ? "conform" : JSON.stringify(parsed.error.issues)).toBe("conform");
  return parsed.data!;
}

async function createProfile(page: Page, targetRole: string): Promise<string> {
  const created = await page.request.post("/api/profiles", {
    headers: { origin },
    data: { masterCv: masterCv(targetRole), searchCriteria: { targetRole, locations: ["Lyon"], minSalary: 90_000, contractTypes: ["cdi"] } },
  });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

async function captureOffer(page: Page, title: string): Promise<string> {
  const captured = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: {
      source: { url: `https://www.apec.fr/offres/${unique()}` },
      title,
      content: `Acme Industrie recrute. Vos missions : piloter la clôture. (${unique()})`,
      employer: "Acme Industrie",
      location: "Lyon",
      contractType: "cdi",
      skills: ["IFRS", "SAP"],
    },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  return (await captured.json()).id;
}

async function saveApplication(page: Page, jobOfferId: string, profileId: string): Promise<string> {
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id;
}

async function candidateId(page: Page): Promise<string> {
  return (await (await page.request.get("/api/auth/get-session")).json()).user.id;
}

/** What the worker and Stripe's webhook leave behind, which no public endpoint stores without them: SQL on the suite's database. */
async function withDatabase<T>(run: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

interface Seed {
  profileId: string;
  archivedProfileId: string;
  offerId: string;
  keptOfferId: string;
  applicationId: string;
  searchId: string;
  digestId: string;
  coachName: string;
  scheduledSessionId: string;
  freeConversationId: string;
  applicationConversationId: string;
}

/** A Candidate on Standard with two Profiles (one archived), an Application at « Entretien » with an Interview, and what hangs from them. */
/** A done Job Search carries metrics like the worker's own (job-search-metrics.spec.ts checks every one in the database does). */
const doneSearchMetrics = JSON.stringify({ funnel: { providerUrls: 2, fetched: 2, extracted: 2, alreadyStored: 0, afterDedup: 2, matched: 2 }, skipped: {}, costEur: 0, durationMs: 60_000 });

async function seedCandidate(page: Page, email: string): Promise<Seed> {
  await subscribe(page, email, "standard");
  const profileId = await createProfile(page, "Directrice financière");
  const archivedProfileId = await createProfile(page, "Consultante archivée");
  const offerId = await captureOffer(page, `DAF Lyon ${unique()}`);
  const keptOfferId = await captureOffer(page, `Contrôleur de gestion ${unique()}`);
  const applicationId = await saveApplication(page, keptOfferId, profileId);

  const moved = await page.request.patch(`/api/applications/${applicationId}`, { headers: { origin }, data: { status: "interview" } });
  expect(moved.ok(), await moved.text()).toBe(true);
  const interview = await page.request.post(`/api/applications/${applicationId}/interviews`, {
    headers: { origin },
    data: { scheduledAt: "2031-03-12T14:30", durationMinutes: 45, format: "video", note: "Avec la DRH" },
  });
  expect(interview.ok(), await interview.text()).toBe(true);

  const drafted = await page.request.post(`/api/applications/${applicationId}/tailored-documents`, { headers: { origin }, data: { document: "cover_letter", language: "fr" } });
  expect(drafted.ok(), await drafted.text()).toBe(true);

  const candidate = await candidateId(page);
  const coachName = `Sophie Martin ${unique()}`;
  const stored = await withDatabase(async (db) => {
    const search = await db.query(
      "INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, metrics) VALUES ($1, $2, 'done', $3, now(), now(), $4) RETURNING id",
      [candidate, profileId, [offerId, keptOfferId], doneSearchMetrics],
    );
    const digest = await db.query("INSERT INTO job_digest (candidate_id, profile_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, now()) RETURNING id", [candidate, profileId, [offerId]]);
    // What the Job Search's report records (ADR-0090): its Job Offers in the Offer box, here seeded as it would leave them.
    await db.query(
      `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources)
       SELECT $1, id, $2, now(), jsonb_build_object('job_search', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM job_offer WHERE id = ANY ($3::uuid[])`,
      [candidate, profileId, [offerId, keptOfferId]],
    );
    const coach = await db.query("INSERT INTO human_coach (name, email, booking_url, bio) VALUES ($1, $2, $3, 'Ancienne DRH.') RETURNING id", [
      coachName,
      `${unique()}@coachs.e2e.jobbbox.test`,
      `https://cal.com/${unique()}/seance`,
    ]);
    await approvedLegacyCoach(coach.rows[0].id);
    await db.query("INSERT INTO coach_access (candidate_id, coach_id) VALUES ($1, $2)", [candidate, coach.rows[0].id]);
    await db.query("INSERT INTO coaching_session (stripe_checkout_session_id, candidate_id, coach_id, amount, currency) VALUES ($1, $2, $3, 9000, 'eur')", [`cs_${unique()}`, candidate, coach.rows[0].id]);
    const scheduled = await db.query(
      "INSERT INTO coaching_session (stripe_checkout_session_id, candidate_id, coach_id, amount, currency, scheduled_at, duration_minutes, video_link, changed_by) VALUES ($1, $2, $3, 9000, 'eur', '2031-03-10T09:00:00Z', 60, 'https://meet.example/abc', 'candidate') RETURNING id",
      [`cs_${unique()}`, candidate, coach.rows[0].id],
    );
    return { searchId: search.rows[0].id, digestId: digest.rows[0].id, scheduledSessionId: scheduled.rows[0].id };
  });

  const applicationTalk = await page.request.post("/api/coach", { headers: { origin }, data: { subject: { kind: "application", id: applicationId }, message: "Comment préparer cet entretien ?" } });
  expect(applicationTalk.status(), await applicationTalk.text()).toBe(200);
  const freeTalk = await page.request.post("/api/coach", { headers: { origin }, data: { message: "Par où commencer ma recherche ?" } });
  expect(freeTalk.status(), await freeTalk.text()).toBe(200);

  // The archived Profile has its own Job Search and Job Digest, which the cards leave out.
  await withDatabase(async (db) => {
    await db.query("INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at, metrics) VALUES ($1, $2, 'done', $3, now(), now(), $4)", [
      candidate,
      archivedProfileId,
      [offerId],
      doneSearchMetrics,
    ]);
    await db.query("INSERT INTO job_digest (candidate_id, profile_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, now())", [candidate, archivedProfileId, [offerId]]);
  });
  const archived = await page.request.patch(`/api/profiles/${archivedProfileId}`, { headers: { origin }, data: { archived: true } });
  expect(archived.ok(), await archived.text()).toBe(true);

  return {
    profileId,
    archivedProfileId,
    offerId,
    keptOfferId,
    applicationId,
    ...stored,
    coachName,
    freeConversationId: (await freeTalk.json()).conversation.id,
    applicationConversationId: (await applicationTalk.json()).conversation.id,
  };
}

/** Every GET the Jobbbox app calls for a Candidate who owns `seed`: the path, and the id-less ones for the unauthenticated tests. */
const readPaths = (seed: Seed) => [
  "/api/applications",
  `/api/applications/${seed.applicationId}`,
  `/api/applications/${seed.applicationId}/documents`,
  "/api/job-searches",
  `/api/job-searches/${seed.searchId}`,
  "/api/offer-box",
  "/api/job-digests",
  `/api/job-digests/${seed.digestId}`,
  "/api/agenda",
  "/api/coaching",
  "/api/profiles",
  `/api/profiles/${seed.profileId}`,
  "/api/coach/conversations",
  `/api/coach/conversations?kind=application&id=${seed.applicationId}`,
  `/api/coach/conversations/${seed.applicationConversationId}`,
];

test.describe("The Jobbbox app reads over HTTP (#684)", () => {
  test("each GET answers in the shape of its shared type, with the Candidate's own data", async ({ page }) => {
    const email = newAddress("app-reads");
    await signInWithMagicLink(page, email);
    const seed = await seedCandidate(page, email);

    // Applications: status, Match Score, à traiter, next deadline; one Application with its Interviews.
    const applications = await read(await get(page, "/api/applications"), applicationsResponseSchema);
    expect(applications.applications).toHaveLength(1);
    expect(applications.applications[0]).toMatchObject({ id: seed.applicationId, status: "interview", archived: false });
    const application = await read(await get(page, `/api/applications/${seed.applicationId}`), applicationResponseSchema);
    expect(application).toMatchObject({ id: seed.applicationId, status: "interview" });
    expect(application.interviews).toHaveLength(1);
    expect(application.interviews[0]).toMatchObject({ durationMinutes: 45, format: "video", note: "Avec la DRH" });

    // Tailored Documents: metadata and download links.
    const documents = await read(await get(page, `/api/applications/${seed.applicationId}/documents`), tailoredDocumentsResponseSchema);
    const letter = documents.documents.find((document) => document.kind === "cover_letter");
    expect(letter, "the drafted Cover Letter is listed").toBeDefined();
    expect(letter!.language).toBe("fr");

    // Job Searches of each active Profile, with their Job Offers: kept or undecided, Match Score.
    const searches = await read(await get(page, "/api/job-searches"), jobSearchesResponseSchema);
    const searched = searches.profiles.find(({ profile }) => profile.id === seed.profileId);
    expect(searched?.searches.map(({ id }) => id)).toEqual([seed.searchId]);
    expect(searched!.searches[0]).toMatchObject({ status: "done", found: 2 });
    const search = await read(await get(page, `/api/job-searches/${seed.searchId}`), jobSearchResponseSchema);
    expect(search.profile.id).toBe(seed.profileId);
    const byOffer = new Map(search.jobOffers.map((found) => [found.jobOffer.id, found]));
    expect(byOffer.get(seed.keptOfferId)).toMatchObject({ decision: "kept", applicationId: seed.applicationId });
    expect(byOffer.get(seed.offerId)).toMatchObject({ decision: null, applicationId: null });

    // The Offer box (ADR-0090): each Job Offer that arrived, « Suivie » once it has its Application.
    const box = await read(await get(page, "/api/offer-box"), offerBoxResponseSchema);
    const entries = new Map(box.entries.map((entry) => [entry.jobOffer.id, entry]));
    expect(entries.get(seed.offerId)).toMatchObject({ state: "to_handle", profile: { id: seed.profileId }, sources: [{ source: "job_search" }] });
    expect(entries.get(seed.keptOfferId)).toMatchObject({ state: "followed", applicationId: seed.applicationId });
    expect(box.toHandle).toBe(1);
    // One entry, as the app's Work Pane opens it (#692): its text and why its Match Score, against its Profile.
    const opened = await read(await get(page, `/api/offer-box/${entries.get(seed.offerId)!.id}`), offerBoxOfferResponseSchema);
    expect(opened).toMatchObject({ profile: { id: seed.profileId }, found: { jobOffer: { id: seed.offerId }, decision: null, applicationId: null } });
    expect(opened.found.jobOffer.content).toEqual(expect.any(String));

    // Job Digests sent, and their frequency.
    const digests = await read(await get(page, "/api/job-digests"), jobDigestsResponseSchema);
    const digested = digests.profiles.find(({ profile }) => profile.id === seed.profileId);
    expect(digested?.digests).toHaveLength(1);
    expect(digested!.digests[0]!.count).toBe(1);
    expect(digested!.frequency).toEqual(expect.any(String));
    const digest = await read(await get(page, `/api/job-digests/${seed.digestId}`), jobDigestResponseSchema);
    expect(digest).toMatchObject({ id: seed.digestId, profile: { id: seed.profileId } });
    expect(digest.jobOffers).toHaveLength(1);

    // Agenda: « À planifier » first, then the Agenda Items by day.
    const agenda = await read(await get(page, "/api/agenda"), agendaResponseSchema);
    expect(agenda.toSchedule).toHaveLength(1);
    expect(agenda.toSchedule[0]!.coach.name).toBe(seed.coachName);
    const kinds = agenda.days.flatMap(({ items }) => items.map(({ kind }) => kind));
    expect(kinds).toEqual(expect.arrayContaining(["interview", "coachingSession"]));
    await read(await get(page, "/api/agenda?periode=passes"), agendaResponseSchema);

    // Human Coaches and Coaching Sessions.
    const coaching = await read(await get(page, "/api/coaching"), coachingResponseSchema);
    expect(coaching.coaches.find(({ name }) => name === seed.coachName)).toMatchObject({ accessGranted: true });
    expect(coaching.sessions).toHaveLength(2);
    expect(coaching.sessions.find(({ id }) => id === seed.scheduledSessionId)).toMatchObject({ durationMinutes: 60, videoLink: "https://meet.example/abc", changedBy: "candidate" });
    expect(JSON.stringify(coaching)).not.toContain("coachs.e2e.jobbbox.test");

    // Profiles: a summary to read.
    const profiles = await read(await get(page, "/api/profiles"), profilesResponseSchema);
    expect(profiles.map(({ id }) => id)).toContain(seed.profileId);
    const profile = await read(await get(page, `/api/profiles/${seed.profileId}`), profileResponseSchema);
    expect(profile.id).toBe(seed.profileId);

    // Coach Conversations: the Free conversations, and the messages of a Subject's.
    const free = await read(await get(page, "/api/coach/conversations?free=1"), coachConversationsResponseSchema);
    expect(free.conversations.map(({ id }) => id)).toEqual([seed.freeConversationId]);
    const all = await read(await get(page, "/api/coach/conversations"), coachConversationsResponseSchema);
    expect(all.conversations.map(({ id }) => id)).toEqual(expect.arrayContaining([seed.freeConversationId, seed.applicationConversationId]));
    const ofSubject = await read(await get(page, `/api/coach/conversations?kind=application&id=${seed.applicationId}`), coachConversationResponseSchema);
    expect(ofSubject.conversation).toMatchObject({ id: seed.applicationConversationId, subject: { kind: "application", id: seed.applicationId } });
    expect(ofSubject.conversation!.messages.map(({ from }) => from)).toEqual(["candidate", "coach"]);
    const one = await read(await get(page, `/api/coach/conversations/${seed.applicationConversationId}`), coachConversationResponseSchema);
    expect(one.conversation!.id).toBe(seed.applicationConversationId);
  });

  test("an Archived Profile is left out of the Job Searches and Job Digests cards, as in the pages, and stays readable as a Profile", async ({ page }) => {
    const email = newAddress("app-reads-archived");
    await signInWithMagicLink(page, email);
    const seed = await seedCandidate(page, email);

    const searches = await read(await get(page, "/api/job-searches"), jobSearchesResponseSchema);
    expect(searches.profiles.map(({ profile }) => profile.id)).toEqual([seed.profileId]);
    const digests = await read(await get(page, "/api/job-digests"), jobDigestsResponseSchema);
    expect(digests.profiles.map(({ profile }) => profile.id)).toEqual([seed.profileId]);

    const archived = await read(await get(page, `/api/profiles/${seed.archivedProfileId}`), profileResponseSchema);
    expect(archived.id).toBe(seed.archivedProfileId);
  });

  test("the app is a client under the contract: 426 app_outdated without a served API Version, on every GET", async ({ page }) => {
    const email = newAddress("app-reads-version");
    await signInWithMagicLink(page, email);
    const seed = await seedCandidate(page, email);

    for (const path of readPaths(seed)) {
      const served = await get(page, path, APP);
      expect(served.status(), path).toBe(200);
      for (const headers of [{ [API_CLIENT_HEADER]: MOBILE_CLIENT }, { [API_CLIENT_HEADER]: MOBILE_CLIENT, [API_VERSION_HEADER]: String(API_VERSION - 1) }]) {
        const refused = await get(page, path, headers);
        expect(refused.status(), path).toBe(426);
        expect(await refused.json()).toMatchObject({ error: APP_OUTDATED, apiVersion: API_VERSION });
        expect(refused.headers()["cache-control"]).toBe("no-store");
      }
    }
    // The web app's own pages call the same routes without any of it.
    for (const path of readPaths(seed)) expect((await get(page, path, {})).status(), path).toBe(200);
  });

  test("no session, no data: every GET answers 401", async ({ page, playwright }) => {
    const email = newAddress("app-reads-anonymous");
    await signInWithMagicLink(page, email);
    const seed = await seedCandidate(page, email);

    const anonymous = await playwright.request.newContext({ baseURL: origin });
    try {
      for (const path of readPaths(seed)) {
        const response = await anonymous.get(path, { headers: APP });
        expect(response.status(), path).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized" });
      }
    } finally {
      await anonymous.dispose();
    }
  });

  test("a Candidate reads nothing of another's: their lists are empty, and another's ids answer 404", async ({ page, browser }) => {
    const owner = newAddress("app-reads-owner");
    await signInWithMagicLink(page, owner);
    const seed = await seedCandidate(page, owner);

    const context = await browser.newContext({ baseURL: origin, locale: "en-US" });
    const other = await context.newPage();
    try {
      await signInWithMagicLink(other, newAddress("app-reads-other"));
      const otherProfileId = await createProfile(other, "Responsable paie");
      const ownerEntry = (await read(await get(page, "/api/offer-box"), offerBoxResponseSchema)).entries[0]!;

      const applications = await read(await get(other, "/api/applications"), applicationsResponseSchema);
      expect(applications.applications).toEqual([]);
      expect((await read(await get(other, "/api/job-searches"), jobSearchesResponseSchema)).profiles.flatMap(({ searches }) => searches)).toEqual([]);
      expect((await read(await get(other, "/api/job-digests"), jobDigestsResponseSchema)).profiles.flatMap(({ digests }) => digests)).toEqual([]);
      expect(await read(await get(other, "/api/offer-box"), offerBoxResponseSchema)).toMatchObject({ toHandle: 0, entries: [] });
      expect(await read(await get(other, "/api/coaching"), coachingResponseSchema)).toMatchObject({ sessions: [] });
      expect(await read(await get(other, "/api/agenda"), agendaResponseSchema)).toMatchObject({ toSchedule: [], days: [] });
      expect((await read(await get(other, "/api/coach/conversations"), coachConversationsResponseSchema)).conversations).toEqual([]);
      expect((await read(await get(other, "/api/profiles"), profilesResponseSchema)).map(({ id }) => id)).toEqual([otherProfileId]);

      for (const path of [
        `/api/applications/${seed.applicationId}`,
        `/api/applications/${seed.applicationId}/documents`,
        `/api/job-searches/${seed.searchId}`,
        `/api/job-digests/${seed.digestId}`,
        `/api/offer-box/${ownerEntry.id}`,
        `/api/profiles/${seed.profileId}`,
        `/api/coach/conversations/${seed.applicationConversationId}`,
      ]) {
        const response = await get(other, path);
        expect(response.status(), path).toBe(404);
        expect(await response.text(), path).not.toContain("Directrice financière");
      }
      const bySubject = await get(other, `/api/coach/conversations?kind=application&id=${seed.applicationId}`);
      expect(bySubject.status()).toBe(404);
    } finally {
      await context.close();
    }
  });

  test("a session pending its second step reads nothing: 401 second_step_required on every GET (ADR-0075)", async ({ page }) => {
    await forgetTwoStepVerification(process.env.E2E_DATABASE_URL, PENDING_ACCOUNT);
    const subject = "Votre lien de connexion à Jobbbox";
    const links = () => emailsTo(PENDING_ACCOUNT).filter((message) => message.subject === subject);
    const already = links().length;
    await fromNewAddress(page);
    await page.goto("/connexion");
    await requestSignInLink(page, PENDING_ACCOUNT);
    await expect.poll(() => links().length).toBeGreaterThan(already);
    await page.goto(linkIn(links()[already]!));
    await expect(twoStepSetup(page)).toBeVisible();

    const seed = { applicationId: "00000000-0000-4000-8000-000000000001", searchId: "00000000-0000-4000-8000-000000000002", profileId: "00000000-0000-4000-8000-000000000003", applicationConversationId: "00000000-0000-4000-8000-000000000004" };
    for (const path of readPaths(seed as Seed)) {
      const refused = await get(page, path);
      expect(refused.status(), path).toBe(401);
      expect(await refused.json(), path).toEqual({ error: SECOND_STEP_REQUIRED });
    }
  });
});

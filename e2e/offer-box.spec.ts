import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { offerBoxResponseSchema } from "@jobhub/shared/reads";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { toConversation } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// Issue #815 (ADR-0090, « Offres à traiter 1 »): the Offer box, one entry per Candidate and Job Offer, filled by each
// Arrival door. The Job Search's, the Job Digest's and Email intake's doors are asserted in their own specs
// (job-search, job-digest, email-intake-reading), the page in conversation-menus, the read over HTTP in app-reads.
// Here: the Job Offer link door (the Coach Panel, a careers site faked inside the server), an Application made anywhere
// making the entry « Suivie », the Data export, the deletion of the account, a Job Offer shared by two Candidates, and the
// deployment's backfill (`npm run db:migrate`) and the nightly purge (the worker's job), on a database of their own.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const SITE = "https://carrieres.coach-links.e2e-jobbbox.fr";
const LINK = `${SITE}/offres/daf-lyon`;
const TITLE = "Directrice administrative et financière H/F";
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.use({ baseURL: origin });

const masterCv = {
  fullName: "Bérénice Castafiore",
  headline: "Directrice financière",
  email: "berenice.castafiore@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Vingt ans à la tête des finances d'un groupe industriel.",
  experience: [{ title: "Directrice financière", employer: "Moulinsart Industries", location: "Lyon", period: "2004 – 2024", description: "Pilotage financier du groupe." }],
  education: [],
  skills: ["Consolidation", "IFRS"],
  languages: [],
};

async function withDatabase<T>(connectionString: string, run: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    return await run(db);
  } finally {
    await db.end();
  }
}

const offerBox = async (page: Page) => offerBoxResponseSchema.parse(await (await page.request.get("/api/offer-box")).json());

async function pasteLink(page: Page) {
  const panel = page.getByRole("region", { name: fr.conversationFirst.label });
  const cards = panel.getByRole("article", { name: fr.coachPanel.jobOfferLink.card });
  const before = await cards.count();
  await panel.getByLabel(fr.coachPanel.messageLabel).fill(`Que pensez-vous de cette offre ? ${LINK}`);
  await panel.getByRole("button", { name: fr.coachPanel.send }).click();
  await expect(cards).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(cards.last()).toContainText("Directrice administrative et financière");
}

async function candidate(browser: Browser, label: string) {
  const page = await (await browser.newContext({ baseURL: origin })).newPage();
  const email = newAddress(label);
  await signInWithMagicLink(page, email);
  const candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Directrice administrative et financière", locations: ["Lyon"], contractTypes: ["cdi"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return { page, email, candidateId, profileId: (await created.json()).id as string };
}

test.describe("The Offer box (#815, ADR-0090)", () => {
  test("a Job Offer link pasted in the Coach Panel is an Arrival; the same link again adds nothing; the Application makes the entry « Suivie »; each Candidate has an entry of their own", async ({ browser }) => {
    const ines = await candidate(browser, "offer-box-link");
    await toConversation(ines.page);
    await pasteLink(ines.page);

    const [entry, ...others] = (await offerBox(ines.page)).entries;
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ state: "to_handle", applicationId: null, sources: [{ source: "job_offer_link" }], jobOffer: { title: TITLE } });
    const first = entry!.firstArrivalAt;

    // The same posting again: the same Job Offer, the same entry, its first Arrival where it was.
    await pasteLink(ines.page);
    const again = (await offerBox(ines.page)).entries;
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: entry!.id, firstArrivalAt: first, sources: [{ source: "job_offer_link" }] });

    // Another Candidate pasting it has their own entry, not Inès's.
    const paul = await candidate(browser, "offer-box-link-other");
    expect(await offerBox(paul.page)).toMatchObject({ toHandle: 0, entries: [] });
    await toConversation(paul.page);
    await pasteLink(paul.page);
    const theirs = (await offerBox(paul.page)).entries;
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ jobOffer: { id: entry!.jobOffer.id }, state: "to_handle" });
    expect(theirs[0]!.id).not.toBe(entry!.id);

    // An Application made anywhere (here, « Enregistrer en candidature » through the API, as the extension and the Coach do)
    // makes the entry « Suivie » for as long as it exists.
    const saved = await ines.page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: entry!.jobOffer.id, profileId: ines.profileId } });
    expect(saved.ok(), await saved.text()).toBe(true);
    const followed = await offerBox(ines.page);
    expect(followed.toHandle).toBe(0);
    expect(followed.entries[0]).toMatchObject({ state: "followed", applicationId: (await saved.json()).id });
    expect((await offerBox(paul.page)).toHandle).toBe(1);

    // The Data export holds the entry: Job Offer, Profile, first Arrival, Arrival sources with their dates, where it stands.
    const exported = await (await ines.page.request.get("/api/account/export")).json();
    expect(exported.offerBox).toEqual([
      expect.objectContaining({
        jobOfferId: entry!.jobOffer.id,
        firstArrivalAt: first,
        arrivalSources: [{ source: "job_offer_link", at: expect.any(String) }],
        state: "followed",
        decidedAt: null,
        dismissalReason: null,
        laterUntil: null,
      }),
    ]);
    expect((await (await paul.page.request.get("/api/account/export")).json()).offerBox).toHaveLength(1);

    // Deleting the account deletes the entries; the other Candidate's, and the shared Job Offer, stay.
    const count = (id: string) => withDatabase(databaseUrl, async (db) => (await db.query("SELECT count(*)::int AS n FROM offer_box_entry WHERE candidate_id = $1", [id])).rows[0].n as number);
    expect(await count(ines.candidateId)).toBe(1);
    const deleted = await ines.page.request.delete("/api/account", { headers: { origin }, data: { email: ines.email } });
    expect(deleted.status(), await deleted.text()).toBe(204);
    expect(await count(ines.candidateId)).toBe(0);
    expect(await count(paul.candidateId)).toBe(1);
    expect((await paul.page.request.get(`/api/job-offers/${entry!.jobOffer.id}`)).status()).toBe(200);
  });

  test("only the Candidate who is signed in reads the Offer box", async ({ request }) => {
    expect((await request.get("/api/offer-box")).status()).toBe(401);
    expect((await request.post("/api/offer-box/00000000-0000-4000-8000-000000000000/dismissal", { headers: { origin }, data: {} })).status()).toBe(401);
    expect((await request.post("/api/offer-box/00000000-0000-4000-8000-000000000000/later", { headers: { origin } })).status()).toBe(401);
    expect((await request.post("/api/offer-box/dismissals", { headers: { origin }, data: { entryIds: [] } })).status()).toBe(401);
  });

  // Issue #816 (« Offres à traiter 2 »): « Écarter » with a Dismissal reason or none, the toast's « Annuler », « Écartées »
  // and « Revenir sur ce choix », on the page and over `/api`; another Candidate's entry of the same Job Offer untouched.
  // That a Job Digest and Email intake leave an écartée Job Offer out is asserted in their modules' tests.
  test("« Écarter » with a reason takes the entry out of the count, « Annuler » puts it back; « Écarter sans motif » then « Revenir sur ce choix » in « Écartées »; another Candidate's entry stays à traiter", async ({ browser }) => {
    const ines = await candidate(browser, "offer-box-dismiss");
    await toConversation(ines.page);
    await pasteLink(ines.page);
    const paul = await candidate(browser, "offer-box-dismiss-other");
    await toConversation(paul.page);
    await pasteLink(paul.page);
    const [entry] = (await offerBox(ines.page)).entries;

    await ines.page.goto("/recherches");
    const box = ines.page.getByRole("region", { name: /^Offres à traiter/ });
    const line = box.getByRole("listitem", { name: TITLE });
    await line.getByRole("button", { name: fr.offerBox.dismiss }).click();
    const reasons = line.getByRole("group", { name: fr.offerBox.dismissWhy });
    await expect(reasons.getByRole("button")).toHaveText([...Object.values(fr.offerBox.dismissalReasons as Record<string, string>), fr.offerBox.dismissWithoutReason]);
    await reasons.getByRole("button", { name: fr.offerBox.dismissalReasons.salary }).click();

    await expect(ines.page.getByRole("status").filter({ hasText: `« ${TITLE} » écartée.` })).toBeVisible();
    await expect(box.getByText(fr.offerBox.dismissedBlock.replace("{{count}}", "1"))).toBeVisible();
    expect(await offerBox(ines.page)).toMatchObject({ toHandle: 0, entries: [{ id: entry!.id, state: "dismissed", dismissalReason: "salary" }] });
    expect((await offerBox(paul.page)).entries).toMatchObject([{ jobOffer: { id: entry!.jobOffer.id }, state: "to_handle" }]);

    // « Annuler », in the toast: à traiter again.
    await ines.page.getByRole("button", { name: fr.offerBox.undo }).click();
    await expect(box.getByText(fr.offerBox.dismissedBlock.replace("{{count}}", "1"))).toBeHidden();
    expect(await offerBox(ines.page)).toMatchObject({ toHandle: 1, entries: [{ state: "to_handle", dismissalReason: null }] });

    // « Écarter sans motif », then « Revenir sur ce choix » from « Écartées », folded at the foot.
    await line.getByRole("button", { name: fr.offerBox.dismiss }).click();
    await line.getByRole("button", { name: fr.offerBox.dismissWithoutReason }).click();
    const fold = box.getByText(fr.offerBox.dismissedBlock.replace("{{count}}", "1"));
    await fold.click();
    const dismissed = box.locator(".offer-box-dismissed").getByRole("listitem", { name: TITLE });
    await expect(dismissed).toContainText(fr.offerBox.dismissed);
    await dismissed.getByRole("button", { name: fr.offerBox.reconsiderLabel.replace("{{title}}", TITLE) }).click();
    await expect(box.locator(".offer-box-dismissed")).toHaveCount(0);
    expect((await offerBox(ines.page)).toHandle).toBe(1);

    // Over `/api`: a reason outside the list, another Candidate's entry, an entry « Suivie ».
    const dismiss = (page: Page, id: string, data: object) => page.request.post(`/api/offer-box/${id}/dismissal`, { headers: { origin }, data });
    expect((await dismiss(ines.page, entry!.id, { reason: "trop loin" })).status()).toBe(400);
    expect((await dismiss(paul.page, entry!.id, {})).status()).toBe(404);
    expect((await paul.page.request.delete(`/api/offer-box/${entry!.id}/dismissal`, { headers: { origin } })).status()).toBe(404);
    const saved = await ines.page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId: entry!.jobOffer.id, profileId: ines.profileId } });
    expect(saved.ok(), await saved.text()).toBe(true);
    const refused = await dismiss(ines.page, entry!.id, { reason: "salary" });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toEqual({ error: "followed" });
  });

  // « Écartées » shows the last 30 days', the most recent first, each with its reason (#816).
  test("« Écartées » lists the entries écartées in the last 30 days, the most recent first with their reason; one écartée 40 days ago is left out", async ({ browser }) => {
    const ines = await candidate(browser, "offer-box-dismissed-window");
    await toConversation(ines.page);
    await pasteLink(ines.page);
    const [pasted] = (await offerBox(ines.page)).entries;
    const extras = await withDatabase(databaseUrl, async (db) => {
      const made: Record<string, string> = {};
      for (const [key, daysAgo, reason] of [["recent", 3, "contract"], ["older", 12, "applied_elsewhere"], ["ancient", 40, "location"]] as const) {
        const offer = await db.query(`INSERT INTO job_offer (url_key, content_fingerprint, source_url, title, content) VALUES ($1, $1, $2, $3, 'Un poste.') RETURNING id`, [`dw-${tag}-${key}`, `https://emploi-e2e.example/${tag}/dw-${key}`, `Offre ${key} ${tag}`]);
        await db.query(
          `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources, state, decided_at, dismissal_reason)
           VALUES ($1, $2, $3, now() - interval '50 days', '{"job_search": "2026-01-01T00:00:00.000Z"}', 'dismissed', now() - make_interval(days => $4), $5)`,
          [ines.candidateId, offer.rows[0].id, ines.profileId, daysAgo, reason],
        );
        made[key] = `Offre ${key} ${tag}`;
      }
      return made;
    });
    const dismissed = await ines.page.request.post(`/api/offer-box/${pasted!.id}/dismissal`, { headers: { origin }, data: { reason: "not_for_me" } });
    expect(dismissed.status()).toBe(204);

    const box = await offerBox(ines.page);
    // The read keeps the last 30 days' (the one 40 days ago is out); the page orders them, the most recent first.
    expect(box.entries.filter((entry) => entry.state === "dismissed").map((entry) => entry.jobOffer.title).sort()).toEqual([TITLE, extras.recent!, extras.older!].sort());

    await ines.page.goto("/recherches");
    const region = ines.page.getByRole("region", { name: /^Offres à traiter/ });
    const fold = region.locator(".offer-box-dismissed");
    await expect(fold).not.toHaveAttribute("open", "");
    await region.getByText(fr.offerBox.dismissedBlock.replace("{{count}}", "3")).click();
    await expect(fold.getByRole("listitem")).toHaveText([
      new RegExp(`${TITLE}[\\s\\S]*${fr.offerBox.dismissalReasons.not_for_me}`),
      new RegExp(`${extras.recent}[\\s\\S]*${fr.offerBox.dismissalReasons.contract}`),
      new RegExp(`${extras.older}[\\s\\S]*${fr.offerBox.dismissalReasons.applied_elsewhere}`),
    ]);
    await expect(ines.page.getByText(extras.ancient!)).toHaveCount(0);
    // Folded at the foot of the box: after the days' entries, just before the links that close it.
    expect(await fold.evaluate((node) => node.nextElementSibling?.className)).toBe("offer-box-foot");
  });
  // Issue #817 (« Offres à traiter 3 »): « Plus tard » until Monday 00:00 Paris time, « Expirées sans décision » past 30
  // days of posting, « Tout écarter (n) » per tier of « Précédemment », on the page and over `/api`. The Monday across a
  // change of time and the 30 days in French days are asserted in @jobhub/shared's and the Offer box module's tests.
  test("« Plus tard » keeps the entry counted until Monday, « Annuler » brings it back; an entry posted 40 days ago is « Expirée sans décision », out of the count, still écartable; « Tout écarter » écarte one tier of « Précédemment », « Annuler » puts it back", async ({ browser }) => {
    const ines = await candidate(browser, "offer-box-later");
    const paul = await candidate(browser, "offer-box-later-other");
    const seeded = await withDatabase(databaseUrl, async (db) => {
      const made: Record<string, string> = {};
      // Today's, two arrived 3 days ago with the same posting (so one Importance tier), and one posted 40 days ago.
      for (const [key, arrivedDaysAgo, postedDaysAgo] of [["today", 0, 1], ["earlier-1", 3, 3], ["earlier-2", 3, 3], ["expired", 3, 40]] as const) {
        const offer = await db.query(
          `INSERT INTO job_offer (url_key, content_fingerprint, source_url, title, content, posted_at) VALUES ($1, $1, $2, $3, 'Un poste.', now() - make_interval(days => $4)) RETURNING id`,
          [`lt-${tag}-${key}`, `https://emploi-e2e.example/${tag}/lt-${key}`, `Offre ${key} ${tag}`, postedDaysAgo],
        );
        const entry = await db.query(
          `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources)
           VALUES ($1, $2, $3, now() - make_interval(days => $4), jsonb_build_object('job_search', to_char((now() - make_interval(days => $4)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
           RETURNING id`,
          [ines.candidateId, offer.rows[0].id, ines.profileId, arrivedDaysAgo],
        );
        made[key] = entry.rows[0].id;
      }
      return made;
    });
    const title = (key: string) => `Offre ${key} ${tag}`;
    const stateOf = async (key: string) => (await offerBox(ines.page)).entries.find((entry) => entry.id === seeded[key])!.state;

    // « Expirée sans décision »: out of the count from the start.
    const box = await offerBox(ines.page);
    expect(box.toHandle).toBe(3);
    expect(await stateOf("expired")).toBe("expired");

    // « Plus tard » on the page: still counted, folded under « Plus tard » with the Monday it comes back.
    await ines.page.goto("/recherches");
    const region = ines.page.getByRole("region", { name: /^Offres à traiter/ });
    await region.getByRole("button", { name: fr.offerBox.laterLabel.replace("{{title}}", title("today")) }).click();
    await expect(ines.page.getByRole("status").filter({ hasText: `« ${title("today")} » revient lundi` })).toBeVisible();
    await expect(region.getByText(fr.offerBox.laterBlock.replace("{{count}}", "1"))).toBeVisible();
    const later = (await offerBox(ines.page)).entries.find((entry) => entry.id === seeded.today)!;
    expect(later.state).toBe("later");
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(later.laterUntil!))).toBe("Monday 00:00");
    expect((await offerBox(ines.page)).toHandle).toBe(3);
    await region.getByText(fr.offerBox.laterBlock.replace("{{count}}", "1")).click();
    await expect(region.locator(".offer-box-later").getByRole("listitem", { name: title("today") })).toContainText("Plus tard · revient lundi");

    // « Annuler », in the toast: back at once.
    await ines.page.getByRole("button", { name: fr.offerBox.undo }).click();
    await expect(region.locator(".offer-box-later")).toHaveCount(0);
    expect(await stateOf("today")).toBe("to_handle");

    // « Expirées sans décision », folded: « Écarter » only.
    await region.getByText(fr.offerBox.expiredBlock.replace("{{count}}", "1")).click();
    const expired = region.locator(".offer-box-expired").getByRole("listitem", { name: title("expired") });
    await expect(expired.getByRole("button", { name: fr.offerBox.follow })).toHaveCount(0);
    await expired.getByRole("button", { name: fr.offerBox.dismiss }).click();
    await expired.getByRole("button", { name: fr.offerBox.dismissWithoutReason }).click();
    await expect(region.locator(".offer-box-expired")).toHaveCount(0);
    expect(await stateOf("expired")).toBe("dismissed");

    // « Tout écarter (2) » on the tier of « Précédemment » holding the two earlier entries; today's is untouched.
    const all = region.getByRole("button", { name: /^Tout écarter dans/ });
    await expect(all).toHaveCount(1);
    await expect(all).toHaveText(fr.offerBox.dismissAll.replace("{{count}}", "2"));
    await all.click();
    await expect(ines.page.getByRole("status").filter({ hasText: "2 offres écartées." })).toBeVisible();
    expect([await stateOf("earlier-1"), await stateOf("earlier-2"), await stateOf("today")]).toEqual(["dismissed", "dismissed", "to_handle"]);
    await ines.page.getByRole("button", { name: fr.offerBox.undo }).click();
    await expect.poll(async () => [await stateOf("earlier-1"), await stateOf("earlier-2")]).toEqual(["to_handle", "to_handle"]);

    // Over `/api`: another Candidate's entry, an entry écartée, and « Tout écarter » naming entries not theirs.
    const laterOf = (page: Page, id: string) => page.request.post(`/api/offer-box/${id}/later`, { headers: { origin } });
    expect((await laterOf(paul.page, seeded.today!)).status()).toBe(404);
    expect((await paul.page.request.delete(`/api/offer-box/${seeded.today}/later`, { headers: { origin } })).status()).toBe(404);
    const refused = await laterOf(ines.page, seeded.expired!);
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toEqual({ error: "dismissed" });
    const notTheirs = await paul.page.request.post("/api/offer-box/dismissals", { headers: { origin }, data: { entryIds: [seeded["earlier-1"], seeded["earlier-2"]] } });
    expect(await notTheirs.json()).toEqual({ dismissed: [] });
    expect((await paul.page.request.post("/api/offer-box/dismissals", { headers: { origin }, data: { entryIds: "all" } })).status()).toBe(400);
    expect(await stateOf("earlier-1")).toBe("to_handle");
  });

  // Issue #817, the three rules the first test leaves out: a posting date unknown (the first Arrival counts), the Monday
  // an entry « Plus tard » comes back under « Aujourd'hui », and « Tout écarter (n) » bounded by the source chip.
  test("a posting date unknown expires on the first Arrival's 30 days; an entry whose Monday has come is back under « Aujourd'hui », still counted; « Tout écarter » within the source chip écarte only the entries that chip shows", async ({ browser }) => {
    const ines = await candidate(browser, "offer-box-rules");
    const seeded = await withDatabase(databaseUrl, async (db) => {
      const made: Record<string, string> = {};
      // [key, arrived days ago, posted days ago (null: unknown), arrival source, back from « Plus tard » at Paris midnight today]
      const rows = [
        ["unknown-old", 40, null, "job_search", false],
        ["unknown-recent", 10, null, "job_search", false],
        ["back", 3, 3, "job_search", true],
        ["search-1", 3, 3, "job_search", false],
        ["search-2", 3, 3, "job_search", false],
        ["digest-1", 3, 3, "job_digest", false],
      ] as const;
      for (const [key, arrivedDaysAgo, postedDaysAgo, source, back] of rows) {
        const offer = await db.query(
          `INSERT INTO job_offer (url_key, content_fingerprint, source_url, title, content, posted_at) VALUES ($1, $1, $2, $3, 'Un poste.', CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(days => $4::int) END) RETURNING id`,
          [`rl-${tag}-${key}`, `https://emploi-e2e.example/${tag}/rl-${key}`, `Offre ${key} ${tag}`, postedDaysAgo],
        );
        const entry = await db.query(
          `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources, state, later_until)
           VALUES ($1, $2, $3, now() - make_interval(days => $4), jsonb_build_object($5::text, to_char((now() - make_interval(days => $4)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
                   CASE WHEN $6::boolean THEN 'later' ELSE 'to_handle' END,
                   CASE WHEN $6::boolean THEN date_trunc('day', now() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris' END)
           RETURNING id`,
          [ines.candidateId, offer.rows[0].id, ines.profileId, arrivedDaysAgo, source, back],
        );
        made[key] = entry.rows[0].id;
      }
      return made;
    });
    const entryOf = async (key: string) => (await offerBox(ines.page)).entries.find((entry) => entry.id === seeded[key])!;
    const title = (key: string) => `Offre ${key} ${tag}`;

    // Unknown posting date: the first Arrival, 40 days ago, expires it; 10 days ago does not. Never écartée for the Candidate.
    expect((await entryOf("unknown-old")).state).toBe("expired");
    expect((await entryOf("unknown-recent")).state).toBe("to_handle");
    // Its Monday has come: neither « Plus tard » nor expired, counted, and not écartée.
    expect((await entryOf("back")).state).toBe("to_handle");
    expect((await offerBox(ines.page)).toHandle).toBe(5);

    await ines.page.goto("/recherches");
    const region = ines.page.getByRole("region", { name: /^Offres à traiter/ });
    await expect(region.getByRole("region", { name: fr.offerBox.today }).getByRole("listitem", { name: title("back") })).toBeVisible();
    await expect(region.getByRole("region", { name: fr.offerBox.today }).getByRole("listitem", { name: title("search-1") })).toHaveCount(0);

    // « Tout écarter » within the source chip « Recherche »: the three search entries of the tier of « Précédemment » (the
    // one back is today's, outside it); the digest's, the same tier's, stays.
    await region.getByRole("button", { name: fr.offerBox.chipCount.replace("{{source}}", fr.offerBox.sources.job_search).replace("{{count}}", "4") }).click();
    const all = region.getByRole("button", { name: /^Tout écarter dans/ });
    await expect(all).toHaveCount(1);
    await expect(all).toHaveText(fr.offerBox.dismissAll.replace("{{count}}", "3"));
    await all.click();
    await expect(ines.page.getByRole("status").filter({ hasText: "3 offres écartées." })).toBeVisible();
    const states = await Promise.all(["search-1", "search-2", "unknown-recent", "digest-1", "back"].map(async (key) => (await entryOf(key)).state));
    expect(states).toEqual(["dismissed", "dismissed", "dismissed", "to_handle", "to_handle"]);
    expect((await entryOf("unknown-old")).state).toBe("expired");
  });
});

// The deployment's backfill and the nightly purge, on a database of their own: `npm run db:migrate` fills the Offer box
// from the last 30 days, and runs again without changing it (ADR-0090).
test.describe("The Offer box at deployment and every night (#815)", () => {
  const url = new URL(databaseUrl);
  url.pathname = `${url.pathname}_offer_box`;
  const name = url.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const migrate = () => spawnSync("npm", ["run", "db:migrate"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 240_000 });
  const days = (n: number) => `now() - interval '${n} days'`;

  test.beforeAll(async () => {
    await withDatabase(adminUrl.toString(), async (db) => {
      await db.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await db.query(`CREATE DATABASE ${name}`);
    });
  });
  test.afterAll(async () => {
    await withDatabase(adminUrl.toString(), (db) => db.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });

  test("the last 30 days of Job Searches, Job Digests and Received offer emails become entries, old or too old a posting excluded, a Private Job Offer only for its Candidate, an Application « Suivie »; run again, nothing changes; 12 months after the first Arrival the nightly purge deletes the entry", async () => {
    test.setTimeout(480_000);
    const first = migrate();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("The Offer box is up to date");

    const offerIds: Record<string, string> = {};
    await withDatabase(url.toString(), async (db) => {
      for (const id of ["ines", "paul"]) {
        await db.query(`INSERT INTO "candidate" (id, name, email, "emailVerified", "interfaceLanguage") VALUES ($1, $1, $2, true, 'fr')`, [`${id}-${tag}`, `${id}-${tag}@e2e.jobbbox.test`]);
      }
      const profile = (await db.query(`INSERT INTO profile (candidate_id, name, target_role, locations) VALUES ($1, 'DAF', 'DAF', ARRAY['Lyon']) RETURNING id`, [`ines-${tag}`])).rows[0].id as string;
      const offer = async (key: string, { postedDaysAgo = null, privateTo = null }: { postedDaysAgo?: number | null; privateTo?: string | null } = {}) => {
        const row = await db.query(
          `INSERT INTO job_offer (url_key, content_fingerprint, source_url, title, content, posted_at, private_to_candidate_id)
           VALUES ($1, $1, $2, $3, 'Un poste.', ${postedDaysAgo === null ? "NULL" : days(postedDaysAgo)}, $4) RETURNING id`,
          [`bf-${tag}-${key}`, `https://emploi-e2e.example/${tag}/${key}`, `Offre ${key}`, privateTo],
        );
        offerIds[key] = row.rows[0].id;
      };
      await offer("search", { postedDaysAgo: 3 });
      await offer("old-search");
      await offer("old-posting", { postedDaysAgo: 45 });
      await offer("both");
      await offer("applied");
      await offer("email");
      await offer("pauls-private", { privateTo: `paul-${tag}` });
      const search = (ids: string[], ago: number) =>
        db.query(`INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, started_at, finished_at) VALUES ($1, $2, 'done', $3, ${days(ago)}, ${days(ago)})`, [`ines-${tag}`, profile, ids]);
      await search([offerIds.search!, offerIds.both!, offerIds.applied!], 5);
      await search([offerIds["old-search"]!], 40);
      await db.query(`INSERT INTO job_digest (candidate_id, profile_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, ${days(2)})`, [`ines-${tag}`, profile, [offerIds.both, offerIds["old-posting"], offerIds["pauls-private"]]]);
      await db.query(`INSERT INTO application (candidate_id, job_offer_id, profile_id) VALUES ($1, $2, $3)`, [`ines-${tag}`, offerIds.applied, profile]);
      const mail = `${tag}-mail`;
      await db.query(`INSERT INTO received_offer_email (id, candidate_id, message_id, outcome, kind, sender_domain, received_at, read_at) VALUES ($1, $2, $3, 'offers_found', 'alert', 'alertes.example', ${days(1)}, ${days(1)})`, [mail, `ines-${tag}`, `<${mail}@mail.example.test>`]);
      await db.query(`INSERT INTO received_offer_email_offer (received_offer_email_id, position, candidate_id, disposition, job_offer_id, profile_id, match_score) VALUES ($1, 0, $2, 'new', $3, NULL, 42)`, [mail, `ines-${tag}`, offerIds.email]);
    });

    const entries = () =>
      withDatabase(url.toString(), async (db) =>
        (
          await db.query(
            `SELECT o.title, e.candidate_id, e.profile_id, e.arrival_sources, e.first_arrival_at, (a.id IS NOT NULL) AS followed
               FROM offer_box_entry e JOIN job_offer o ON o.id = e.job_offer_id LEFT JOIN application a ON a.candidate_id = e.candidate_id AND a.job_offer_id = e.job_offer_id
              ORDER BY o.title`,
          )
        ).rows as { title: string; candidate_id: string; profile_id: string | null; arrival_sources: Record<string, string>; first_arrival_at: Date; followed: boolean }[],
      );
    const deployed = migrate();
    expect(deployed.status, deployed.stderr).toBe(0);
    const filled = await entries();
    expect(filled.map((entry) => entry.title)).toEqual(["Offre applied", "Offre both", "Offre email", "Offre search"]);
    expect(filled.every((entry) => entry.candidate_id === `ines-${tag}`)).toBe(true);
    const byTitle = new Map(filled.map((entry) => [entry.title, entry]));
    expect(Object.keys(byTitle.get("Offre both")!.arrival_sources).sort()).toEqual(["job_digest", "job_search"]);
    // The earliest Arrival makes the entry: the Job Search, 5 days ago, before the Job Digest.
    expect(byTitle.get("Offre both")!.arrival_sources.job_search).toBe(new Date(byTitle.get("Offre both")!.first_arrival_at).toISOString());
    expect(Object.keys(byTitle.get("Offre email")!.arrival_sources)).toEqual(["email"]);
    expect(byTitle.get("Offre email")!.profile_id).toBeNull();
    expect(filled.filter((entry) => entry.followed).map((entry) => entry.title)).toEqual(["Offre applied"]);

    // Idempotent.
    const redeployed = migrate();
    expect(redeployed.status, redeployed.stderr).toBe(0);
    expect(await entries()).toEqual(filled);

    // The nightly purge: nothing at 11 months, the entries at 13 (the worker's clock set ahead, as e2e/support/worker-job.ts does).
    const purge = (hours: number) =>
      spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/worker-job.ts", "offer-box.purge", String(hours)], { env: { ...process.env, DATABASE_URL: url.toString(), APP_URL: origin, MAIL_TRANSPORT: "console" }, encoding: "utf8", timeout: 120_000 });
    const kept = purge(24 * 30 * 11);
    expect(kept.status, kept.stderr).toBe(0);
    expect(await entries()).toHaveLength(4);
    const purged = purge(24 * 30 * 13);
    expect(purged.status, purged.stderr).toBe(0);
    expect(purged.stdout).toContain("4 Offer box entry(ies) purged");
    expect(await entries()).toEqual([]);
  });
});

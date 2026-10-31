import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #600 / ADR-0070: every Coach Conversation has a Subject (an object or a Sidebar menu), one conversation each, created at
// its first message. Driven through the public endpoints (POST /api/coach, GET /api/coach/conversations, the account export) and
// the pages that count the replies in AI Activity. The AI Coach is faked inside the server (fake-mistral.mjs).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

async function createProfile(page: Page, targetRole: string): Promise<string> {
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv: masterCv(targetRole), searchCriteria: { targetRole, locations: ["Lyon"] } } });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).id;
}

async function captureOffer(page: Page, title: string): Promise<string> {
  const captured = await page.request.post("/api/job-offers", {
    headers: { origin },
    data: { source: { url: `https://www.apec.fr/offres/${unique()}` }, title, content: `Vos missions : piloter la clôture. (${unique()})`, employer: "Acme Industrie", location: "Lyon", contractType: "cdi", skills: ["IFRS"] },
  });
  expect(captured.status(), await captured.text()).toBe(200);
  return (await captured.json()).id;
}

async function saveApplication(page: Page, jobOfferId: string, profileId: string): Promise<string> {
  const saved = await page.request.post("/api/applications", { headers: { origin }, data: { jobOfferId, profileId } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await saved.json()).id;
}

/**
 * What the worker leaves behind: a Job Search and a sent Job Digest (no public endpoint stores them without a worker).
 * The search is left 'searching': job-search-metrics.spec.ts checks, across the shared database, that every finished one has its metrics.
 */
async function storeSearchAndDigest(page: Page, profileId: string, jobOfferIds: string[]): Promise<{ searchId: string; digestId: string }> {
  const candidate: string = (await (await page.request.get("/api/auth/get-session")).json()).user.id;
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    const search = await db.query("INSERT INTO job_search (candidate_id, profile_id, status, started_at) VALUES ($1, $2, 'searching', now()) RETURNING id", [candidate, profileId]);
    const digest = await db.query("INSERT INTO job_digest (candidate_id, profile_id, job_offer_ids, sent_at) VALUES ($1, $2, $3, now()) RETURNING id", [candidate, profileId, jobOfferIds]);
    return { searchId: search.rows[0].id, digestId: digest.rows[0].id };
  } finally {
    await db.end();
  }
}

const talk = (page: Page, data: object) => page.request.post("/api/coach", { headers: { origin }, data });
const conversationOf = async (page: Page, kind: string, id: string) => (await (await page.request.get(`/api/coach/conversations?kind=${kind}&id=${encodeURIComponent(id)}`)).json()).conversation;
const exportOf = async (page: Page) => {
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  return response.json();
};

test.describe("Coach Conversation Subjects (#600)", () => {
  test("an archived object keeps its conversation and takes it back when restored", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("subject-archive"));
    const profileId = await createProfile(page, "Directrice financière");
    const sent = await talk(page, { subject: { kind: "profile", id: profileId }, message: "Mon CV ?" });
    expect(sent.status(), await sent.text()).toBe(200);
    const id: string = (await sent.json()).conversation.id;

    expect((await page.request.patch(`/api/profiles/${profileId}`, { headers: { origin }, data: { archived: true } })).ok()).toBe(true);
    expect(await conversationOf(page, "profile", profileId)).toMatchObject({ id, messages: { length: 2 } });
    expect((await (await page.request.get("/api/coach/conversations")).json()).conversations.map((c: { id: string }) => c.id)).toContain(id);

    expect((await page.request.patch(`/api/profiles/${profileId}`, { headers: { origin }, data: { archived: false } })).ok()).toBe(true);
    expect(await conversationOf(page, "profile", profileId)).toMatchObject({ id, messages: { length: 2 } });
    const again = await talk(page, { subject: { kind: "profile", id: profileId }, message: "Et après ?" });
    expect((await again.json()).conversation.id).toBe(id);
  });

  test("takes the six kinds In view as Focus, AI Activity counts the replies on each page, and the export names every Subject", async ({ page }) => {
    await signInWithMagicLink(page, newAddress("subject-six"));
    const profileId = await createProfile(page, "Directrice financière");
    const offerId = await captureOffer(page, "DAF Lyon");
    const applicationId = await saveApplication(page, offerId, profileId);
    const { searchId, digestId } = await storeSearchAndDigest(page, profileId, [offerId]);

    const subjects = [
      { kind: "application", id: applicationId },
      { kind: "profile", id: profileId },
      { kind: "job_search", id: searchId },
      { kind: "job_digest", id: digestId },
      { kind: "menu", id: "agenda" },
    ];
    const conversationIds: Record<string, string> = {};
    for (const subject of subjects) {
      const sent = await talk(page, { subject, message: `Que penses-tu de ${subject.kind} ?` });
      expect(sent.status(), `${subject.kind}: ${await sent.text()}`).toBe(200);
      conversationIds[subject.kind] = (await sent.json()).conversation.id;
    }
    // The sixth kind: a Job Offer In view, in a Free conversation.
    const free = await talk(page, { message: "Cette offre ?", focus: { kind: "job_offer", id: offerId } });
    expect(free.status(), await free.text()).toBe(200);
    const freeId: string = (await free.json()).conversation.id;

    const exported = await exportOf(page);
    const byId = new Map<string, { subject: { kind: string; id: string; name: string } | null; messages: { focus?: { kind: string; id?: string } }[] }>(
      exported.coachConversations.map((c: { id: string }) => [c.id, c]),
    );
    for (const subject of subjects) {
      const exportedSubject = byId.get(conversationIds[subject.kind]!)!.subject!;
      expect(exportedSubject, subject.kind).toEqual({ kind: subject.kind, id: subject.id, name: expect.any(String) });
      expect(exportedSubject.name.length, `${subject.kind} has a name`).toBeGreaterThan(0);
    }
    expect(byId.get(conversationIds.profile!)!.subject!.name).toBe("Directrice financière");
    expect(byId.get(conversationIds.application!)!.subject!.name).toContain("DAF Lyon");
    expect(byId.get(conversationIds.menu!)!.subject).toMatchObject({ kind: "menu", id: "agenda" });
    expect(byId.get(freeId)!.subject).toBeNull();
    const focusKinds = [...byId.values()].flatMap((c) => c.messages.map((m) => m.focus?.kind)).filter(Boolean);
    expect(new Set(focusKinds)).toEqual(new Set(["application", "profile", "job_search", "job_digest", "agenda", "job_offer"]));

    // AI Activity counts the replies about a Job Search, a Job Digest and the Agenda on their own pages.
    for (const path of [`/recherches/${searchId}`, `/job-digests/${digestId}`, "/agenda"]) {
      await page.goto(path);
      await page.getByRole("banner").getByRole("button", { name: new RegExp(`^${fr.aiActivity.label}`) }).click();
      await expect(page.getByRole("complementary", { name: fr.aiActivity.label }), path).toContainText(fr.aiActivity.kinds.coach_reply);
    }
  });
});

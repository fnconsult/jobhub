import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionCards, migrateActionCards, type ActionCards } from "../action-cards";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import type { PushNotification } from "../push-notifications";
import { migrateTailoredDocuments } from "../tailored-documents";
import { ABANDON_CARD, FOLLOW_UP_CARD, createFollowUps, followUpCardApplies, migrateFollowUps, type FollowUps } from "./index";

const masterCv: MasterCvContent = {
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

/** French time, noon: clear of any midnight in Europe/Paris. */
const day = (date: string) => new Date(`${date}T12:00:00+01:00`);

describe.skipIf(!connectionString)("Follow-ups (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let applications: Applications;
  let actionCards: ActionCards;
  let followUps: FollowUps;
  let candidateId: string;
  let otherCandidateId: string;
  let applicationId: string;
  let clock: Date;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  /** Arrange only: the Candidate set this status on that day (the Applications module stamps the real time). */
  async function setStatus(status: string, on: Date, id = applicationId, owner = candidateId) {
    const changed = await applications.change(owner, id, { status });
    if (!changed.ok) throw new Error("fixture status refused");
    await database.query(`UPDATE application SET status_changed_at = $2 WHERE id = $1`, [id, on]);
  }

  /** The Candidate marks the pending Follow-up as sent on that day. */
  async function markSentOn(on: Date) {
    const [card] = await pendingCards();
    if (!card || card.kind !== FOLLOW_UP_CARD) throw new Error("no Follow-up pending");
    const statusBefore = (await applications.get(candidateId, applicationId))?.status;
    clock = on;
    expect(await actionCards.decide(candidateId, card.id, "accept")).toMatchObject({ ok: true });
    // Arrange only: the Applications module stamps a status change with the real time, and the Follow-up sent is recorded
    // no earlier than it: both are moved back to that day, or the next one would be counted from the real date (red from
    // Friday 13 November 2026, Paris time, the day after the fixture's).
    if (statusBefore !== "followed_up") await database.query(`UPDATE application SET status_changed_at = $2 WHERE id = $1`, [applicationId, on]);
    await database.query(`UPDATE follow_up_sent SET sent_at = $2 WHERE application_id = $1 AND sent_at > $2`, [applicationId, on]);
  }

  const followUpFocus = () => ({ kind: "application", id: applicationId }) as const;
  const pendingCards = (owner = candidateId) => actionCards.pending(owner, followUpFocus());

  beforeEach(async () => {
    clock = new Date();
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateTailoredDocuments(database);
    await migrateActionCards(database);
    await migrateFollowUps(database);
    await migrateFollowUps(database); // safe to run twice
    const profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    followUps = createFollowUps(database, {
      actionCards: createActionCards(database),
      applications,
      mailer: { send: async (message) => void testAuth.mailbox.push(message) },
      appUrl: "https://app.jobbbox.test",
      now: () => clock,
    });
    actionCards = createActionCards(database, { onAccept: followUps.onAccept });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    const profile = await profiles.create(candidateId, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
    const captured = await jobOffers.capture({
      source: { url: "https://www.apec.fr/offre/1" },
      title: "DAF H/F",
      content: "Nous recherchons un DAF pour un groupe industriel. Vous avez 15 ans d'expérience dans la finance.",
      employer: "Acme Industrie",
      location: "Lyon",
    });
    if (!profile.ok || !captured.ok) throw new Error("fixtures refused");
    const saved = await applications.save(candidateId, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    applicationId = saved.application.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("proposes a Follow-up draft on the Application once it has stayed « Postulée » 7 working days, French public holidays excluded", async () => {
    // Monday 2 November 2026; Wednesday 11 November is a public holiday, so the 7th working day is Thursday 12.
    await setStatus("applied", day("2026-11-02"));

    await followUps.proposeDue(day("2026-11-11"));
    expect(await pendingCards()).toEqual([]);

    await followUps.proposeDue(day("2026-11-12"));
    const cards = await pendingCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: FOLLOW_UP_CARD, focus: followUpFocus() });
    expect(cards[0]!.title).toContain("DAF H/F");
    expect(cards[0]!.body).not.toBe("");
  });

  it("moves the Application to « Relancée » when the Candidate marks the Follow-up as sent, then proposes the next one 10 working days later", async () => {
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-12"));

    await markSentOn(day("2026-11-12"));
    expect((await applications.get(candidateId, applicationId))?.status).toBe("followed_up");
    expect(await pendingCards()).toEqual([]);

    // 10 working days after Thursday 12 November: Thursday 26 November.
    await followUps.proposeDue(day("2026-11-25"));
    expect(await pendingCards()).toEqual([]);
    await followUps.proposeDue(day("2026-11-26"));
    expect(await pendingCards()).toMatchObject([{ kind: FOLLOW_UP_CARD }]);
  });

  it("suggests « Abandonnée » once the second Follow-up has stayed unanswered as long, and abandons the Application if the Candidate accepts", async () => {
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-12"));
    await markSentOn(day("2026-11-12"));
    await followUps.proposeDue(day("2026-11-26"));
    await markSentOn(day("2026-11-26"));

    await followUps.proposeDue(day("2026-12-10"));
    const [card] = await pendingCards();
    expect(card).toMatchObject({ kind: ABANDON_CARD });
    expect((await applications.get(candidateId, applicationId))?.status).toBe("followed_up");

    await actionCards.decide(candidateId, card!.id, "accept");
    expect((await applications.get(candidateId, applicationId))?.status).toBe("abandoned");
  });

  it("proposes each Follow-up once: not again while it is pending, nor after the Candidate dismissed it", async () => {
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-12"));
    await followUps.proposeDue(day("2026-11-13"));
    const cards = await pendingCards();
    expect(cards).toHaveLength(1);

    await actionCards.decide(candidateId, cards[0]!.id, "dismiss");
    await followUps.proposeDue(day("2026-11-20"));
    expect(await pendingCards()).toEqual([]);
    expect((await applications.get(candidateId, applicationId))?.status).toBe("applied");
  });

  describe("its Push notification (#699)", () => {
    let notified: { personId: string; notification: PushNotification; once: string | undefined }[];
    let pushing: FollowUps;
    beforeEach(() => {
      notified = [];
      pushing = createFollowUps(database, {
        actionCards: createActionCards(database),
        applications,
        mailer: { send: async () => {} },
        appUrl: "https://app.jobbbox.test",
        now: () => clock,
        push: { notify: async (personId, notification, options) => (notified.push({ personId, notification, once: options?.once }), true) },
      });
    });

    it("tells the Candidate of a Follow-up due, which opens its Application, once per Follow-up however often the schedule runs", async () => {
      await setStatus("applied", day("2026-11-02"));
      await pushing.proposeDue(day("2026-11-12"));
      await pushing.proposeDue(day("2026-11-13"));
      await markSentOn(day("2026-11-12"));
      await pushing.proposeDue(day("2026-11-26"));

      expect(notified.map(({ personId, notification }) => ({ personId, notification }))).toEqual([
        { personId: candidateId, notification: { event: "follow_up_due", applicationId } },
        { personId: candidateId, notification: { event: "follow_up_due", applicationId } },
      ]);
      expect(notified[0]!.once).not.toBe(notified[1]!.once);
    });

    it("tells nothing of an « Abandonnée » suggestion: not a Follow-up", async () => {
      await setStatus("applied", day("2026-11-02"));
      await pushing.proposeDue(day("2026-11-12"));
      await markSentOn(day("2026-11-12"));
      await pushing.proposeDue(day("2026-11-26"));
      await markSentOn(day("2026-11-26"));
      notified = [];

      await pushing.proposeDue(day("2026-12-10"));

      expect(await pendingCards()).toMatchObject([{ kind: ABANDON_CARD }]);
      expect(notified).toEqual([]);
    });
  });

  it("counts a « Relancée » the Candidate set by hand as a Follow-up sent, waiting 10 working days from it", async () => {
    await setStatus("followed_up", day("2026-11-12"));

    await followUps.proposeDue(day("2026-11-25"));
    expect(await pendingCards()).toEqual([]);
    await followUps.proposeDue(day("2026-11-26"));
    expect(await pendingCards()).toMatchObject([{ kind: FOLLOW_UP_CARD }]);
    await markSentOn(day("2026-11-26"));

    await followUps.proposeDue(day("2026-12-10"));
    expect(await pendingCards()).toMatchObject([{ kind: ABANDON_CARD }]);
  });

  it("proposes nothing once the Application has moved on (e.g. « Entretien »)", async () => {
    await setStatus("interview", day("2026-11-02"));

    await followUps.proposeDue(day("2027-01-04"));

    expect(await pendingCards()).toEqual([]);
  });

  it("withdraws a pending Follow-up once the Candidate moves the Application on: no notice, and marking it as sent never takes the status back", async () => {
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-12"));
    const [card] = await pendingCards();
    expect(card).toMatchObject({ kind: FOLLOW_UP_CARD });
    expect(followUpCardApplies(card!, "applied")).toBe(true);

    await setStatus("interview", day("2026-11-13"));

    expect(followUpCardApplies(card!, "interview")).toBe(false);
    expect(await followUps.notices(candidateId)).toEqual([]);
    expect(await actionCards.decide(candidateId, card!.id, "accept")).toEqual({ ok: false, error: "failed" });
    expect((await applications.get(candidateId, applicationId))?.status).toBe("interview");
    const { rows } = await database.query(`SELECT 1 FROM follow_up_sent WHERE application_id = $1`, [applicationId]);
    expect(rows).toEqual([]);
  });

  it("never lets an « Abandonnée » suggestion overwrite a status the Application has moved on to (e.g. « Offre reçue »)", async () => {
    await setStatus("followed_up", day("2026-11-12"));
    await followUps.proposeDue(day("2026-11-26"));
    await markSentOn(day("2026-11-26"));
    await followUps.proposeDue(day("2026-12-10"));
    const [card] = await pendingCards();
    expect(card).toMatchObject({ kind: ABANDON_CARD });

    await setStatus("offer_received", day("2026-12-11"));

    expect(followUpCardApplies(card!, "offer_received")).toBe(false);
    expect(await followUps.notices(candidateId)).toEqual([]);
    expect(await actionCards.decide(candidateId, card!.id, "accept")).toEqual({ ok: false, error: "failed" });
    expect((await applications.get(candidateId, applicationId))?.status).toBe("offer_received");
  });

  it("waits the Follow-up Delays the Candidate chose, and refuses delays that are not whole working days from 1 to 60", async () => {
    expect(await followUps.delays(candidateId)).toEqual({ afterApplied: 7, afterFollowUp: 10 });
    expect(await followUps.setDelays(candidateId, { afterApplied: 3, afterFollowUp: 5 })).toEqual({ ok: true, delays: { afterApplied: 3, afterFollowUp: 5 } });
    expect(await followUps.setDelays(candidateId, { afterApplied: 0, afterFollowUp: 2.5 })).toMatchObject({
      ok: false,
      errors: [{ field: "afterApplied" }, { field: "afterFollowUp" }],
    });
    expect(await followUps.delays(candidateId)).toEqual({ afterApplied: 3, afterFollowUp: 5 });
    expect(await followUps.delays(otherCandidateId)).toEqual({ afterApplied: 7, afterFollowUp: 10 });

    // 3 working days after Monday 2 November: Thursday 5 November.
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-04"));
    expect(await pendingCards()).toEqual([]);
    await followUps.proposeDue(day("2026-11-05"));
    expect(await pendingCards()).toHaveLength(1);
  });

  it("tells the Candidate by email and in the app, without ever writing to the employer (drafts only)", async () => {
    await setStatus("applied", day("2026-11-02"));
    await database.query(`UPDATE candidate SET given_name = 'Marie', preferred_name = 'Mimi' WHERE id = $1`, [candidateId]);
    const mailed = testAuth.mailbox.length;

    await followUps.proposeDue(day("2026-11-12"));
    await followUps.proposeDue(day("2026-11-13"));

    const sent = testAuth.mailbox.slice(mailed);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "marie.dupont@example.fr" });
    // By their Preferred Name (#921).
    expect(sent[0]!.text.startsWith("Bonjour Mimi,\n\n")).toBe(true);
    expect(sent[0]!.subject).toContain("DAF H/F");
    expect(sent[0]!.text).toContain(`https://app.jobbbox.test/candidatures/${applicationId}`);
    expect(await followUps.notices(candidateId)).toEqual([{ applicationId, jobTitle: "DAF H/F", kind: FOLLOW_UP_CARD }]);
    expect(await followUps.notices(otherCandidateId)).toEqual([]);

    const [card] = await pendingCards();
    expect(card!.payload).toMatchObject({ subject: expect.any(String), text: expect.stringContaining("DAF H/F") });
    await markSentOn(day("2026-11-13"));
    expect(await followUps.notices(candidateId)).toEqual([]);
    expect(testAuth.mailbox.slice(mailed)).toHaveLength(1);
  });

  it("drafts the Follow-up with the AI Coach in the Application's Document Language, and from a template when it fails", async () => {
    const prompts: string[] = [];
    const ai = {
      generate: async ({ system }: { system: string }) => {
        prompts.push(system);
        if (prompts.length > 1) throw new Error("AI layer down");
        return {
          text: '{"subject": "Ma candidature DAF", "text": "Bonjour, je reviens vers vous."}',
          provider: "anthropic",
          endpoint: "bedrock eu-north-1",
          model: "anthropic.claude-sonnet-5",
          usage: { inputTokens: 900, outputTokens: 120 },
          durationMs: 2100,
          outcome: "ok",
        };
      },
    } as unknown as NonNullable<Parameters<typeof createFollowUps>[1]["ai"]>;
    const withAi = createFollowUps(database, {
      actionCards: createActionCards(database),
      applications,
      mailer: { send: async () => {} },
      appUrl: "https://app.jobbbox.test",
      ai,
    });
    await setStatus("applied", day("2026-11-02"));

    await withAi.proposeDue(day("2026-11-12"));
    expect((await pendingCards())[0]!.payload).toMatchObject({ subject: "Ma candidature DAF", text: "Bonjour, je reviens vers vous." });
    expect(prompts[0]).toContain("français");
    // What wrote it (#336): the writing step, its model and tokens.
    expect((await pendingCards())[0]!.provenance).toMatchObject({
      steps: [{ kind: "ai", activity: "write", task: "writing", provider: "anthropic", model: "anthropic.claude-sonnet-5", tokens: { input: 900, output: 120 }, ms: 2100, outcome: "ok" }],
    });

    await markSentOn(day("2026-11-12"));
    await withAi.proposeDue(day("2026-11-26"));
    expect((await pendingCards())[0]!.payload).toMatchObject({ subject: expect.stringContaining("DAF H/F"), text: expect.stringContaining("Bonjour") });
    // Written from the template, by no model: none kept.
    expect((await pendingCards())[0]!.provenance).toBeNull();
  });

  describe("a Follow-up marked as sent from a Coach proposal (#716)", () => {
    const CARD = "66666666-6666-4666-8666-666666666666";
    const origin = { origin: "coach_proposal" as const, cardId: CARD, appliedAt: new Date("2026-11-12T10:00:00Z") };
    const sentRows = async () => (await database.query(`SELECT id FROM follow_up_sent WHERE application_id = $1`, [applicationId])).rows;

    it("tells how many Follow-ups were sent (a « Relancée » set by hand counts as one), the status and their version; nothing of anyone else's", async () => {
      expect(await followUps.sentOf(candidateId, applicationId)).toEqual({ count: 0, status: "to_apply", version: expect.any(String) });
      await setStatus("followed_up", day("2026-11-12"));
      expect(await followUps.sentOf(candidateId, applicationId)).toMatchObject({ count: 1, status: "followed_up" });
      expect(await followUps.sentOf(otherCandidateId, applicationId)).toBeNull();
      expect(await followUps.sentOf(candidateId, "not-a-uuid")).toBeNull();
    });

    it("marks one as sent from the version seen: « Relancée », its Origin kept, the pending Follow-up withdrawn; « Annuler » puts the state before back", async () => {
      await setStatus("applied", day("2026-11-02"));
      await followUps.proposeDue(day("2026-11-12"));
      expect(await pendingCards()).toMatchObject([{ kind: FOLLOW_UP_CARD }]);
      const seen = (await followUps.sentOf(candidateId, applicationId))!;

      const marked = await followUps.markSent(candidateId, applicationId, { version: seen.version, origin });

      expect(marked).toEqual({ ok: true, undo: expect.anything() });
      expect(await applications.statusOf(candidateId, applicationId)).toMatchObject({ status: "followed_up", origin });
      expect(await followUps.sentOf(candidateId, applicationId)).toMatchObject({ count: 1 });
      expect(await pendingCards()).toEqual([]);

      expect(await followUps.unmarkSent(candidateId, applicationId, marked.ok ? marked.undo : null)).toEqual({ ok: true });
      expect(await applications.statusOf(candidateId, applicationId)).toMatchObject({ status: "applied", origin: null });
      expect(await sentRows()).toEqual([]);
    });

    it("refuses as a conflict a version that moved on (another status, another Follow-up sent), and « Annuler » once it moved on since", async () => {
      await setStatus("applied", day("2026-11-02"));
      const seen = (await followUps.sentOf(candidateId, applicationId))!;
      await setStatus("followed_up", day("2026-11-12")); // on its page, meanwhile
      expect(await followUps.markSent(candidateId, applicationId, { version: seen.version, origin })).toEqual({ ok: false, error: "conflict" });
      expect(await sentRows()).toEqual([]);

      const now = (await followUps.sentOf(candidateId, applicationId))!;
      const marked = await followUps.markSent(candidateId, applicationId, { version: now.version, origin });
      expect(marked).toMatchObject({ ok: true });
      expect(await followUps.sentOf(candidateId, applicationId)).toMatchObject({ count: 2, status: "followed_up" });
      await setStatus("interview", day("2026-11-20"));
      expect(await followUps.unmarkSent(candidateId, applicationId, marked.ok ? marked.undo : null)).toEqual({ ok: false, error: "conflict" });
      expect((await sentRows()).length).toBe(2);
    });

    it("marks none past two, nor on an Application not waiting for one, nor on anyone else's", async () => {
      const seen = (await followUps.sentOf(candidateId, applicationId))!;
      expect(await followUps.markSent(candidateId, applicationId, { version: seen.version, origin })).toEqual({ ok: false, error: "not_waiting" });
      expect(await followUps.markSent(otherCandidateId, applicationId, { version: seen.version, origin })).toEqual({ ok: false, error: "not_found" });

      await setStatus("applied", day("2026-11-02"));
      for (let sent = 0; sent < 2; sent += 1) {
        const marked = await followUps.markSent(candidateId, applicationId, { version: (await followUps.sentOf(candidateId, applicationId))!.version, origin });
        expect(marked).toMatchObject({ ok: true });
      }
      const last = (await followUps.sentOf(candidateId, applicationId))!;
      expect(last.count).toBe(2);
      expect(await followUps.markSent(candidateId, applicationId, { version: last.version, origin })).toEqual({ ok: false, error: "limit" });
    });

    it("marks one only of two concurrent applies from the same version: one Follow-up recorded, the other a conflict (#771)", async () => {
      await setStatus("followed_up", day("2026-11-02")); // one sent already, by hand
      const seen = (await followUps.sentOf(candidateId, applicationId))!;
      expect(seen.count).toBe(1);

      const both = await Promise.all([
        followUps.markSent(candidateId, applicationId, { version: seen.version, origin }),
        followUps.markSent(candidateId, applicationId, { version: seen.version, origin }),
      ]);

      expect(both.filter((each) => each.ok)).toHaveLength(1);
      expect(both.filter((each) => !each.ok)).toEqual([{ ok: false, error: "conflict" }]);
      expect(await followUps.sentOf(candidateId, applicationId)).toMatchObject({ count: 2, status: "followed_up" });
      expect(await sentRows()).toHaveLength(2);
    });

    it("changes nothing when recording the Follow-up fails: no « Relancée » without its Follow-up (#771)", async () => {
      await setStatus("applied", day("2026-11-02"));
      const seen = (await followUps.sentOf(candidateId, applicationId))!;
      await database.query(`
        CREATE FUNCTION refuse_follow_up() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$;
        CREATE TRIGGER refuse_follow_up BEFORE INSERT ON follow_up_sent FOR EACH ROW EXECUTE FUNCTION refuse_follow_up();
      `);

      await expect(followUps.markSent(candidateId, applicationId, { version: seen.version, origin })).rejects.toThrow("refused");

      expect(await applications.statusOf(candidateId, applicationId)).toMatchObject({ status: "applied", origin: null });
      expect(await followUps.sentOf(candidateId, applicationId)).toEqual(seen);
    });

    it("puts the status and the Follow-up rows back together, or neither: a status changed since leaves both (#771)", async () => {
      await setStatus("applied", day("2026-11-02"));
      const marked = await followUps.markSent(candidateId, applicationId, { version: (await followUps.sentOf(candidateId, applicationId))!.version, origin });
      // The status alone moved on (back to « Relancée » by hand, the same status): the version of the Follow-ups too.
      await database.query(`UPDATE application SET status_changed_at = status_changed_at + interval '1 second' WHERE id = $1`, [applicationId]);
      expect(await followUps.unmarkSent(candidateId, applicationId, marked.ok ? marked.undo : null)).toEqual({ ok: false, error: "conflict" });
      expect(await applications.statusOf(candidateId, applicationId)).toMatchObject({ status: "followed_up" });
      expect(await sentRows()).toHaveLength(1);
    });

    it("never holds a third Follow-up, nor the same one twice: the table refuses them (#771)", async () => {
      await setStatus("applied", day("2026-11-02"));
      const insert = (number: number) => database.query(`INSERT INTO follow_up_sent (application_id, sent_at, number) VALUES ($1, now(), $2)`, [applicationId, number]);
      await insert(1);
      await expect(insert(1)).rejects.toMatchObject({ code: "23505" });
      await insert(2);
      await expect(insert(3)).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("numbers the Follow-ups recorded before #771 in the order they were sent, keeping every one, and can run again", async () => {
    await database.query(`ALTER TABLE follow_up_sent DROP CONSTRAINT follow_up_sent_number_check; DROP INDEX follow_up_sent_number_idx; ALTER TABLE follow_up_sent DROP COLUMN number`);
    for (const on of ["2026-11-12", "2026-11-05", "2026-11-20"]) {
      await database.query(`INSERT INTO follow_up_sent (application_id, sent_at) VALUES ($1, $2)`, [applicationId, day(on)]);
    }

    await migrateFollowUps(database);
    await migrateFollowUps(database);

    const { rows } = await database.query(`SELECT number, sent_at FROM follow_up_sent WHERE application_id = $1 ORDER BY sent_at`, [applicationId]);
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3]);
  });

  it("never proposes on, or lets anyone else act on, a Candidate's Application", async () => {
    await setStatus("applied", day("2026-11-02"));
    await followUps.proposeDue(day("2026-11-12"));
    const [card] = await pendingCards();

    expect(await pendingCards(otherCandidateId)).toEqual([]);
    expect(await actionCards.decide(otherCandidateId, card!.id, "accept")).toEqual({ ok: false, error: "not_found" });
    expect((await applications.get(candidateId, applicationId))?.status).toBe("applied");
  });
});

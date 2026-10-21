import { AiProviderError, createAiLayer } from "@jobhub/ai";
import { createPostgresUsageLog } from "../ai-usage";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, type Applications } from "../applications";
import { BASE_URL, connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createActionCards } from "../action-cards";
import { createBackOffice } from "../admin/back-office";
import { createAtsScoring } from "../ats-score";
import { createBilling, STARTING_PLAN_QUOTAS } from "../billing";
import { createCoachConversations } from "../coach-conversations";
import { createHumanCoaches } from "../human-coaches";
import { createEuAiConsents } from "../eu-ai-consent";
import { createFollowUps } from "../follow-ups";
import { createJobOffers, type JobOffers } from "../job-offers";
import { migrateDatabase } from "../migrations";
import { backOfficeAccess } from "../admin/access";
import { createAssistantConversations } from "../back-office-assistant/conversations";
import { createProfiles, type Profiles } from "../profiles";
import { createTailoredCvs } from "../tailored-cv";
import { createTailoredDocuments } from "../tailored-documents";
import { createCandidateData, type CandidateData } from "./index";

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

const OFFER = {
  source: { url: "https://www.apec.fr/offre/daf" },
  title: "DAF H/F",
  content: "Nous recherchons un DAF pour un groupe industriel. Vous pilotez la consolidation IFRS sous SAP.",
  employer: "Acme Industrie",
  location: "Lyon",
  skills: ["IFRS", "SAP"],
};

/** What the fake AI Coach writes: a Tailored CV when asked for one, a Cover Letter otherwise. */
function writer(input: { system?: string; messages: { content: string }[] }): string {
  const asked = `${input.system ?? ""}\n${input.messages.map((message) => message.content).join("\n")}`;
  if (/"missing"/.test(asked)) {
    return "```json\n" + JSON.stringify({ headline: "DAF groupe industriel", summary: "", experience: [], education: [], skills: ["IFRS", "SAP"], languages: [], missing: [] }) + "\n```";
  }
  return "Madame, Monsieur,\n\nVotre offre a retenu toute mon attention.";
}

describe.skipIf(!connectionString)("Candidate data export and account deletion (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let applications: Applications;
  let tailoredCvs: ReturnType<typeof createTailoredCvs>;
  let tailoredDocuments: ReturnType<typeof createTailoredDocuments>;
  let candidateData: CandidateData;
  let candidateId: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function createProfile(owner: string, targetRole: string) {
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, locations: ["Lyon"] } });
    if (!created.ok) throw new Error("fixture Profile refused");
    return created.profile.id;
  }

  async function saveApplication(owner: string, profileId: string) {
    const captured = await jobOffers.capture(OFFER);
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    const saved = await applications.save(owner, { jobOfferId: captured.jobOffer.id, profileId });
    if (!saved.ok) throw new Error("fixture Application refused");
    return saved.application;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    // Every table: the export reaches all of the Candidate's data.
    await migrateDatabase({ database, baseURL: BASE_URL, secret: "test-secret-test-secret-test-secret-0123", mailer: { send: async () => {} } });
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    const ai = createAiLayer({ providers: [createFakeProvider({ id: "mistral", reply: writer })], routes: { writing: "mistral" }, usage: createMemoryUsageLog() });
    tailoredCvs = createTailoredCvs(database, { applications, profiles, ai });
    tailoredDocuments = createTailoredDocuments(database, { applications, profiles, ai });
    candidateData = createCandidateData(database, { profiles, applications, tailoredCvs, tailoredDocuments });
    candidateId = await signIn("marie.dupont@example.fr");
  }, 60_000); // A throwaway database each time: slow when the machine is busy.
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("the export holds the Candidate's account: email address and Interface Language", async () => {
    expect((await candidateData.export(candidateId)).account).toEqual({
      email: "marie.dupont@example.fr",
      name: expect.any(String),
      interfaceLanguage: "fr",
      createdAt: expect.any(Date),
      signInMethods: [],
      sessions: [expect.objectContaining({ createdAt: expect.any(Date) })],
      backOfficeRoles: [],
    });
  });

  it("the export holds the Back Office Roles the Candidate holds, not who granted them", async () => {
    await database.query(
      `INSERT INTO administrator_role (candidate_id, role, granted_by, granted_at) VALUES ($1, 'support', 'someone-else', '2026-10-01T08:00:00Z')`,
      [candidateId],
    );

    const exported = await candidateData.export(candidateId);

    expect(exported.account?.backOfficeRoles).toEqual([{ role: "support", grantedAt: new Date("2026-10-01T08:00:00Z") }]);
    expect(JSON.stringify(exported)).not.toContain("someone-else");
  });

  it("the export holds the Administrator's Back Office Assistant conversations with every message, not what the replies cost", async () => {
    const conversations = createAssistantConversations(database, {
      assistant: {
        reply: async () => ({
          ok: true,
          reply: "Premium : 4321 Match Scores par mois.",
          outcome: "replied",
          cost: { provider: "mistral", model: "secret-assistant-model", inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, eur: 0.001 },
          sections: ["planQuotas"],
        }),
      },
    });
    const sent = await conversations.send({ id: candidateId, access: backOfficeAccess(["support"]) }, { message: "Quotas Premium ?" });
    if (!sent.ok) throw new Error("fixture conversation refused");

    const exported = await candidateData.export(candidateId);

    expect(exported.backOfficeAssistantConversations).toEqual([
      {
        id: sent.conversation.id,
        title: "Quotas Premium ?",
        createdAt: expect.any(Date),
        lastMessageAt: expect.any(Date),
        messages: [
          { from: "administrator", text: "Quotas Premium ?", sentAt: expect.any(Date) },
          { from: "assistant", text: "Premium : 4321 Match Scores par mois.", sentAt: expect.any(Date) },
        ],
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain("secret-assistant-model");
  });

  it("the export holds every Profile with its Search Criteria and every version of its Master CV", async () => {
    const profileId = await createProfile(candidateId, "DAF");
    const edited = await profiles.saveMasterCv(candidateId, profileId, { basedOnVersion: 1, content: { ...masterCv, summary: "20 ans de finance." } });
    if (!edited?.ok) throw new Error("fixture edit refused");
    await profiles.archive(candidateId, await createProfile(candidateId, "Consultant transformation"));

    const exported = await candidateData.export(candidateId);

    expect(exported.profiles).toEqual([
      {
        id: profileId,
        name: "DAF",
        archived: false,
        searchCriteria: { targetRole: "DAF", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
        masterCvVersions: [
          expect.objectContaining({ version: 2, restoredFrom: null, content: { ...masterCv, summary: "20 ans de finance." } }),
          expect.objectContaining({ version: 1, restoredFrom: null, content: masterCv }),
        ],
        atsScore: null,
        jobSearches: [],
        jobDigest: null,
        jobDigests: [],
      },
      expect.objectContaining({ name: "Consultant transformation", archived: true, masterCvVersions: [expect.objectContaining({ version: 1 })] }),
    ]);
  });

  it("the export holds every Application with its Job Offer, Interviews and Tailored Documents", async () => {
    const profileId = await createProfile(candidateId, "DAF");
    const application = await saveApplication(candidateId, profileId);
    await jobOffers.summarize(application.jobOffer.id, async () => ({ summary: "Acme Industrie recrute son DAF." }));
    await applications.change(candidateId, application.id, { status: "interview" });
    await applications.addInterview(candidateId, application.id, {
      scheduledAt: "2026-11-12T14:30",
      note: "avec la DRH",
      durationMinutes: 45,
      format: "on_site",
      place: "12 rue de la Paix, Paris",
    });
    const proposed = await tailoredCvs.propose(candidateId, application.id, {});
    if (!proposed.ok) throw new Error(`fixture Tailored CV refused: ${JSON.stringify(proposed)}`);
    const { revision, changes } = proposed.tailoredCv.proposal!;
    await tailoredCvs.save(candidateId, application.id, { revision, accepted: changes.map((change) => change.id) });
    await tailoredDocuments.draft(candidateId, application.id, { document: "cover_letter" });
    await tailoredDocuments.edit(candidateId, application.id, { document: "cover_letter", text: "Madame, Monsieur, je postule." });

    const exported = await candidateData.export(candidateId);

    expect(exported.applications).toEqual([
      expect.objectContaining({
        id: application.id,
        status: "interview",
        profile: { id: profileId, name: "DAF" },
        jobOffer: expect.objectContaining({ title: "DAF H/F", employer: "Acme Industrie", summary: "Acme Industrie recrute son DAF." }),
        interviews: [
          expect.objectContaining({
            note: "avec la DRH",
            scheduledAt: new Date("2026-11-12T13:30:00Z"),
            durationMinutes: 45,
            format: "on_site",
            place: "12 rue de la Paix, Paris",
          }),
        ],
        tailoredDocuments: {
          documentLanguage: "fr",
          tailoredCv: expect.objectContaining({ content: expect.objectContaining({ headline: "DAF groupe industriel" }) }),
          tailoredCvProposal: null,
          coverLetter: expect.objectContaining({ text: "Madame, Monsieur, je postule." }),
          outreachMessage: null,
        },
      }),
    ]);
  });

  it("the export holds the Candidate's EU AI consent, dated, or null when they have not given it", async () => {
    expect((await candidateData.export(candidateId)).euAiConsent).toBeNull();
    const givenAt = await createEuAiConsents(database, { now: () => new Date("2026-09-01T08:00:00Z") }).give(candidateId);

    expect((await candidateData.export(candidateId)).euAiConsent).toEqual({ givenAt: new Date("2026-09-01T08:00:00Z") });
    expect(givenAt).toEqual(new Date("2026-09-01T08:00:00Z"));
  });

  it("the export holds the Follow-up Delays the Candidate set (null while they keep the defaults) and the Follow-ups sent on each Application", async () => {
    const application = await saveApplication(candidateId, await createProfile(candidateId, "DAF"));
    expect(await candidateData.export(candidateId)).toMatchObject({ followUpDelays: null, applications: [{ followUps: [] }] });
    const followUps = createFollowUps(database, { actionCards: createActionCards(database), applications, mailer: { send: async () => {} }, appUrl: BASE_URL });
    await followUps.setDelays(candidateId, { afterApplied: 5, afterFollowUp: 12 });
    // Sent when the Candidate accepts a Follow-up card or sets "Relancée".
    await database.query(`INSERT INTO follow_up_sent (application_id, sent_at) VALUES ($1, '2026-10-02T09:00:00Z'), ($1, '2026-09-20T09:00:00Z')`, [application.id]);

    const exported = await candidateData.export(candidateId);

    expect(exported.followUpDelays).toEqual({ afterApplied: 5, afterFollowUp: 12 });
    expect(exported.applications[0]!.followUps).toEqual([{ sentAt: new Date("2026-09-20T09:00:00Z") }, { sentAt: new Date("2026-10-02T09:00:00Z") }]);
  });

  it("the export holds every Action Card the AI Coach proposed, pending or decided, newest first", async () => {
    const profileId = await createProfile(candidateId, "DAF");
    const actionCards = createActionCards(database);
    const first = await actionCards.propose(candidateId, { kind: "ats_fix", title: "Ajoutez SAP", body: "Le mot-clé manque.", focus: { kind: "profile", id: profileId }, payload: { fix: "x" } });
    await actionCards.decide(candidateId, first.id, "dismiss");
    const second = await actionCards.propose(candidateId, { kind: "follow_up", title: "Relancez Acme", body: "Une semaine déjà.", focus: { kind: "profile", id: profileId }, payload: null });

    expect((await candidateData.export(candidateId)).actionCards).toEqual([
      { id: second.id, kind: "follow_up", title: "Relancez Acme", body: "Une semaine déjà.", focus: { kind: "profile", id: profileId }, payload: null, status: "pending", createdAt: expect.any(Date), decidedAt: null },
      expect.objectContaining({ id: first.id, title: "Ajoutez SAP", payload: { fix: "x" }, status: "dismissed", decidedAt: expect.any(Date) }),
    ]);
  });

  it("the export holds the Coach Memory the Candidate confirmed, oldest first", async () => {
    await database.query(`INSERT INTO coach_memory_item (candidate_id, kind, text, created_at) VALUES ($1, 'goal', 'Devenir DAF', now() - interval '1 day'), ($1, 'constraint', 'Pas de télétravail partiel', now())`, [candidateId]);

    expect((await candidateData.export(candidateId)).coachMemory).toEqual([
      { id: expect.any(String), kind: "goal", text: "Devenir DAF", createdAt: expect.any(Date), updatedAt: expect.any(Date) },
      expect.objectContaining({ kind: "constraint", text: "Pas de télétravail partiel" }),
    ]);
  });

  it("the export holds the AI Message Log of the Candidate's own AI calls, newest first, without what they cost; account deletion takes it", async () => {
    const other = await signIn("jean.martin@example.fr");
    const usage = createPostgresUsageLog(database);
    const pending: Promise<unknown>[] = [];
    let at = new Date("2026-10-16T08:00:00Z");
    const ai = createAiLayer({
      providers: [createFakeProvider({ id: "mistral", reply: "Bonjour Marie" })],
      routes: { coaching: "mistral" },
      usage: { record: (entry) => void pending.push(Promise.resolve(usage.record(entry))) },
      now: () => at,
    });
    await ai.generate({ task: "coaching", candidateId, system: "Tu es le coach.", prompt: "Bonjour" });
    at = new Date("2026-10-17T08:00:00Z");
    await ai.generate({ task: "coaching", candidateId, prompt: "Merci" });
    await ai.generate({ task: "coaching", candidateId: other, prompt: "Pas à Marie" });
    await Promise.all(pending);

    expect((await candidateData.export(candidateId)).aiMessageLog).toEqual([
      { id: expect.any(String), at: new Date("2026-10-17T08:00:00Z"), task: "coaching", provider: "mistral", model: "fake-mistral", outcome: "ok", reason: null, warnings: [], system: null, messages: [{ role: "user", content: "Merci" }], reply: "Bonjour Marie" },
      expect.objectContaining({ at: new Date("2026-10-16T08:00:00Z"), system: "Tu es le coach.", messages: [{ role: "user", content: "Bonjour" }] }),
    ]);

    await candidateData.delete(candidateId);

    const { rows } = await database.query(`SELECT candidate_id FROM ai_message_log`);
    expect(rows).toEqual([{ candidate_id: other }]);
  });

  it("the export holds a failed AI call's Outcome, Failure Reason code and wording, never its technical reason (#259)", async () => {
    const usage = createPostgresUsageLog(database);
    const pending: Promise<unknown>[] = [];
    const ai = createAiLayer({
      providers: [createFakeProvider({ id: "mistral", fail: new AiProviderError("mistral", "HTTP 503 upstream connect error, prompt « Bonjour »", 503) })],
      routes: { coaching: "mistral" },
      usage: { record: (entry) => void pending.push(Promise.resolve(usage.record(entry))) },
    });
    await expect(ai.generate({ task: "coaching", candidateId, prompt: "Bonjour" })).rejects.toThrow();
    await Promise.all(pending);

    const [log] = (await candidateData.export(candidateId)).aiMessageLog;
    expect(log).toMatchObject({ outcome: "failed", reason: { code: "provider_unavailable", wording: "Fournisseur indisponible" }, reply: null });
    expect(log).not.toHaveProperty("technicalReason");
    // Its id and time are left out: a random id or a time's milliseconds may hold "503".
    expect(JSON.stringify({ ...log, id: null, at: null })).not.toMatch(/AiProviderError|upstream connect error|503/);
  });

  it("the export holds an AI call's warnings, code and wording, never what happened (#260)", async () => {
    const usage = createPostgresUsageLog(database);
    const pending: Promise<unknown>[] = [];
    const ai = createAiLayer({
      providers: [createFakeProvider({ id: "mistral" })],
      routes: { coaching: "mistral" },
      usage: { record: (entry) => void pending.push(Promise.resolve(usage.record(entry))) },
    });
    await ai.generate({ task: "coaching", candidateId, prompt: "Bonjour", warnings: [{ reason: "playbook_agent_skipped", detail: "Playbook Agent negociation v2 left out (AiProviderError)" }] });
    await Promise.all(pending);

    const [log] = (await candidateData.export(candidateId)).aiMessageLog;
    expect(log).toMatchObject({
      outcome: "warning",
      reason: { code: "playbook_agent_skipped", wording: "Playbook Agent laissé de côté : réponse sans son avis" },
      warnings: [{ code: "playbook_agent_skipped", wording: "Playbook Agent laissé de côté : réponse sans son avis" }],
    });
    expect(JSON.stringify(log)).not.toContain("negociation v2");
  });

  it("the export holds each Profile's ATS Score, or null when its Master CV was never scored", async () => {
    const scoredId = await createProfile(candidateId, "DAF");
    await createProfile(candidateId, "DSI");
    const analysed = await createAtsScoring({ database, profiles, actionCards: createActionCards(database) }).analyse(candidateId, scoredId, "fr");
    if (!analysed.ok) throw new Error("fixture ATS Score refused");

    const exported = await candidateData.export(candidateId);

    expect(exported.profiles.map((profile) => profile.atsScore)).toEqual([
      { version: 1, score: analysed.atsScore.score, computedAt: analysed.atsScore.computedAt },
      null,
    ]);
    expect(analysed.atsScore.score).toMatchObject({ score: expect.any(Number) });
  });

  it("the export holds each Profile's Job Searches with the Job Offers they found, newest first", async () => {
    const profileId = await createProfile(candidateId, "DAF");
    const captured = await jobOffers.capture(OFFER);
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    // Started from the Profile page, finished by Job discovery.
    await database.query(
      `INSERT INTO job_search (candidate_id, profile_id, status, job_offer_ids, failure, started_at, finished_at) VALUES
         ($1, $2, 'done', ARRAY[$3::uuid], NULL, '2026-10-01T08:00:00Z', '2026-10-01T08:04:00Z'),
         ($1, $2, 'failed', '{}', 'timeout', '2026-10-05T08:00:00Z', '2026-10-05T08:15:00Z')`,
      [candidateId, profileId, captured.jobOffer.id],
    );

    expect((await candidateData.export(candidateId)).profiles[0]!.jobSearches).toEqual([
      { id: expect.any(String), status: "failed", failure: "timeout", startedAt: new Date("2026-10-05T08:00:00Z"), finishedAt: new Date("2026-10-05T08:15:00Z"), jobOfferIds: [] },
      { id: expect.any(String), status: "done", failure: null, startedAt: new Date("2026-10-01T08:00:00Z"), finishedAt: new Date("2026-10-01T08:04:00Z"), jobOfferIds: [captured.jobOffer.id] },
    ]);
  });

  it("the export holds each Profile's Job Digest settings and the Job Digests sent, but not the secret unsubscribe link", async () => {
    const profileId = await createProfile(candidateId, "DAF");
    const otherProfileId = await createProfile(candidateId, "DSI");
    const captured = await jobOffers.capture(OFFER);
    if (!captured.ok) throw new Error("fixture Job Offer refused");
    // Opted in to a daily Job Digest, one sent, then opted out.
    await database.query(
      `INSERT INTO job_digest_subscription (profile_id, candidate_id, unsubscribe_token, subscribed_at, last_run_at, unsubscribed_at, frequency)
       VALUES ($2, $1, 'secret-unsubscribe-token', '2026-09-01T06:00:00Z', '2026-09-02T06:00:00Z', '2026-09-10T12:00:00Z', 'daily')`,
      [candidateId, profileId],
    );
    await database.query(`INSERT INTO job_digest (profile_id, candidate_id, job_offer_ids, sent_at) VALUES ($2, $1, ARRAY[$3::uuid], '2026-09-02T06:00:00Z')`, [
      candidateId,
      profileId,
      captured.jobOffer.id,
    ]);

    const exported = await candidateData.export(candidateId);

    expect(exported.profiles.find((profile) => profile.id === profileId)).toMatchObject({
      jobDigest: { frequency: "daily", subscribedAt: new Date("2026-09-01T06:00:00Z"), unsubscribedAt: new Date("2026-09-10T12:00:00Z"), lastRunAt: new Date("2026-09-02T06:00:00Z") },
      jobDigests: [{ id: expect.any(String), sentAt: new Date("2026-09-02T06:00:00Z"), jobOfferIds: [captured.jobOffer.id] }],
    });
    expect(exported.profiles.find((profile) => profile.id === otherProfileId)).toMatchObject({ jobDigest: null, jobDigests: [] });
    expect(JSON.stringify(exported)).not.toContain("secret-unsubscribe-token");
  });

  it("the export holds every Coach Conversation with all its messages, the Candidate's and the AI Coach's, blocked ones marked (#228), but not what each reply cost", async () => {
    const profileId = await createProfile(candidateId, "DAF");
    let replies = 0;
    const cost = { provider: "mistral" as const, model: "secret-model-name", inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, eur: 0.01 };
    const conversations = createCoachConversations(database, {
      coach: {
        reply: async () => ({
          ok: true,
          reply: `Réponse ${++replies}`,
          outcome: replies === 3 ? "blocked_message" : "replied",
          cost,
          playbooks: [],
          consultations: [{ playbookId: "interview-psychology", version: 1, ...cost, model: "secret-agent-model" }],
        }),
      },
      profiles,
    });
    const first = await conversations.send(candidateId, { message: "Comment relancer Acme ?", focus: { kind: "profile", id: profileId } });
    if (!first.ok) throw new Error("fixture Coach Conversation refused");
    await conversations.send(candidateId, { conversationId: first.conversation.id, message: "Et après une semaine ?" });
    const second = await conversations.send(candidateId, { message: "Bonjour" });
    if (!second.ok) throw new Error("fixture Coach Conversation refused");

    const exported = await candidateData.export(candidateId);

    expect(exported.coachConversations).toEqual([
      {
        id: second.conversation.id,
        title: "Bonjour",
        profile: null,
        createdAt: expect.any(Date),
        lastMessageAt: expect.any(Date),
        messages: [
          { from: "candidate", text: "Bonjour", blocked: true, sentAt: expect.any(Date) },
          { from: "coach", text: "Réponse 3", blocked: true, sentAt: expect.any(Date) },
        ],
      },
      expect.objectContaining({
        id: first.conversation.id,
        profile: { id: profileId, name: "DAF" },
        messages: [
          { from: "candidate", text: "Comment relancer Acme ?", sentAt: expect.any(Date) },
          { from: "coach", text: "Réponse 1", sentAt: expect.any(Date) },
          { from: "candidate", text: "Et après une semaine ?", sentAt: expect.any(Date) },
          { from: "coach", text: "Réponse 2", sentAt: expect.any(Date) },
        ],
      }),
    ]);
    expect(JSON.stringify(exported)).not.toContain("secret-model-name");
    expect(JSON.stringify(exported)).not.toContain("secret-agent-model");
  });

  it("the export holds the Coach Access the Candidate granted, the Coaching Sessions they paid with their date, duration, video link and note, and the Coach Reviews of their Applications, naming each Human Coach but not their email or booking link", async () => {
    const application = await saveApplication(candidateId, await createProfile(candidateId, "DAF"));
    await tailoredDocuments.draft(candidateId, application.id, { document: "cover_letter" });
    const humanCoaches = createHumanCoaches(database, { profiles, applications, tailoredDocuments, tailoredCvs });
    const added = await humanCoaches.add({ name: "Sophie Martin", email: "sophie.coach@example.fr", bookingUrl: "https://cal.com/sophie/seance", bio: "" });
    if (!added.ok) throw new Error("fixture Human Coach refused");
    const coach = added.coach;
    await humanCoaches.grantAccess(candidateId, coach.id);
    await humanCoaches.recordPaidSession({ checkoutSessionId: "cs_test_1", candidateId, coachId: coach.id, amount: 9000, currency: "eur" });
    const [session] = await humanCoaches.sessions(candidateId);
    await humanCoaches.scheduleSession(candidateId, session!.id, { scheduledAt: "2026-10-22T14:30", durationMinutes: 60, videoLink: "https://meet.google.com/abc-defg-hij", note: "Préparer mon pitch." });
    const reviewed = await humanCoaches.review(coach.id, candidateId, application.id, { document: "cover_letter", text: "Ouvrez sur votre dernier poste." });
    if (!reviewed.ok) throw new Error("fixture Coach Review refused");

    const exported = await candidateData.export(candidateId);

    expect(exported.coachAccess).toEqual([{ coach: { id: coach.id, name: "Sophie Martin" }, grantedAt: expect.any(Date) }]);
    expect(exported.coachingSessions).toEqual([
      {
        id: session!.id,
        coach: { id: coach.id, name: "Sophie Martin" },
        amount: 9000,
        currency: "eur",
        paidAt: expect.any(Date),
        scheduledAt: new Date("2026-10-22T12:30:00.000Z"),
        durationMinutes: 60,
        videoLink: "https://meet.google.com/abc-defg-hij",
        note: "Préparer mon pitch.",
        changedBy: "candidate",
      },
    ]);
    expect(exported.applications[0]!.coachReviews).toEqual([
      { id: reviewed.review.id, coach: { id: coach.id, name: "Sophie Martin" }, document: "cover_letter", text: "Ouvrez sur votre dernier poste.", createdAt: expect.any(Date) },
    ]);
    expect(JSON.stringify(exported)).not.toContain("sophie.coach@example.fr");
    expect(JSON.stringify(exported)).not.toContain("https://cal.com/sophie/seance");
  });

  it("the export holds the Enriched Contacts obtained for each Application, revealed or only found, with where they come from", async () => {
    const application = await saveApplication(candidateId, await createProfile(candidateId, "DAF"));
    // Found through the configured provider, one of them revealed.
    await database.query(
      `INSERT INTO enriched_contact (application_id, provider, provider_person_id, name, job_title, emails, phones, found_at, retrieved_at) VALUES
         ($1, 'lusha', 'provider-person-1', 'Claire Durand', 'DRH', ARRAY['claire.durand@acme.fr'], ARRAY['+33 6 12 34 56 78'], '2026-10-01T09:00:00Z', '2026-10-01T09:05:00Z'),
         ($1, 'lusha', 'provider-person-2', 'Luc Bernard', NULL, '{}', '{}', '2026-10-01T09:00:01Z', NULL)`,
      [application.id],
    );

    expect((await candidateData.export(candidateId)).applications[0]!.enrichedContacts).toEqual([
      {
        id: expect.any(String),
        name: "Claire Durand",
        jobTitle: "DRH",
        emails: ["claire.durand@acme.fr"],
        phones: ["+33 6 12 34 56 78"],
        provider: "lusha",
        foundAt: new Date("2026-10-01T09:00:00Z"),
        retrievedAt: new Date("2026-10-01T09:05:00Z"),
      },
      { id: expect.any(String), name: "Luc Bernard", jobTitle: null, emails: [], phones: [], provider: "lusha", foundAt: new Date("2026-10-01T09:00:01Z"), retrievedAt: null },
    ]);
  });

  it("the export holds each Application's Match Score, whether the Candidate reported its Job Offer unavailable, and its Company Dossier", async () => {
    const application = await saveApplication(candidateId, await createProfile(candidateId, "DAF"));
    await applications.change(candidateId, application.id, { reportedUnavailable: true });
    // Built from the Application page, for the employer the Candidate confirmed.
    await database.query(
      `INSERT INTO company_dossier (application_id, awaiting_confirmation, confirmed_employer, dossier) VALUES ($1, false, 'Acme Industrie SA', $2)`,
      [
        application.id,
        {
          source: "web",
          reliability: "less_reliable",
          employer: "Acme Industrie SA",
          builtAt: "2026-10-01T09:00:00.000Z",
          suggestedContactRoles: [],
          sources: [],
          news: [{ title: "Acme Industrie ouvre une usine", outlet: "Les Echos", publishedAt: "2026-09-01", url: "https://news.example/usine" }],
        },
      ],
    );

    const [exported] = (await candidateData.export(candidateId)).applications;

    expect(exported).toMatchObject({
      matchScore: application.matchScore,
      reportedUnavailableAt: expect.any(Date),
      companyDossier: {
        presumedEmployer: null,
        presumedEmployerDescription: null,
        agency: null,
        confirmedEmployer: "Acme Industrie SA",
        // With its Company News.
        dossier: expect.objectContaining({ source: "web", employer: "Acme Industrie SA", news: [expect.objectContaining({ url: "https://news.example/usine" })] }),
        updatedAt: expect.any(Date),
      },
    });
    expect(application.matchScore).toMatchObject({ score: expect.any(Number) });
  });

  it("the export holds the Candidate's Plan and how much of each Plan Quota they used, but not their Stripe identifiers", async () => {
    expect(await candidateData.export(candidateId)).toMatchObject({ plan: null, quotaUsage: [] });
    // Set from Stripe's signed webhooks; counted as the Candidate uses the app.
    await database.query(
      `INSERT INTO candidate_plan (candidate_id, plan, stripe_customer_id, stripe_subscription_id, stripe_status, charged, ends_at)
       VALUES ($1, 'standard', 'cus_secret_customer', 'sub_secret_subscription', 'active', true, '2026-11-30T00:00:00Z')`,
      [candidateId],
    );
    await database.query(`INSERT INTO quota_usage (candidate_id, quota, week, used) VALUES ($1, 'matchScores', '2026-09', 4), ($1, 'atsScores', '2026-10-12', 2)`, [candidateId]);

    const exported = await candidateData.export(candidateId);

    expect(exported.plan).toEqual({ plan: "standard", subscriptionStatus: "active", endsAt: new Date("2026-11-30T00:00:00Z") });
    expect(exported.quotaUsage).toEqual([
      { quota: "atsScores", week: "2026-10-12", used: 2 },
      { quota: "matchScores", week: "2026-09", used: 4 },
    ]);
    expect(JSON.stringify(exported)).not.toMatch(/cus_secret_customer|sub_secret_subscription/);
  });

  it("the export holds how the Candidate signs in and their sign-in sessions, but no token or password", async () => {
    // Linked when the Candidate signs in with Google.
    await database.query(
      `INSERT INTO account (id, "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", password, "createdAt", "updatedAt")
       VALUES ('acc-1', 'google-sub-1', 'google', $1, 'secret-access-token', 'secret-refresh-token', 'secret-id-token', 'secret-password-hash', '2026-09-01T08:00:00Z', now())`,
      [candidateId],
    );
    const { rows: sessions } = await database.query<{ token: string }>(`SELECT token FROM session WHERE "userId" = $1`, [candidateId]);

    const exported = await candidateData.export(candidateId);

    expect(exported.account).toMatchObject({
      signInMethods: [{ provider: "google", linkedAt: new Date("2026-09-01T08:00:00Z") }],
      sessions: [{ createdAt: expect.any(Date), expiresAt: expect.any(Date), ipAddress: "127.0.0.1", userAgent: expect.any(String) }],
    });
    expect(sessions).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toMatch(/secret-|google-sub-1/);
    expect(JSON.stringify(exported)).not.toContain(sessions[0]!.token);
  });

  it("deleting the account removes the Candidate and everything of theirs, signs them out, and keeps the Job Offers", async () => {
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const application = await saveApplication(candidateId, await createProfile(candidateId, "DAF"));
    await tailoredDocuments.draft(candidateId, application.id, { document: "cover_letter" });
    const other = await signIn("paul.martin@example.fr");
    const othersApplication = await saveApplication(other, await createProfile(other, "DSI"));

    await candidateData.delete(candidateId);

    expect(await candidateData.export(candidateId)).toMatchObject({ account: null, profiles: [], applications: [] });
    expect(await (await testAuth.request("/api/auth/get-session", { cookie })).json()).toBeNull();
    expect(await jobOffers.get(application.jobOffer.id)).toMatchObject({ title: "DAF H/F" });
    expect(await applications.get(other, othersApplication.id)).toMatchObject({ jobOffer: { id: application.jobOffer.id } });
    const { rows } = await database.query("SELECT 1 FROM candidate WHERE id = $1", [candidateId]);
    expect(rows).toEqual([]);
  });

  it("signing up again with the same email after deletion starts an empty account", async () => {
    await createProfile(candidateId, "DAF");
    await candidateData.delete(candidateId);

    const again = await signIn("marie.dupont@example.fr");

    expect(again).not.toBe(candidateId);
    expect(await candidateData.export(again)).toMatchObject({ profiles: [], applications: [] });
  });

  it("an Administrator's export holds nothing of the Back Office Audit, and deleting their account keeps its entries, with the email they had", async () => {
    const humanCoaches = createHumanCoaches(database, { profiles, applications, tailoredDocuments, tailoredCvs });
    const backOffice = createBackOffice(database, { billing: createBilling({ database, baseURL: BASE_URL }), humanCoaches });
    const before = await candidateData.export(candidateId);
    await backOffice.setPlanQuotas({ id: candidateId, email: "marie.dupont@example.fr" }, "standard", { ...STARTING_PLAN_QUOTAS.standard, matchScores: 77 });

    const after = await candidateData.export(candidateId);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);

    await candidateData.delete(candidateId);

    expect(await backOffice.journal()).toMatchObject([
      { actor: { candidateId: null, email: "marie.dupont@example.fr" }, section: "plan_quotas", target: "standard", after: { matchScores: 77 } },
    ]);
  });

  it("the account is not deleted when its billing cannot be closed, so a paying Candidate is never left charged without an account", async () => {
    const refusing = createCandidateData(database, {
      profiles,
      applications,
      tailoredCvs,
      tailoredDocuments,
      billing: { closeAccount: async () => Promise.reject(new Error("Stripe is down")) },
    });
    await createProfile(candidateId, "DAF");

    await expect(refusing.delete(candidateId)).rejects.toThrow("Stripe is down");

    expect((await candidateData.export(candidateId)).profiles).toHaveLength(1);
  });

  it("the export holds nothing of another Candidate", async () => {
    const other = await signIn("paul.martin@example.fr");
    await saveApplication(other, await createProfile(other, "DSI"));

    expect(await candidateData.export(candidateId)).toMatchObject({ profiles: [], applications: [] });
  });
});

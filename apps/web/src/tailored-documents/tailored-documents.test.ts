import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createTailoredDocuments, migrateTailoredDocuments, type CompanyDossierSource, type TailoredDocuments } from "./index";

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

const FRENCH_OFFER = {
  source: { url: "https://www.apec.fr/offre/1" },
  title: "DAF H/F",
  content: "Nous recherchons un DAF pour un groupe industriel. Vous avez 15 ans d'expérience dans la finance et vous pilotez la consolidation.",
  employer: "Acme Industrie",
  location: "Lyon",
};
const ENGLISH_OFFER = {
  source: { url: "https://jobs.example.com/cfo" },
  title: "Chief Financial Officer",
  content: "We are looking for a CFO who will lead our finance team. You have 15 years of experience and you are fluent in French.",
  employer: "Globex Ltd",
};

/** What the fake AI Coach writes: a letter for a plain prompt, a JSON outreach message when asked for one. */
function writer(input: { system?: string }): string {
  if (input.system?.includes('"subject"')) return '```json\n{"subject": "Candidature DAF", "text": "Bonjour, je me permets de vous contacter."}\n```';
  return "Madame, Monsieur,\n\nVotre offre a retenu toute mon attention.";
}

describe.skipIf(!connectionString)("Cover Letter and Outreach Message drafts (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let provider: FakeProvider;
  let dossiers: Map<string, Awaited<ReturnType<CompanyDossierSource["get"]>>>;
  let documents: TailoredDocuments;
  let candidateId: string;
  let otherCandidateId: string;
  let applicationId: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function saveApplication(offer: Parameters<JobOffers["capture"]>[0], owner = candidateId) {
    const profile = await profiles.create(owner, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    const captured = await jobOffers.capture(offer);
    if (!profile.ok || !captured.ok) throw new Error("fixture refused");
    const applications = createApplications(testAuth.auth.options.database as Pool, { jobOffers, profiles });
    const saved = await applications.save(owner, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    return saved.application.id;
  }

  /** The system prompt and the prompt of the last call made to the AI layer. */
  function lastCall() {
    const call = provider.calls.at(-1)!;
    return { system: call.system ?? "", prompt: call.messages.map((message) => message.content).join("\n") };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    const database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateTailoredDocuments(database);
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    provider = createFakeProvider({ id: "mistral", reply: writer });
    const ai = createAiLayer({ providers: [provider], routes: { writing: "mistral" }, usage: createMemoryUsageLog() });
    dossiers = new Map();
    const companyDossiers: CompanyDossierSource = { get: async (owner, id) => (owner === candidateId ? (dossiers.get(id) ?? null) : null) };
    const applications = createApplications(database, { jobOffers, profiles });
    documents = createTailoredDocuments(database, { applications, profiles, ai, companyDossiers });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    applicationId = await saveApplication(FRENCH_OFFER);
  }, 60_000); // A throwaway database each time: slow when the machine is busy.
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("an Application has no drafts until the AI Coach writes them", async () => {
    expect(await documents.get(candidateId, applicationId)).toEqual({ documentLanguage: "fr", coverLetter: null, outreachMessage: null });
  });

  it("the AI Coach drafts a Cover Letter from the Profile's Master CV and the Job Offer, stored on the Application", async () => {
    const result = await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    expect(result).toMatchObject({
      ok: true,
      drafts: { coverLetter: { text: "Madame, Monsieur,\n\nVotre offre a retenu toute mon attention.", language: "fr" }, outreachMessage: null },
    });
    expect(provider.calls).toHaveLength(1);
    const { prompt } = lastCall();
    expect(prompt).toContain("Consolidation IFRS.");
    expect(prompt).toContain("DAF H/F");
    expect((await documents.get(candidateId, applicationId))?.coverLetter?.text).toBe("Madame, Monsieur,\n\nVotre offre a retenu toute mon attention.");
  });

  it("drafts are written in the Job Offer's language by default", async () => {
    const english = await saveApplication(ENGLISH_OFFER);

    const result = await documents.draft(candidateId, english, { document: "cover_letter" });

    expect(result).toMatchObject({ ok: true, drafts: { documentLanguage: "en", coverLetter: { language: "en" } } });
    expect(lastCall().system).toContain("in English");
  });

  it("the Candidate can choose another Document Language, which the Application keeps for its next drafts", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter", language: "en" });
    expect(lastCall().system).toContain("in English");

    const result = await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    expect(result).toMatchObject({ ok: true, drafts: { documentLanguage: "en", coverLetter: { language: "en" } } });
    expect(lastCall().system).toContain("in English");
  });

  it("the AI Coach drafts an Outreach Message as an email by default, with its subject, stored on the Application", async () => {
    const result = await documents.draft(candidateId, applicationId, { document: "outreach_message" });

    expect(result).toMatchObject({
      ok: true,
      drafts: { outreachMessage: { channel: "email", subject: "Candidature DAF", text: "Bonjour, je me permets de vous contacter.", language: "fr" } },
    });
    expect((await documents.get(candidateId, applicationId))?.outreachMessage).toMatchObject({ channel: "email", subject: "Candidature DAF" });
  });

  it("an Outreach Message can be drafted as a LinkedIn InMail, kept short", async () => {
    const result = await documents.draft(candidateId, applicationId, { document: "outreach_message", channel: "inmail" });

    expect(result).toMatchObject({ ok: true, drafts: { outreachMessage: { channel: "inmail" } } });
    expect(lastCall().system).toContain("InMail");
  });

  it("a reply the AI Coach did not shape as asked still gives an Outreach Message, with no subject", async () => {
    provider = createFakeProvider({ id: "mistral", reply: "Bonjour, je me permets de vous écrire." });
    const ai = createAiLayer({ providers: [provider], routes: { writing: "mistral" }, usage: createMemoryUsageLog() });
    const database = testAuth.auth.options.database as Pool;
    documents = createTailoredDocuments(database, { applications: createApplications(database, { jobOffers, profiles }), profiles, ai });

    const result = await documents.draft(candidateId, applicationId, { document: "outreach_message" });

    expect(result).toMatchObject({ ok: true, drafts: { outreachMessage: { subject: "", text: "Bonjour, je me permets de vous écrire." } } });
  });

  it("drafts draw on the Company Dossier and address the Outreach Message to its Suggested Contact Roles when one is built", async () => {
    dossiers.set(applicationId, {
      status: "built",
      dossier: {
        employer: "Acme Industrie",
        source: "french_register",
        name: "ACME INDUSTRIE",
        activity: "Fabrication de machines agricoles",
        headcount: { min: 250, max: 499 },
        builtAt: new Date("2026-10-01T10:00:00Z"),
        suggestedContactRoles: ["hr_director", "hiring_manager"],
      },
    });

    const letter = await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    expect(lastCall().prompt).toContain("Fabrication de machines agricoles");

    const message = await documents.draft(candidateId, applicationId, { document: "outreach_message" });
    expect(lastCall().prompt).toContain("Fabrication de machines agricoles");
    expect(lastCall().prompt).toContain("Directeur ou directrice des ressources humaines");
    expect(letter.ok && message.ok).toBe(true);
    expect(message).toMatchObject({
      ok: true,
      drafts: { outreachMessage: { contactRoles: ["Directeur ou directrice des ressources humaines", "Responsable du poste à pourvoir"] } },
    });
  });

  it("without a built Company Dossier, drafts are written from the Master CV and the Job Offer alone", async () => {
    dossiers.set(applicationId, { status: "awaiting_confirmation" });

    const result = await documents.draft(candidateId, applicationId, { document: "outreach_message" });

    expect(lastCall().prompt).not.toContain("Dossier");
    expect(result).toMatchObject({ ok: true, drafts: { outreachMessage: { contactRoles: [] } } });
  });

  it("the Candidate edits a draft; the edit is kept on the Application", async () => {
    await documents.draft(candidateId, applicationId, { document: "outreach_message" });

    const result = await documents.edit(candidateId, applicationId, { document: "outreach_message", subject: "Ma candidature", text: "  Bonjour Madame,\n\nJe vous écris.  " });

    expect(result).toMatchObject({ ok: true, drafts: { outreachMessage: { subject: "Ma candidature", text: "Bonjour Madame,\n\nJe vous écris.", channel: "email" } } });
    expect((await documents.get(candidateId, applicationId))?.outreachMessage?.text).toBe("Bonjour Madame,\n\nJe vous écris.");
  });

  it("a draft cannot be edited to nothing, nor before the AI Coach has written it", async () => {
    expect(await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma lettre" })).toEqual({ ok: false, error: "not_found" });
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    expect(await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "   " })).toEqual({
      ok: false,
      errors: [{ field: "text", code: "required" }],
    });
  });

  it("drafting again replaces the stored draft, edits included", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma version" });

    const result = await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    expect(result).toMatchObject({ ok: true, drafts: { coverLetter: { text: "Madame, Monsieur,\n\nVotre offre a retenu toute mon attention." } } });
  });

  it("another Candidate's Application has no drafts to read, write or edit", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    expect(await documents.get(otherCandidateId, applicationId)).toBeNull();
    expect(await documents.draft(otherCandidateId, applicationId, { document: "cover_letter" })).toEqual({ ok: false, error: "not_found" });
    expect(await documents.edit(otherCandidateId, applicationId, { document: "cover_letter", text: "Piraté" })).toEqual({ ok: false, error: "not_found" });
    expect(provider.calls).toHaveLength(1);
    expect((await documents.get(candidateId, applicationId))?.coverLetter?.text).toContain("Votre offre");
  });

  it("when the AI Coach cannot write, nothing is changed and the Candidate can try again later", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma version" });
    provider.generate = async () => {
      throw new Error("provider down");
    };

    expect(await documents.draft(candidateId, applicationId, { document: "cover_letter", language: "en" })).toEqual({ ok: false, error: "unavailable" });
    expect(await documents.get(candidateId, applicationId)).toMatchObject({ documentLanguage: "fr", coverLetter: { text: "Ma version" } });
  });

  it("an unknown document or channel is refused", async () => {
    expect(await documents.draft(candidateId, applicationId, { document: "cv" })).toEqual({ ok: false, errors: [{ field: "document", code: "invalid" }] });
    expect(await documents.draft(candidateId, applicationId, { document: "outreach_message", channel: "sms" })).toEqual({
      ok: false,
      errors: [{ field: "channel", code: "invalid" }],
    });
  });
});

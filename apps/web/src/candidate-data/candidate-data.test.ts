import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createTailoredCvs, migrateTailoredCvs } from "../tailored-cv";
import { createTailoredDocuments, migrateTailoredDocuments } from "../tailored-documents";
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
    const created = await profiles.create(owner, { masterCv, searchCriteria: { targetRole, location: "Lyon" } });
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
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateTailoredDocuments(database);
    await migrateTailoredCvs(database);
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
        searchCriteria: { targetRole: "DAF", location: "Lyon" },
        masterCvVersions: [
          expect.objectContaining({ version: 2, restoredFrom: null, content: { ...masterCv, summary: "20 ans de finance." } }),
          expect.objectContaining({ version: 1, restoredFrom: null, content: masterCv }),
        ],
      },
      expect.objectContaining({ name: "Consultant transformation", archived: true, masterCvVersions: [expect.objectContaining({ version: 1 })] }),
    ]);
  });

  it("the export holds every Application with its Job Offer, Interviews and Tailored Documents", async () => {
    const profileId = await createProfile(candidateId, "DAF");
    const application = await saveApplication(candidateId, profileId);
    await applications.change(candidateId, application.id, { status: "interview" });
    await applications.addInterview(candidateId, application.id, { scheduledAt: "2026-11-12T14:30", note: "avec la DRH" });
    const proposed = await tailoredCvs.propose(candidateId, application.id, {});
    if (!proposed.ok) throw new Error(`fixture Tailored CV refused: ${JSON.stringify(proposed)}`);
    await tailoredCvs.save(candidateId, application.id, { revision: proposed.tailoredCv.proposal!.revision });
    await tailoredDocuments.draft(candidateId, application.id, { document: "cover_letter" });
    await tailoredDocuments.edit(candidateId, application.id, { document: "cover_letter", text: "Madame, Monsieur, je postule." });

    const exported = await candidateData.export(candidateId);

    expect(exported.applications).toEqual([
      expect.objectContaining({
        id: application.id,
        status: "interview",
        profile: { id: profileId, name: "DAF" },
        jobOffer: expect.objectContaining({ title: "DAF H/F", employer: "Acme Industrie" }),
        interviews: [expect.objectContaining({ note: "avec la DRH", scheduledAt: new Date("2026-11-12T13:30:00Z") })],
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

  it("the export holds nothing of another Candidate", async () => {
    const other = await signIn("paul.martin@example.fr");
    await saveApplication(other, await createProfile(other, "DSI"));

    expect(await candidateData.export(candidateId)).toMatchObject({ profiles: [], applications: [] });
  });
});

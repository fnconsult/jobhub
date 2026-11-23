/**
 * Private Coach Notes stay out of the AI Coach's reach (ADR-0114, ADR-0098): the Candidate does not see them, so neither
 * does the AI Coach. Its reads give an Application's Coach Reviews, never a note its Human Coach keeps for themselves.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createAiLayer, createProvenanceRecorder } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateCoachWorkspace } from "../coach-space/workspace";
import { createHumanCoaches, migrateHumanCoaches } from "../human-coaches";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { createProfiles, migrateProfiles } from "../profiles";
import type { ApplicationDrafts } from "../tailored-documents";
import { candidateObjects } from "./candidate-objects";
import { createCoachActions } from "./index";
import { readCoachActions } from "./reads";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: ["IFRS"],
  languages: [],
};

const PRIVATE_NOTE = "Note privée : Marie hésite à quitter Lyon, ne pas lui en parler.";

describe("the AI Coach's code never reaches Private Coach Notes (ADR-0114)", () => {
  it("no Coach Action nor the Coach context imports the Coach space's private workspace or names its table", () => {
    const directories = [join(__dirname), join(__dirname, "../coach")];
    const sources = directories.flatMap((directory) =>
      readdirSync(directory)
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
        .map((file) => ({ file, text: readFileSync(join(directory, file), "utf8") })),
    );

    expect(sources.length).toBeGreaterThan(10);
    for (const { file, text } of sources) {
      expect([file, /coach-space\/workspace/.test(text)]).toEqual([file, false]);
      expect([file, /private_coach_note/.test(text)]).toEqual([file, false]);
    }
  });
});

describe.skipIf(!connectionString)("read_coach_reviews, on Postgres: a Private Coach Note is never read (ADR-0114, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateHumanCoaches(database);
    await migrateCoachWorkspace(database);
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("gives the Coach Review of the Candidate's Application and nothing of the note its Human Coach wrote about her", async () => {
    const profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    const applications = createApplications(database, { jobOffers, profiles });
    const letter: ApplicationDrafts = {
      documentLanguage: "fr",
      coverLetter: { language: "fr", text: "Madame, Monsieur,", draftedAt: new Date(), updatedAt: new Date(), provenance: null },
      outreachMessage: null,
    };
    const coaches = createHumanCoaches(database, {
      profiles,
      applications,
      tailoredDocuments: { get: async () => letter },
      tailoredCvs: { get: async () => null },
      tailoredDocumentVersions: { list: async () => ({ tailored_cv: [], cover_letter: [], outreach_message: [] }) },
    });
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    const marie = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
    const profile = await profiles.create(marie, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
    const captured = await jobOffers.capture({ source: { url: "https://www.apec.fr/offre/1" }, title: "DAF H/F", content: "Un DAF pour un groupe industriel.", employer: "Acme Industrie" });
    if (!profile.ok || !captured.ok) throw new Error("fixture refused");
    const saved = await applications.save(marie, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    const added = await coaches.add({ name: "Sophie Martin", email: "sophie.martin@rh-conseil.fr", bookingUrl: "https://cal.com/sophie-martin/seance" });
    if (!saved.ok || !added.ok) throw new Error("fixture refused");
    await coaches.grantAccess(marie, added.coach.id);
    expect(await coaches.review(added.coach.id, marie, saved.application.id, { document: "cover_letter", text: "Ouvrez sur votre dernier poste." })).toMatchObject({ ok: true });
    // The note the Human Coach keeps for themselves, about Marie, in the Coach space.
    const { rows } = await database.query<{ text: string }>(`INSERT INTO private_coach_note (coach_id, candidate_id, text) VALUES ($1, $2, $3) RETURNING text`, [added.coach.id, marie, PRIVATE_NOTE]);
    expect(rows[0]?.text).toBe(PRIVATE_NOTE);

    const reader = candidateObjects({
      profiles,
      applications,
      jobSearches: { get: async () => null, list: async () => [] },
      jobDigests: { get: async () => null, list: async () => [] },
      agenda: { upcoming: async () => [] },
      tailoredDocuments: { get: async () => null },
      tailoredCvs: { get: async () => null },
      companyDossiers: { get: async () => null },
      enrichedContacts: { get: async () => null },
      coachReviews: coaches,
    });
    const actions = createCoachActions({ catalog: readCoachActions(reader), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });
    const ai = createAiLayer({ providers: [createFakeProvider()], routes: { coaching: "anthropic" }, usage: createMemoryUsageLog() });
    const reply = (await actions.forReply(marie, { recorder: createProvenanceRecorder(ai), untrustedInView: false }))!;

    const { content } = await reply.runTool({ id: "call_1", name: "read_coach_reviews", arguments: { id: saved.application.id }, round: 1 }, {});

    expect(content).toContain("- avis de Sophie M., le ");
    expect(content).toContain("sur la lettre de motivation : Ouvrez sur votre dernier poste.");
    expect(content).not.toContain("hésite à quitter Lyon");
    expect(content).not.toContain("Note privée");
  });
});

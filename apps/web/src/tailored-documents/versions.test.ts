import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplications, migrateApplications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createTailoredCvs, migrateTailoredCvs, type TailoredCvs } from "../tailored-cv";
import { createTailoredDocuments, migrateTailoredDocuments, type TailoredDocuments } from "./index";
import { MAX_DOCUMENT_VERSIONS } from "./kinds";
import { createTailoredDocumentVersions, migrateTailoredDocumentVersions, type TailoredDocumentVersions } from "./versions";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "Directrice financière depuis 2005.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

const OFFER = {
  source: { url: "https://www.apec.fr/offre/versions" },
  title: "DAF H/F",
  content: "Nous recherchons un DAF pour un groupe industriel. Vous pilotez la consolidation IFRS sous SAP.",
  employer: "Acme Industrie",
  location: "Lyon",
  skills: ["IFRS", "SAP"],
};

describe.skipIf(!connectionString)("Tailored Document Versions (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let documents: TailoredDocuments;
  let tailoredCvs: TailoredCvs;
  let versions: TailoredDocumentVersions;
  let candidateId: string;
  let otherCandidateId: string;
  let applicationId: string;
  /** How many letters the fake AI Coach has written: each one says its number, so two drafts differ. */
  let letters: number;
  let headline: string;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function saveApplication(owner = candidateId) {
    const profile = await profiles.create(owner, { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } });
    const captured = await jobOffers.capture(OFFER);
    if (!profile.ok || !captured.ok) throw new Error("fixture refused");
    const saved = await createApplications(database, { jobOffers, profiles }).save(owner, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    return saved.application.id;
  }

  /** The AI Coach proposes a Tailored CV, then the Candidate saves it with every change accepted. */
  async function saveTailoredCv() {
    const proposed = await tailoredCvs.propose(candidateId, applicationId, {});
    if (!proposed.ok || !proposed.tailoredCv.proposal) throw new Error("no proposal");
    const { revision, changes } = proposed.tailoredCv.proposal;
    const saved = await tailoredCvs.save(candidateId, applicationId, { revision, accepted: changes.map((change) => change.id) });
    if (!saved.ok) throw new Error("not saved");
    return saved.tailoredCv.saved!;
  }

  const letterVersions = async () => (await versions.list(candidateId, applicationId))!.cover_letter;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateJobOffers(database);
    await migrateApplications(database);
    await migrateTailoredDocuments(database);
    await migrateTailoredCvs(database);
    profiles = createProfiles(database);
    jobOffers = createJobOffers(database);
    letters = 0;
    headline = "Directrice administrative et financière";
    const provider = createFakeProvider({
      id: "mistral",
      reply: (input: { system?: string }) => {
        if (input.system?.includes('"headline"'))
          return "```json\n" + JSON.stringify({ headline, summary: masterCv.summary, skills: ["IFRS", "SAP"], missing: [] }) + "\n```";
        if (input.system?.includes('"subject"')) return '{"subject": "Candidature DAF", "text": "Bonjour, je me permets de vous contacter."}';
        letters += 1;
        return `Madame, Monsieur,\n\nVotre offre a retenu toute mon attention (rédaction ${letters}).`;
      },
    });
    const ai = createAiLayer({ providers: [provider], routes: { writing: "mistral" }, usage: createMemoryUsageLog() });
    const applications = createApplications(database, { jobOffers, profiles });
    documents = createTailoredDocuments(database, { applications, profiles, ai });
    tailoredCvs = createTailoredCvs(database, { applications, profiles, ai });
    versions = createTailoredDocumentVersions(database, { applications });
    candidateId = await signIn("marie.dupont@example.fr");
    otherCandidateId = await signIn("paul.martin@example.fr");
    applicationId = await saveApplication();
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("an Application without documents has no versions; another Candidate's has none to show", async () => {
    expect(await versions.list(candidateId, applicationId)).toEqual({ tailored_cv: [], cover_letter: [], outreach_message: [] });
    expect(await versions.list(otherCandidateId, applicationId)).toBeNull();
  });

  it("a drafting is version 1, current, with its date, origin, language and text", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    const [first] = await letterVersions();
    expect(first).toMatchObject({ version: 1, source: "drafted", current: true, language: "fr", subject: null, text: expect.stringContaining("rédaction 1"), cv: null, restoredFrom: null });
    expect(first!.savedAt).toBeInstanceOf(Date);
  });

  it("every change keeps the version before: a new drafting, the Candidate's save, a Coach proposal applied, its « Annuler »", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma lettre, retouchée par moi." });
    const drafts = await documents.get(candidateId, applicationId);
    const reworked = await documents.rework(
      candidateId,
      applicationId,
      { document: "cover_letter", text: "Ma lettre, plus concise." },
      { version: drafts!.coverLetter!.updatedAt.toISOString(), origin: { origin: "coach_proposal", cardId: "card-1", appliedAt: new Date() } },
    );
    if (!reworked.ok) throw new Error("not reworked");
    await documents.unrework(candidateId, applicationId, reworked.undo);
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    const kept = await letterVersions();
    expect(kept.map(({ version, source, current }) => ({ version, source, current }))).toEqual([
      { version: 5, source: "drafted", current: true },
      { version: 4, source: "restored", current: false },
      { version: 3, source: "coach", current: false },
      { version: 2, source: "candidate", current: false },
      { version: 1, source: "drafted", current: false },
    ]);
    expect(kept.map((version) => version.text)).toEqual([
      expect.stringContaining("rédaction 2"),
      "Ma lettre, retouchée par moi.",
      "Ma lettre, plus concise.",
      "Ma lettre, retouchée par moi.",
      expect.stringContaining("rédaction 1"),
    ]);
    expect(kept[1]!.restoredFrom).toBe(2);
  });

  it("an Outreach Message's versions carry its subject", async () => {
    await documents.draft(candidateId, applicationId, { document: "outreach_message" });
    await documents.edit(candidateId, applicationId, { document: "outreach_message", text: "Bonjour, un mot rapide.", subject: "Poste de DAF" });

    const kept = (await versions.list(candidateId, applicationId))!.outreach_message;
    expect(kept.map(({ subject, text }) => ({ subject, text }))).toEqual([
      { subject: "Poste de DAF", text: "Bonjour, un mot rapide." },
      { subject: "Candidature DAF", text: "Bonjour, je me permets de vous contacter." },
    ]);
  });

  it("one save is one version, and a save that changes nothing makes none", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma lettre." });
    await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma lettre." });

    expect(await letterVersions()).toHaveLength(2);
  });

  it(`keeps the last ${MAX_DOCUMENT_VERSIONS} versions of a document, the oldest dropped first`, async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    for (let edit = 1; edit <= MAX_DOCUMENT_VERSIONS + 2; edit += 1) await documents.edit(candidateId, applicationId, { document: "cover_letter", text: `Ma lettre, retouche ${edit}.` });

    const kept = await letterVersions();
    expect(MAX_DOCUMENT_VERSIONS).toBe(20);
    expect(kept).toHaveLength(MAX_DOCUMENT_VERSIONS);
    expect(kept[0]).toMatchObject({ version: MAX_DOCUMENT_VERSIONS + 3, current: true, text: `Ma lettre, retouche ${MAX_DOCUMENT_VERSIONS + 2}.` });
    expect(kept.at(-1)!.version).toBe(4);
  });

  it("a Restore makes an earlier version current as a new version: nothing is deleted", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma lettre, retouchée." });

    const restored = await versions.restore(candidateId, applicationId, { document: "cover_letter", version: 1 });

    expect(restored).toMatchObject({ ok: true, version: 3 });
    const kept = await letterVersions();
    expect(kept.map(({ version, source, restoredFrom }) => ({ version, source, restoredFrom }))).toEqual([
      { version: 3, source: "restored", restoredFrom: 1 },
      { version: 2, source: "candidate", restoredFrom: null },
      { version: 1, source: "drafted", restoredFrom: null },
    ]);
    const drafts = await documents.get(candidateId, applicationId);
    expect(drafts!.coverLetter!.text).toContain("rédaction 1");
  });

  it("restoring the current version changes nothing; an unknown version, document or Application is not found", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    expect(await versions.restore(candidateId, applicationId, { document: "cover_letter", version: 1 })).toMatchObject({ ok: true, version: 1 });
    expect(await letterVersions()).toHaveLength(1);
    expect(await versions.restore(candidateId, applicationId, { document: "cover_letter", version: 9 })).toEqual({ ok: false, error: "not_found" });
    expect(await versions.restore(candidateId, applicationId, { document: "outreach_message", version: 1 })).toEqual({ ok: false, error: "not_found" });
    expect(await versions.restore(otherCandidateId, applicationId, { document: "cover_letter", version: 1 })).toEqual({ ok: false, error: "not_found" });
    expect(await versions.restore(candidateId, applicationId, { document: "letter", version: 1 })).toMatchObject({ ok: false, errors: expect.any(Array) });
  });

  it("a Restore from a version seen is refused as a conflict once the document changed since, and keeps the card's Origin", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma lettre, retouchée." });
    const origin = { origin: "coach_proposal" as const, cardId: "card-7", appliedAt: new Date("2026-11-18T10:00:00Z") };

    expect(await versions.restore(candidateId, applicationId, { document: "cover_letter", version: 1 }, { current: 1, origin })).toEqual({ ok: false, error: "conflict" });
    expect(await versions.restore(candidateId, applicationId, { document: "cover_letter", version: 1 }, { current: 2, origin })).toMatchObject({ ok: true, version: 3, before: 2 });
    expect((await documents.get(candidateId, applicationId))!.coverLetter!.origin).toEqual(origin);
  });

  it("a Tailored CV saved after its review is a version, its content kept; restoring it puts it back as saved", async () => {
    const first = await saveTailoredCv();
    headline = "DAF groupe industriel";
    await saveTailoredCv();

    const kept = (await versions.list(candidateId, applicationId))!.tailored_cv;
    expect(kept.map(({ version, source, current, language }) => ({ version, source, current, language }))).toEqual([
      { version: 2, source: "drafted", current: true, language: "fr" },
      { version: 1, source: "drafted", current: false, language: "fr" },
    ]);
    expect(kept[1]!.cv).toEqual(first.content);
    expect(kept[0]!.text).toBeNull();

    expect(await versions.restore(candidateId, applicationId, { document: "tailored_cv", version: 1 })).toMatchObject({ ok: true, version: 3 });
    expect((await tailoredCvs.get(candidateId, applicationId))!.saved!.content).toEqual(first.content);
  });

  it("existing documents become their version 1 when migrated, once, however often it runs", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });
    await saveTailoredCv();
    await database.query(`DELETE FROM tailored_document_version`);
    await database.query(`UPDATE tailored_document SET updated_at = drafted_at + interval '1 hour'`);

    await migrateTailoredDocumentVersions(database);
    await migrateTailoredDocumentVersions(database);

    const all = (await versions.list(candidateId, applicationId))!;
    expect(all.cover_letter.map(({ version, source, current }) => ({ version, source, current }))).toEqual([{ version: 1, source: "candidate", current: true }]);
    expect(all.tailored_cv.map(({ version, source }) => ({ version, source }))).toEqual([{ version: 1, source: "drafted" }]);
    await documents.edit(candidateId, applicationId, { document: "cover_letter", text: "Ma lettre." });
    expect((await letterVersions()).map((version) => version.version)).toEqual([2, 1]);
  });

  it("versions are deleted with their Application", async () => {
    await documents.draft(candidateId, applicationId, { document: "cover_letter" });

    await database.query(`DELETE FROM application WHERE id = $1`, [applicationId]);

    const { rows } = await database.query(`SELECT 1 FROM tailored_document_version`);
    expect(rows).toHaveLength(0);
  });
});

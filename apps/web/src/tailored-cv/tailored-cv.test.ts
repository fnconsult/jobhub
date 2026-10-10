import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type FakeProvider } from "@jobhub/ai/testing";
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplications, migrateApplications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createJobOffers, migrateJobOffers, type JobOffers } from "../job-offers";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { migrateTailoredDocuments } from "../tailored-documents";
import { createTailoredCvs, migrateTailoredCvs, type TailoredCvs } from "./index";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "Directrice financière depuis 2005, 12 filiales consolidées.",
  experience: [
    { title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS de 12 filiales." },
    { title: "Contrôleuse de gestion", employer: "Danone", location: "Paris", period: "1995 – 2005", description: "Budget et reporting mensuel." },
  ],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1994" }],
  skills: ["Reporting", "IFRS", "SAP"],
  languages: [{ name: "Anglais", level: "courant" }],
};

const FRENCH_OFFER = {
  source: { url: "https://www.apec.fr/offre/daf" },
  title: "DAF H/F",
  content: "Nous recherchons un DAF pour un groupe industriel. Vous pilotez la consolidation IFRS et le reporting sous SAP et Power BI.",
  employer: "Acme Industrie",
  location: "Lyon",
  skills: ["IFRS", "SAP", "Power BI"],
};
const ENGLISH_OFFER = {
  source: { url: "https://jobs.example.com/cfo" },
  title: "Chief Financial Officer",
  content: "We are looking for a CFO who will lead our finance team. You have 15 years of experience with IFRS and SAP.",
  employer: "Globex Ltd",
  skills: ["IFRS", "SAP"],
};

/** What the fake AI Coach proposes: Master CV facts rephrased, reordered and cut, as a JSON object. */
const PROPOSAL = {
  headline: "Directrice administrative et financière",
  summary: "Directrice financière depuis 2005 : consolidation IFRS de 12 filiales sous SAP.",
  experience: [{ employer: "Groupe Seb", period: "2005 – 2024", title: "Directrice financière", description: "Pilotage de la consolidation IFRS de 12 filiales." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1994" }],
  skills: ["IFRS", "SAP", "Reporting"],
  languages: [{ name: "Anglais", level: "courant" }],
  missing: [],
};

describe.skipIf(!connectionString)("Tailored CV with change review (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let jobOffers: JobOffers;
  let provider: FakeProvider;
  let reply: object | string;
  /** Replies given first, one per call, before `reply`. */
  let replies: (object | string)[];
  let usage: ReturnType<typeof createMemoryUsageLog>;
  let tailoredCvs: TailoredCvs;
  let candidateId: string;
  let applicationId: string;

  /** The last call asking the AI Coach for a Tailored CV, not for a translation of the Job Offer's words. */
  const coachCall = () => provider.calls.filter((call) => !call.system?.startsWith("Translate")).at(-1)!;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  async function saveApplication(offer: Parameters<JobOffers["capture"]>[0], owner = candidateId) {
    const profile = await profiles.create(owner, { masterCv, searchCriteria: { targetRole: "DAF", location: "Lyon" } });
    const captured = await jobOffers.capture(offer);
    if (!profile.ok || !captured.ok) throw new Error("fixture refused");
    const applications = createApplications(database, { jobOffers, profiles });
    const saved = await applications.save(owner, { jobOfferId: captured.jobOffer.id, profileId: profile.profile.id });
    if (!saved.ok) throw new Error("fixture Application refused");
    return saved.application.id;
  }

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
    reply = PROPOSAL;
    replies = [];
    provider = createFakeProvider({
      id: "mistral",
      reply: () => {
        const next = replies.shift() ?? reply;
        return typeof next === "string" ? next : "```json\n" + JSON.stringify(next) + "\n```";
      },
    });
    usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [provider], routes: { writing: "mistral" }, usage });
    tailoredCvs = createTailoredCvs(database, { applications: createApplications(database, { jobOffers, profiles }), profiles, ai });
    candidateId = await signIn("marie.dupont@example.fr");
    applicationId = await saveApplication(FRENCH_OFFER);
  }, 60_000); // A throwaway database each time: slow when the machine is busy.
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("an Application has no Tailored CV until the AI Coach proposes one", async () => {
    expect(await tailoredCvs.get(candidateId, applicationId)).toMatchObject({ documentLanguage: "fr", proposal: null, saved: null });
  });

  it("the AI Coach proposes a Tailored CV from the Profile's Master CV and the Job Offer, not saved until the Candidate approves it", async () => {
    const result = await tailoredCvs.propose(candidateId, applicationId, {});

    expect(result).toMatchObject({
      ok: true,
      tailoredCv: {
        saved: null,
        proposal: {
          language: "fr",
          content: {
            ...masterCv,
            headline: PROPOSAL.headline,
            summary: PROPOSAL.summary,
            experience: [{ ...masterCv.experience[0], description: "Pilotage de la consolidation IFRS de 12 filiales." }],
            skills: ["IFRS", "SAP", "Reporting"],
          },
        },
      },
    });
    const prompt = coachCall().messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("Consolidation IFRS de 12 filiales.");
    expect(prompt).toContain("DAF H/F");
    expect((await tailoredCvs.get(candidateId, applicationId))?.proposal?.content.headline).toBe(PROPOSAL.headline);
  });

  it("whatever the AI Coach invents is left out: jobs, diplomas, skills, figures and the Job Offer's keywords the Master CV does not have", async () => {
    reply = {
      ...PROPOSAL,
      fullName: "Marie Durand",
      headline: "DAF experte Power BI",
      summary: "Directrice financière depuis 2005, 20 filiales consolidées.",
      experience: [
        { employer: "Groupe Seb", period: "2005 – 2024", title: "DAF Groupe", description: "Consolidation IFRS de 12 filiales et tableaux de bord Power BI." },
        { employer: "Acme Industrie", period: "2024 – aujourd'hui", title: "DAF", description: "Direction financière." },
        { employer: "Danone", period: "1995 – 2005", title: "Contrôleuse de gestion", description: "Budget et reporting mensuel de 40 sites." },
      ],
      education: [{ degree: "MBA", institution: "INSEAD", year: "2010" }, ...PROPOSAL.education],
      skills: ["Power BI", "IFRS", "SAP", "Reporting"],
    };

    const result = await tailoredCvs.propose(candidateId, applicationId, {});

    expect(result).toMatchObject({
      ok: true,
      tailoredCv: {
        proposal: {
          content: {
            fullName: "Marie Dupont",
            headline: masterCv.headline,
            summary: masterCv.summary,
            experience: [
              { ...masterCv.experience[0], title: "DAF Groupe" },
              masterCv.experience[1],
            ],
            education: masterCv.education,
            skills: ["IFRS", "SAP", "Reporting"],
          },
        },
      },
    });
  });

  it("wording taken from the Job Offer's text that the Master CV lacks is kept, but flagged as an addition in the review (#68)", async () => {
    const offer = await saveApplication({
      ...FRENCH_OFFER,
      source: { url: "https://www.apec.fr/offre/daf-omnicanal" },
      content: `${FRENCH_OFFER.content} Vous accompagnez les clients dans l'adoption de solutions omnicanales et animez des revues stratégiques avec des interlocuteurs C-level.`,
    });
    const summary = "Directrice financière depuis 2005, solutions omnicanales et revues stratégiques avec des interlocuteurs C-level.";
    reply = { ...PROPOSAL, summary };

    const result = await tailoredCvs.propose(candidateId, offer, {});

    const proposal = result.ok ? result.tailoredCv.proposal! : null;
    expect(proposal?.content.summary).toBe(summary);
    const flagged = proposal?.changes.find((change) => change.section === "summary");
    expect(flagged).toMatchObject({ kind: "rephrased", tailored: summary });
    expect(flagged?.fromOffer).toEqual(expect.arrayContaining(["omnicanales", "revues", "stratégiques", "interlocuteurs", "level"]));
    expect(proposal?.offerWordingTranslated).toBe(false);
  });

  it("in another Document Language, the Job Offer's words are checked against the Master CV through a translation, and the Candidate is told so (#68)", async () => {
    const english = await saveApplication({
      ...ENGLISH_OFFER,
      source: { url: "https://jobs.example.com/cfo-omnichannel" },
      content: `${ENGLISH_OFFER.content} You drive omnichannel solutions and strategic reviews with C-level executives.`,
    });
    const summary = "Chief Financial Officer since 2005, omnichannel solutions with C-level executives.";
    replies = [{ ...PROPOSAL, headline: "Chief Financial Officer", summary }];
    // The AI Coach's translation of the Job Offer's words into the Master CV's language (French).
    reply = { chief: "directrice", financial: "financière", officer: "directrice", omnichannel: "omnicanal", solutions: "solutions", level: "niveau", executives: "dirigeants" };

    const result = await tailoredCvs.propose(candidateId, english, { language: "en" });

    const proposal = result.ok ? result.tailoredCv.proposal! : null;
    expect(proposal?.content.summary).toBe(summary);
    expect(proposal?.offerWordingTranslated).toBe(true);
    const fromOffer = proposal?.changes.find((change) => change.section === "summary")?.fromOffer ?? [];
    expect(fromOffer).toEqual(expect.arrayContaining(["omnichannel", "executives"]));
    expect(fromOffer).not.toContain("financial");
    expect(fromOffer).not.toContain("chief");
  });

  it("rephrasings that only reuse the Master CV's words are not flagged (#68)", async () => {
    const result = await tailoredCvs.propose(candidateId, applicationId, {});

    const changes = result.ok ? result.tailoredCv.proposal!.changes : [];
    expect(changes.filter((change) => change.kind === "rephrased").length).toBeGreaterThan(0);
    expect(changes.filter((change) => change.fromOffer)).toEqual([]);
  });

  it("the Job Offer's requirements the Master CV lacks become questions to the Candidate, added only if confirmed", async () => {
    reply = { ...PROPOSAL, missing: ["Management d'équipe", "consolidation IFRS"] };
    const proposed = await tailoredCvs.propose(candidateId, applicationId, {});
    expect(proposed).toMatchObject({
      ok: true,
      tailoredCv: {
        proposal: {
          questions: [
            { requirement: "Power BI", answer: null },
            { requirement: "Management d'équipe", answer: null },
          ],
          content: { skills: ["IFRS", "SAP", "Reporting"] },
        },
      },
    });

    await tailoredCvs.answer(candidateId, applicationId, { requirement: "Power BI", confirmed: true });
    const answered = await tailoredCvs.answer(candidateId, applicationId, { requirement: "Management d'équipe", confirmed: false });

    expect(answered).toMatchObject({
      ok: true,
      tailoredCv: {
        proposal: {
          questions: [
            { requirement: "Power BI", answer: "confirmed" },
            { requirement: "Management d'équipe", answer: "declined" },
          ],
          content: { skills: ["IFRS", "SAP", "Reporting", "Power BI"] },
        },
      },
    });
    const changedMind = await tailoredCvs.answer(candidateId, applicationId, { requirement: "Power BI", confirmed: false });
    expect(changedMind).toMatchObject({ ok: true, tailoredCv: { proposal: { content: { skills: ["IFRS", "SAP", "Reporting"] } } } });
    expect(await tailoredCvs.answer(candidateId, applicationId, { requirement: "Excel", confirmed: true })).toEqual({ ok: false, error: "not_found" });
  });

  it("the Candidate reviews each change against the Master CV: rephrased, reordered, cut or added once confirmed", async () => {
    await tailoredCvs.propose(candidateId, applicationId, {});
    const result = await tailoredCvs.answer(candidateId, applicationId, { requirement: "Power BI", confirmed: true });

    expect(result.ok && result.tailoredCv.proposal?.changes).toEqual([
      { section: "headline", kind: "rephrased", master: "Directrice financière", tailored: "Directrice administrative et financière" },
      { section: "summary", kind: "rephrased", master: masterCv.summary, tailored: PROPOSAL.summary },
      {
        section: "experience",
        kind: "rephrased",
        item: "Directrice financière · Groupe Seb · 2005 – 2024",
        master: "Directrice financière\nConsolidation IFRS de 12 filiales.",
        tailored: "Directrice financière\nPilotage de la consolidation IFRS de 12 filiales.",
      },
      { section: "experience", kind: "cut", item: "Contrôleuse de gestion · Danone · 1995 – 2005" },
      { section: "skills", kind: "reordered", master: "Reporting\nIFRS\nSAP", tailored: "IFRS\nSAP\nReporting" },
      { section: "skills", kind: "added", item: "Power BI" },
    ]);
  });

  it("shows the Match Score of the Master CV against the Tailored CV's", async () => {
    const application = await createApplications(database, { jobOffers, profiles }).get(candidateId, applicationId);
    await tailoredCvs.propose(candidateId, applicationId, {});
    const unchanged = await tailoredCvs.get(candidateId, applicationId);
    expect(unchanged?.proposal?.matchScore).toEqual({ master: application!.matchScore.score, tailored: application!.matchScore.score });

    const result = await tailoredCvs.answer(candidateId, applicationId, { requirement: "Power BI", confirmed: true });

    if (!result.ok || !result.tailoredCv.proposal) throw new Error("no proposal");
    const { master, tailored } = result.tailoredCv.proposal.matchScore;
    expect(master).toBe(application!.matchScore.score);
    expect(tailored).toBeGreaterThan(master);
  });

  it("is written in the Job Offer's language by default", async () => {
    const english = await saveApplication(ENGLISH_OFFER);

    const result = await tailoredCvs.propose(candidateId, english, {});

    expect(result).toMatchObject({ ok: true, tailoredCv: { documentLanguage: "en", proposal: { language: "en" } } });
    expect(coachCall().system).toContain("in English");
  });

  it("the Candidate can choose another Document Language, which the Application keeps for its next Tailored Documents", async () => {
    await tailoredCvs.propose(candidateId, applicationId, { language: "en" });
    expect(coachCall().system).toContain("in English");

    const result = await tailoredCvs.propose(candidateId, applicationId, {});

    expect(result).toMatchObject({ ok: true, tailoredCv: { documentLanguage: "en", proposal: { language: "en" } } });
    expect(coachCall().system).toContain("in English");
    expect(await tailoredCvs.propose(candidateId, applicationId, { language: "de" })).toMatchObject({ ok: false, errors: [{ field: "language" }] });
  });

  it("once reviewed, the Candidate saves the Tailored CV on the Application; proposing again leaves it until the next save", async () => {
    await tailoredCvs.propose(candidateId, applicationId, {});
    await tailoredCvs.answer(candidateId, applicationId, { requirement: "Power BI", confirmed: true });
    const reviewed = await tailoredCvs.get(candidateId, applicationId);

    const result = await tailoredCvs.save(candidateId, applicationId, { revision: reviewed!.proposal!.revision });

    expect(result).toMatchObject({
      ok: true,
      tailoredCv: {
        proposal: null,
        saved: { language: "fr", masterCvVersion: 1, content: reviewed!.proposal!.content, matchScore: reviewed!.proposal!.matchScore },
      },
    });
    reply = { ...PROPOSAL, headline: "Directrice financière groupe" };
    await tailoredCvs.propose(candidateId, applicationId, {});
    const state = await tailoredCvs.get(candidateId, applicationId);
    expect(state?.saved?.content).toEqual(reviewed!.proposal!.content);
    expect(state?.proposal?.content.headline).toBe("Directrice financière groupe");
  });

  it("there is nothing to save without a proposal, nor once the Master CV changed since it was proposed", async () => {
    expect(await tailoredCvs.save(candidateId, applicationId, { revision: "none" })).toEqual({ ok: false, error: "not_found" });
    const proposed = await tailoredCvs.propose(candidateId, applicationId, {});
    const revision = proposed.ok ? proposed.tailoredCv.proposal!.revision : "";
    const application = await createApplications(database, { jobOffers, profiles }).get(candidateId, applicationId);
    await profiles.saveMasterCv(candidateId, application!.profile.id, { basedOnVersion: 1, content: { ...masterCv, headline: "DAF" } });

    expect(await tailoredCvs.save(candidateId, applicationId, { revision })).toEqual({ ok: false, error: "master_cv_changed" });
    expect((await tailoredCvs.get(candidateId, applicationId))?.saved).toBeNull();
  });

  it("someone else's Application has no Tailored CV, and nothing changes when the AI Coach cannot write one", async () => {
    const otherCandidateId = await signIn("paul.martin@example.fr");
    expect(await tailoredCvs.get(otherCandidateId, applicationId)).toBeNull();
    expect(await tailoredCvs.propose(otherCandidateId, applicationId, {})).toEqual({ ok: false, error: "not_found" });
    expect(await tailoredCvs.save(otherCandidateId, applicationId, { revision: "none" })).toEqual({ ok: false, error: "not_found" });

    await tailoredCvs.propose(candidateId, applicationId, {});
    reply = "Désolé, je ne peux pas.";
    expect(await tailoredCvs.propose(candidateId, applicationId, { language: "en" })).toEqual({ ok: false, error: "unavailable" });
    expect(await tailoredCvs.get(candidateId, applicationId)).toMatchObject({ documentLanguage: "fr", proposal: { content: { headline: PROPOSAL.headline } } });
  });
  it("only the proposal the Candidate reviewed is saved: not one proposed or answered since, in another tab", async () => {
    const reviewed = await tailoredCvs.propose(candidateId, applicationId, {});
    if (!reviewed.ok || !reviewed.tailoredCv.proposal) throw new Error("no proposal");
    const { revision } = reviewed.tailoredCv.proposal;
    expect(await tailoredCvs.save(candidateId, applicationId, {})).toMatchObject({ ok: false, errors: [{ field: "revision" }] });

    reply = { ...PROPOSAL, headline: "Directrice financière groupe" };
    await tailoredCvs.propose(candidateId, applicationId, { language: "en" });
    expect(await tailoredCvs.save(candidateId, applicationId, { revision })).toEqual({ ok: false, error: "proposal_changed" });

    const proposedAgain = (await tailoredCvs.get(candidateId, applicationId))!.proposal!;
    const answered = await tailoredCvs.answer(candidateId, applicationId, { requirement: "Power BI", confirmed: true });
    expect(await tailoredCvs.save(candidateId, applicationId, { revision: proposedAgain.revision })).toEqual({ ok: false, error: "proposal_changed" });
    expect((await tailoredCvs.get(candidateId, applicationId))?.saved).toBeNull();

    if (!answered.ok || !answered.tailoredCv.proposal) throw new Error("no proposal");
    const saved = await tailoredCvs.save(candidateId, applicationId, { revision: answered.tailoredCv.proposal.revision });
    expect(saved).toMatchObject({ ok: true, tailoredCv: { proposal: null, saved: { language: "en", content: { headline: "Directrice financière groupe", skills: ["IFRS", "SAP", "Reporting", "Power BI"] } } } });
  });

  it("in another Document Language, diplomas, languages and skills are written in it, each shown against the Master CV's", async () => {
    const english = await saveApplication({ ...ENGLISH_OFFER, skills: ["IFRS", "SAP", "Financial reporting"] });
    replies = [{
      headline: "Chief Financial Officer",
      summary: "Chief Financial Officer since 2005, 12 subsidiaries consolidated.",
      experience: [{ employer: "Groupe Seb", period: "2005 – 2024", title: "Chief Financial Officer", description: "IFRS consolidation of 12 subsidiaries and financial reporting." }],
      education: [{ id: "e0", degree: "Master's in Finance", institution: "ESSEC", year: "1994" }],
      skills: [{ id: "s1", text: "IFRS" }, { id: "s0", text: "Financial reporting" }, { id: "s2", text: "SAP" }],
      languages: [{ id: "l0", name: "English", level: "fluent" }],
      missing: [],
    }];
    // Then the Job Offer's words, translated into the Master CV's language.
    reply = { chief: "directrice", financial: "financière", finance: "finance", officer: "directrice", subsidiaries: "filiales", consolidated: "consolidées", consolidation: "consolidation", reporting: "reporting" };

    const result = await tailoredCvs.propose(candidateId, english, {});

    expect(coachCall().messages.map((message) => message.content).join("\n")).toContain('"id":"e0"');
    expect(result).toMatchObject({
      ok: true,
      tailoredCv: {
        proposal: {
          language: "en",
          content: {
            headline: "Chief Financial Officer",
            summary: "Chief Financial Officer since 2005, 12 subsidiaries consolidated.",
            experience: [{ ...masterCv.experience[0], title: "Chief Financial Officer", description: "IFRS consolidation of 12 subsidiaries and financial reporting." }],
            education: [{ degree: "Master's in Finance", institution: "ESSEC", year: "1994" }],
            skills: ["IFRS", "Financial reporting", "SAP"],
            languages: [{ name: "English", level: "fluent" }],
          },
        },
      },
    });
    const changes = result.ok ? result.tailoredCv.proposal!.changes : [];
    expect(changes).toEqual(
      expect.arrayContaining([
        { section: "education", kind: "rephrased", item: "Master Finance · ESSEC · 1994", master: "Master Finance · ESSEC · 1994", tailored: "Master's in Finance · ESSEC · 1994" },
        { section: "skills", kind: "rephrased", item: "Reporting", master: "Reporting", tailored: "Financial reporting" },
        { section: "languages", kind: "rephrased", item: "Anglais · courant", master: "Anglais · courant", tailored: "English · fluent" },
      ]),
    );
    expect(changes.filter((change) => change.kind === "cut")).toEqual([{ section: "experience", kind: "cut", item: "Contrôleuse de gestion · Danone · 1995 – 2005" }]);
  });

  it("in the Master CV's language, a diploma, language or skill rewritten to state what it lacks keeps the Master CV's wording", async () => {
    reply = {
      ...PROPOSAL,
      education: [{ id: "e0", degree: "Master Finance 2", institution: "ESSEC", year: "1994" }],
      skills: [{ id: "s1", text: "IFRS" }, { id: "s2", text: "Power BI" }, { id: "s0", text: "Reporting financier" }],
    };

    const result = await tailoredCvs.propose(candidateId, applicationId, {});

    expect(result).toMatchObject({ ok: true, tailoredCv: { proposal: { content: { education: masterCv.education, skills: ["IFRS", "SAP", "Reporting financier"] } } } });
  });

  it("a section the AI Coach leaves out or gets wrong is the Master CV's, and a reply with no CV in it changes nothing", async () => {
    reply = { headline: PROPOSAL.headline, summary: 12, experience: "Groupe Seb", skills: PROPOSAL.skills, languages: [{ nom: "Anglais" }], missing: [] };

    const result = await tailoredCvs.propose(candidateId, applicationId, {});

    expect(result).toMatchObject({
      ok: true,
      tailoredCv: {
        proposal: {
          content: { headline: PROPOSAL.headline, summary: masterCv.summary, experience: masterCv.experience, education: masterCv.education, skills: PROPOSAL.skills, languages: masterCv.languages },
        },
      },
    });

    for (const empty of [{}, { missing: ["Power BI"] }, { cv: PROPOSAL }]) {
      reply = empty;
      expect(await tailoredCvs.propose(candidateId, applicationId, { language: "en" })).toEqual({ ok: false, error: "unavailable" });
    }
    expect(await tailoredCvs.get(candidateId, applicationId)).toMatchObject({ documentLanguage: "fr", proposal: { content: { headline: PROPOSAL.headline, experience: masterCv.experience } } });
  });

  it("a refused reply is asked for once more: the second reply is the proposal, and each attempt counts in usage", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      replies = ["Voici le CV adapté de Marie Dupont, directrice financière chez Groupe Seb."];

      const result = await tailoredCvs.propose(candidateId, applicationId, {});

      expect(result).toMatchObject({ ok: true, tailoredCv: { proposal: { content: { headline: PROPOSAL.headline } } } });
      expect(usage.entries).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/Marie|Groupe Seb|IFRS/);
    } finally {
      warn.mockRestore();
    }
  });
});

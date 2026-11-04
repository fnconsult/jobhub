import { createAiLayer, createProvenanceRecorder, type ToolOutcome } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { scoreMatch, type JobOffer } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { AgendaItem } from "../agenda";
import type { Application } from "../applications";
import type { JobDigest } from "../job-digests";
import type { JobSearch } from "../job-searches";
import type { Profile } from "../profiles";
import type { ApplicationDrafts } from "../tailored-documents";
import type { ApplicationTailoredCv } from "../tailored-cv";
import { estimateTokens } from "../coach/context";
import { COACH_ACTION_READS_MAX_TOKENS, COACH_ACTION_RESULT_MAX_TOKENS, createCoachActions } from "./index";
import { candidateObjects, type CandidateObjectSources } from "./candidate-objects";
import { readCoachActions } from "./reads";

// The read Coach Actions (#714, ADR-0077), through the seam the AI Coach calls them by: `forReply(...).runTool`, on the
// catalogue shipped, over in-memory domain modules scoped to their Candidate (Marie's; anyone else's id is not found).

const IDENTITY = { fullName: "Marie Dupont", email: "marie.dupont@example.fr", phone: "06 12 34 56 78", location: "12 rue de la République, 69002 Lyon" };

const consultant: Profile = {
  id: "p-consultant",
  name: "Consultante finance",
  archived: false,
  searchCriteria: { targetRole: "Consultante finance de transition", locations: ["Lyon"], contractTypes: ["freelance"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
  masterCv: {
    version: 3,
    content: {
      ...IDENTITY,
      headline: "Consultante finance de transition",
      summary: "Vingt ans de clôtures, de consolidations IFRS et de pilotage de trésorerie. Joignable au 06 12 34 56 78.",
      experience: [
        { title: "Directrice financière", employer: "Groupe Exemple", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS de 12 filiales, clôture mensuelle en J+5, refonte du reporting." },
        { title: "Contrôleuse de gestion", employer: "Fictif Industries", location: "Villeurbanne", period: "1998 – 2005", description: "Budget, prévisions et tableaux de bord." },
      ],
      education: [{ degree: "DESCF", institution: "Université Lyon 3", year: "1997" }],
      skills: ["IFRS", "consolidation", "trésorerie"],
      languages: [{ name: "Anglais", level: "courant" }],
    },
  },
};

const archived: Profile = { ...consultant, id: "p-archived", name: "Ancien profil DAF", archived: true };

const offer = (id: string, title: string, employer: string, content = "Rattaché au DG, vous pilotez la clôture mensuelle et le reporting du groupe."): JobOffer => ({
  id,
  title,
  employer,
  location: "Lyon",
  contractType: "freelance",
  skills: ["IFRS", "Power BI"],
  content,
  source: { url: `https://carrieres.example.fr/${id}` },
});
const scored = (jobOffer: JobOffer) => scoreMatch({ cv: consultant.masterCv.content, searchCriteria: consultant.searchCriteria, jobOffer, today: new Date("2026-11-04") });

const airbusOffer = offer("o-airbus", "Responsable consolidation", "Airbus");
const airbus: Application = {
  id: "a-airbus",
  status: "applied",
  statusChangedAt: new Date("2026-10-28T09:00:00Z"),
  createdAt: new Date("2026-10-20T09:00:00Z"),
  jobOffer: airbusOffer,
  profile: { id: consultant.id, name: consultant.name },
  interviews: [{ id: "i1", scheduledAt: new Date("2026-11-10T13:00:00Z"), note: "avec la DAF", durationMinutes: 60, format: null, place: "", cancelledAt: null, reschedules: [] }],
  matchScore: scored(airbusOffer),
};
const oldOffer = offer("o-old", "DAF", "Ancienne Société");
/** An Application of the Archived Profile: an Archived Application, out of the Coach's reach. */
const archivedApplication: Application = { ...airbus, id: "a-archived", jobOffer: oldOffer, profile: { id: archived.id, name: archived.name }, interviews: [], matchScore: scored(oldOffer) };

const foundOffer = offer("o-found", "Directrice financière de transition", "Société Fictive");
const jobSearch: JobSearch = {
  id: "s1",
  profile: { id: consultant.id, name: consultant.name, searchCriteria: consultant.searchCriteria },
  status: "done",
  failure: null,
  startedAt: new Date("2026-11-01T08:00:00Z"),
  results: [{ jobOffer: foundOffer, matchScore: scored(foundOffer), applicationId: null }],
  metrics: null,
  provenance: null,
};
const archivedSearch: JobSearch = { ...jobSearch, id: "s-archived", profile: { ...jobSearch.profile, id: archived.id, name: archived.name } };

const digestOffer = offer("o-digest", "Manager de transition finance", "Exemple Conseil");
const jobDigest: JobDigest = { id: "d1", profile: { id: consultant.id, name: consultant.name }, sentAt: new Date("2026-11-03T05:00:00Z"), results: [{ jobOffer: digestOffer, matchScore: scored(digestOffer), applicationId: null }], provenance: null };

const interviewItem: AgendaItem = {
  kind: "interview",
  id: "i1",
  scheduledAt: new Date("2026-11-10T13:00:00Z"),
  applicationId: airbus.id,
  jobTitle: airbusOffer.title,
  employer: "Airbus",
  durationMinutes: 60,
  format: null,
  place: "",
  reschedules: [],
};

const COVER_LETTER = "Madame, Monsieur, forte de vingt ans de consolidation IFRS, je souhaite rejoindre votre direction financière pour y piloter la clôture.";
const drafts: ApplicationDrafts = {
  documentLanguage: "fr",
  coverLetter: { language: "fr", text: COVER_LETTER, draftedAt: new Date("2026-10-29T10:00:00Z"), updatedAt: new Date("2026-10-30T10:00:00Z"), provenance: null },
  outreachMessage: null,
};
const tailoredCv: ApplicationTailoredCv = {
  documentLanguage: "fr",
  proposal: null,
  saved: { language: "fr", masterCvVersion: 3, content: consultant.masterCv.content, matchScore: { master: 61, tailored: 78 }, savedAt: new Date("2026-10-29T11:00:00Z"), provenance: null },
};

interface Workspace {
  profiles: Profile[];
  applications: Application[];
  jobSearches: JobSearch[];
  jobDigests: JobDigest[];
  agenda: AgendaItem[];
}

const workspace = (more: Partial<Workspace> = {}): Workspace => ({
  profiles: [consultant, archived],
  applications: [airbus, archivedApplication],
  jobSearches: [jobSearch, archivedSearch],
  jobDigests: [jobDigest],
  agenda: [interviewItem],
  ...more,
});

/** Domain modules as the pages' routes use them, scoped to Marie: anyone else gets nothing. */
function sourcesOf(data: Workspace): CandidateObjectSources {
  const mine = <T>(candidateId: string, items: T[]) => (candidateId === "marie" ? items : []);
  const archivedProfiles = new Set(data.profiles.filter((profile) => profile.archived).map((profile) => profile.id));
  return {
    profiles: {
      get: async (candidateId, id) => mine(candidateId, data.profiles).find((each) => each.id === id) ?? null,
      list: async (candidateId) => mine(candidateId, data.profiles).map(({ id, name, archived }) => ({ id, name, archived })),
    },
    applications: {
      get: async (candidateId, id) => mine(candidateId, data.applications).find((each) => each.id === id) ?? null,
      list: async (candidateId) =>
        mine(candidateId, data.applications).map(({ id, status, statusChangedAt, createdAt, jobOffer, profile, interviews }) => ({
          id,
          status,
          statusChangedAt,
          createdAt,
          jobOffer,
          profile: { ...profile, archived: archivedProfiles.has(profile.id) },
          interviews,
        })),
    },
    jobSearches: {
      get: async (candidateId, id) => mine(candidateId, data.jobSearches).find((each) => each.id === id) ?? null,
      list: async (candidateId) =>
        mine(candidateId, data.jobSearches).map(({ id, profile, status, startedAt, results }) => ({ id, profile: { id: profile.id, name: profile.name }, status, startedAt, found: results.length, unseen: false })),
    },
    jobDigests: {
      get: async (candidateId, id) => mine(candidateId, data.jobDigests).find((each) => each.id === id) ?? null,
      list: async (candidateId) => mine(candidateId, data.jobDigests).map(({ id, profile, sentAt, results }) => ({ id, profile, sentAt, count: results.length })),
    },
    agenda: { upcoming: async (candidateId) => mine(candidateId, data.agenda) },
    tailoredDocuments: { get: async (candidateId, applicationId) => (candidateId === "marie" && applicationId === airbus.id ? drafts : null) },
    tailoredCvs: { get: async (candidateId, applicationId) => (candidateId === "marie" && applicationId === airbus.id ? tailoredCv : null) },
    now: () => new Date("2026-11-04T10:00:00Z"),
  };
}

async function setUp(data = workspace(), candidateId = "marie") {
  const actions = createCoachActions({ catalog: readCoachActions(candidateObjects(sourcesOf(data))), settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } });
  const ai = createAiLayer({ providers: [createFakeProvider()], routes: { coaching: "anthropic" }, usage: createMemoryUsageLog() });
  const recorder = createProvenanceRecorder(ai);
  const reply = (await actions.forReply(candidateId, { recorder, untrustedInView: false }))!;
  let call = 0;
  const read = (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => reply.runTool({ id: `call_${(call += 1)}`, name, arguments: args, round: 1 }, {});
  return { reply, read, recorder };
}

const NOT_FOUND = { content: JSON.stringify({ error: "not_found" }), error: true };

describe("read_profile (#714)", () => {
  it("reads an active Profile of the Candidate: its Search Criteria and Master CV, framed as data, without the Identity block", async () => {
    const { read, recorder } = await setUp();

    const { content, error } = await read("read_profile", { id: consultant.id });

    expect(error).toBeUndefined();
    expect(content).toMatch(/^<donnees>[\s\S]*<\/donnees>$/);
    expect(content).toContain("Consultante finance de transition");
    expect(content).toContain("lieu Lyon");
    expect(content).toContain("Consolidation IFRS de 12 filiales");
    for (const value of [IDENTITY.fullName, IDENTITY.email, IDENTITY.phone, IDENTITY.location]) expect(content).not.toContain(value);
    expect(recorder.provenance().sites).toEqual([{ kind: "candidate", links: ["/profils/p-consultant"] }]);
  });

  it("is not_found for an Archived Profile, another Candidate's or an unknown id, saying nothing of why", async () => {
    const { read } = await setUp();
    const paul = await setUp(workspace(), "paul");

    expect(await read("read_profile", { id: archived.id })).toEqual(NOT_FOUND);
    expect(await read("read_profile", { id: "p-unknown" })).toEqual(NOT_FOUND);
    expect(await paul.read("read_profile", { id: consultant.id })).toEqual(NOT_FOUND);
  });

  it("tells a Master CV too long for its room without its job descriptions first, then cuts it, never past the cap", async () => {
    const long = "Pilotage de la clôture et du reporting. ".repeat(400);
    const wordy: Profile = { ...consultant, masterCv: { ...consultant.masterCv, content: { ...consultant.masterCv.content, experience: consultant.masterCv.content.experience.map((job) => ({ ...job, description: long })) } } };
    const { read } = await setUp(workspace({ profiles: [wordy] }));

    const { content } = await read("read_profile", { id: wordy.id });

    expect(estimateTokens(content)).toBeLessThanOrEqual(COACH_ACTION_RESULT_MAX_TOKENS + 10);
    expect(content).not.toContain("Pilotage de la clôture");
    expect(content).toContain("- Directrice financière, Groupe Exemple (Lyon), 2005 – 2024");
    expect(content).toContain("Compétences : IFRS");

    const huge: Profile = { ...wordy, masterCv: { ...wordy.masterCv, content: { ...wordy.masterCv.content, summary: long } } };
    const cut = await (await setUp(workspace({ profiles: [huge] }))).read("read_profile", { id: huge.id });
    expect(estimateTokens(cut.content)).toBeLessThanOrEqual(COACH_ACTION_RESULT_MAX_TOKENS + 10);
    expect(cut.content).toContain("(la suite est coupée)");
  });
});

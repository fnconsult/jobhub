/**
 * The invariant of ADR-0077: a Coach Action never writes. Every proposing Coach Action of the catalogue shipped, called
 * the way an AI Coach reply calls it (`forReply(...).runTool`, COACH_ACTIONS_ENABLED on), over the real domain modules on
 * Postgres, leaves every table of the database as it was, and the in-memory ones (Job Searches, Job Digests, Tailored
 * documents) never see a write. Only its card's « Appliquer », the Candidate's own click, writes (coach-proposals).
 * A new proposing Coach Action must be listed in CALLS below, so that it is held to it too.
 */
import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActionCards, migrateActionCards, migrateActionCardsInThread } from "../action-cards";
import { createApplications, migrateApplications, type Applications } from "../applications";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createCoachMemory, migrateCoachMemory } from "../coach-memory";
import { coachProposalHandlers, createCoachProposals } from "../coach-proposals";
import { migrateCoachConversations } from "../coach-conversations";
import { createFollowUps, migrateFollowUps } from "../follow-ups";
import { migrateJobDigests } from "../job-digests";
import { createJobOffers, migrateJobOffers } from "../job-offers";
import { migrateJobSearches } from "../job-searches";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { shippedCoachActions, type CoachActionDomain } from "./catalog";
import { createCoachActions, type CoachAction, type CoachActionsForReply } from "./index";
import type { CoachObjectReader } from "./reads";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "25 ans dans l'industrie.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["IFRS", "SAP", "Consolidation"],
  languages: [],
};

/** The ids the arguments name, known once the fixtures exist. */
interface World {
  daf: string;
  consultant: string;
  archived: string;
  applicationId: string;
  /** An Application « Postulée », for a follow-up. */
  appliedId: string;
  interviewId: string;
  newOfferId: string;
}

/** Each proposing Coach Action's arguments, as a reply would send them: each must make a proposal. */
const CALLS: Record<string, (world: World) => Record<string, unknown>> = {
  propose_application: (w) => ({ jobOfferId: w.newOfferId, profileId: w.daf }),
  propose_application_status: (w) => ({ applicationId: w.applicationId, status: "rejected" }),
  propose_application_profile: (w) => ({ applicationId: w.applicationId, profileId: w.consultant }),
  propose_follow_up_sent: (w) => ({ applicationId: w.appliedId }),
  propose_interview: (w) => ({ applicationId: w.applicationId, scheduledAt: "2026-12-10T14:00" }),
  propose_interview_change: (w) => ({ applicationId: w.applicationId, interviewId: w.interviewId, place: "Visioconférence" }),
  propose_interview_cancel: (w) => ({ applicationId: w.applicationId, interviewId: w.interviewId }),
  propose_search_criteria: (w) => ({ profileId: w.daf, addLocations: ["Paris"], minSalary: 90000 }),
  propose_master_cv_changes: (w) => ({
    profileId: w.daf,
    changes: [
      { kind: "rephrase", section: "summary", text: "Vingt-cinq ans de pilotage financier dans l'industrie." },
      { kind: "highlight", section: "skills", item: "Consolidation" },
    ],
  }),
  propose_profile_archive: (w) => ({ profileId: w.consultant }),
  propose_profile_restore: (w) => ({ profileId: w.archived }),
  propose_coach_memory: () => ({ kind: "goal", text: "Un poste de DAF dans l'aéronautique." }),
  propose_job_search: (w) => ({ profileId: w.daf }),
  propose_job_search_stop: (w) => ({ profileId: w.consultant }),
  propose_job_digest_frequency: (w) => ({ profileId: w.daf, frequency: "weekly" }),
  propose_tailored_cv: (w) => ({ applicationId: w.applicationId }),
  propose_cover_letter: (w) => ({ applicationId: w.applicationId }),
  propose_outreach_message: (w) => ({ applicationId: w.applicationId }),
};

const RECORDER = { step: <T>(_step: unknown, run: () => Promise<T>) => run(), site: () => {} };

describe.skipIf(!connectionString)("a Coach Action never writes: only the Candidate's « Appliquer » does (ADR-0077, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let applications: Applications;
  let catalog: readonly CoachAction[];
  let marie: string;
  let world: World;
  /** The in-memory modules' writes, by name: none may be called while proposing. */
  let writes: ReturnType<typeof vi.fn>[];

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  /** Every table of the database, row by row, as one fingerprint per table. */
  async function snapshot(): Promise<Record<string, string>> {
    const { rows: tables } = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const fingerprints: Record<string, string> = {};
    for (const { table_name: table } of tables) {
      const { rows } = await database.query<{ fingerprint: string | null }>(`SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS fingerprint FROM "${table}" t`);
      fingerprints[table] = rows[0]!.fingerprint ?? "empty";
    }
    return fingerprints;
  }

  const offered = async (): Promise<CoachActionsForReply> => {
    const forReply = await createCoachActions({ catalog, settings: async () => ({ enabled: true, maxRounds: 2 }), externalApis: { record: () => {} } }).forReply(marie, {
      recorder: RECORDER,
      untrustedInView: false,
    });
    if (!forReply) throw new Error("no Coach Action offered");
    return forReply;
  };

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    for (const migrate of [migrateProfiles, migrateJobOffers, migrateApplications, migrateJobSearches, migrateJobDigests, migrateActionCards, migrateFollowUps, migrateCoachMemory, migrateCoachConversations, migrateActionCardsInThread]) {
      await migrate(database);
    }
    profiles = createProfiles(database);
    const jobOffers = createJobOffers(database);
    applications = createApplications(database, { jobOffers, profiles });
    const followUps = createFollowUps(database, { actionCards: createActionCards(database), applications, mailer: { send: async () => {} }, appUrl: "https://app.jobbbox.test" });
    const coachMemory = createCoachMemory(database, { ai: {} as never, conversations: { open: async () => null } });
    marie = await signIn("marie.dupont@example.fr");

    const profile = async (name: string) => {
      const created = await profiles.create(marie, { masterCv, searchCriteria: { targetRole: name, locations: ["Lyon"], contractTypes: ["cdi"] } });
      if (!created.ok) throw new Error("fixture Profile refused");
      await database.query(`UPDATE profile SET name = $2 WHERE id = $1`, [created.profile.id, name]);
      return created.profile.id;
    };
    const offer = async (n: number, title: string) => {
      const captured = await jobOffers.capture({ source: { url: `https://www.apec.fr/offre/${n}` }, title, content: `${title} pour un groupe industriel.`, employer: "Acme Industrie" });
      if (!captured.ok) throw new Error("fixture Job Offer refused");
      return captured.jobOffer.id;
    };
    const daf = await profile("DAF");
    const consultant = await profile("Consultante finance");
    const archived = await profile("Ancien profil");
    await profiles.archive(marie, archived);
    const saved = await applications.save(marie, { jobOfferId: await offer(1, "DAF H/F"), profileId: daf });
    if (!saved.ok) throw new Error("fixture Application refused");
    await applications.change(marie, saved.application.id, { status: "interview" });
    const added = await applications.addInterview(marie, saved.application.id, { scheduledAt: "2026-12-01T10:00", durationMinutes: 60, format: "on_site", place: "Siège, Lyon" });
    if (!added.ok) throw new Error(`fixture Interview refused: ${JSON.stringify(added)}`);
    const applied = await applications.save(marie, { jobOfferId: await offer(3, "Contrôleuse de gestion"), profileId: daf });
    if (!applied.ok) throw new Error("fixture Application refused");
    await applications.change(marie, applied.application.id, { status: "applied" });
    world = {
      daf,
      consultant,
      archived,
      applicationId: saved.application.id,
      appliedId: applied.application.id,
      interviewId: added.interviewId,
      newOfferId: await offer(2, "Directrice financière de transition"),
    };

    // The modules without a table here, in memory: their writes are spies, which proposing must never call.
    const write = () => vi.fn(async () => ({ ok: false as const, error: "not_found" as const }));
    const searching = { id: "s1", profile: { id: consultant, name: "Consultante finance", searchCriteria: {} }, status: "searching", failure: null, startedAt: new Date(), results: [], metrics: null, provenance: null };
    const domain: CoachActionDomain = {
      applications,
      profiles,
      jobOffers,
      followUps,
      profile: { profiles, coachMemory, places: { suggest: async () => [] }, offersOf: async () => [], profileUpgradePrompt: async () => null },
      jobSearches: {
        get: async (_candidateId, id) => (id === searching.id ? (searching as never) : null),
        latest: async () => null,
        searching: async (_candidateId, profileId) => (profileId === consultant ? (searching as never) : null),
        start: write(),
        stop: write(),
      },
      jobDigests: {
        settings: async () => ({ subscribed: false, chosenFrequency: null, frequency: "none", planFrequency: "weekly", upgradeTo: null, digests: [] }),
        allows: async () => ({ ok: true }),
        subscribe: write(),
        unsubscribe: write() as never,
        get: async () => null,
      },
      jobSearchQuota: async () => ({ used: 0, limit: 5, refusal: null }),
      tailoredCvs: { get: async () => ({ documentLanguage: "fr", proposal: null, saved: null }) },
      tailoredDocuments: { get: async () => ({ documentLanguage: "fr", coverLetter: null, outreachMessage: null }) },
    };
    writes = [domain.jobSearches.start, domain.jobSearches.stop, domain.jobDigests.subscribe, domain.jobDigests.unsubscribe] as unknown as ReturnType<typeof vi.fn>[];
    // A Job Offer is within reach when one of the Candidate's objects shows it: the new one, which her Job Search found.
    const objects: CoachObjectReader = { index: async () => [], read: async (_candidateId, type, id) => (type === "job_offer" && id === world.newOfferId ? ({ text: "" } as never) : null) };
    catalog = shippedCoachActions(objects, domain);
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("lists every proposing Coach Action of the catalogue, each applied only through its card", () => {
    const proposing = catalog.filter((action) => action.kind === "propose");
    expect(proposing.map((action) => action.name).sort()).toEqual(Object.keys(CALLS).sort());
    // A proposal no card can apply would be lost, or applied some other way.
    expect(proposing.filter((action) => typeof action.apply !== "function").map((action) => action.name)).toEqual([]);
  });

  for (const name of Object.keys(CALLS)) {
    it(`${name}: proposed in a reply, nothing written anywhere`, async () => {
      const before = await snapshot();
      const reply = await offered();
      const outcome = await reply.runTool({ id: "call-1", name, arguments: CALLS[name]!(world), round: 1 } as never, {});

      expect(outcome.error, outcome.content).toBeFalsy();
      expect(reply.proposals().map((proposal) => proposal.action)).toEqual([name]);
      expect(await snapshot()).toEqual(before);
      for (const each of writes) expect(each).not.toHaveBeenCalled();
    });
  }

  it("a proposal placed under a reply adds its pending card and nothing else; only « Appliquer » changes the Profile", async () => {
    const actionCards = createActionCards(database, coachProposalHandlers(catalog, () => new Date("2026-11-05T10:00:00Z")));
    const proposals = createCoachProposals({ catalog, actionCards });
    const { rows } = await database.query<{ id: string }>(`INSERT INTO coach_conversation (candidate_id, title) VALUES ($1, 'DAF') RETURNING id`, [marie]);
    const { rows: replies } = await database.query<{ seq: string }>(`INSERT INTO coach_message (conversation_id, author, text) VALUES ($1, 'coach', 'Je vous le propose.') RETURNING seq`, [rows[0]!.id]);

    const reply = await offered();
    await reply.runTool({ id: "call-1", name: "propose_search_criteria", arguments: CALLS.propose_search_criteria!(world), round: 1 } as never, {});
    const before = await snapshot();
    const [card] = await proposals.place(marie, { reply: replies[0]!.seq, earlier: [] }, reply.proposals());
    const after = await snapshot();
    expect(Object.keys(after).filter((table) => after[table] !== before[table])).toEqual(["action_card"]);
    expect((await profiles.get(marie, world.daf))!.searchCriteria.locations).toEqual(["Lyon"]);

    const decided = await actionCards.decide(marie, card!.id, "accept");
    expect(decided.ok).toBe(true);
    expect((await profiles.get(marie, world.daf))!.searchCriteria.locations).toEqual(["Lyon", "Paris"]);
  });

  it("a saved Master CV Version is never changed in place, by anyone: the database refuses it", async () => {
    await expect(database.query(`UPDATE master_cv_version SET content = content || '{"summary": "écrit en place"}'::jsonb WHERE profile_id = $1`, [world.daf])).rejects.toThrow(
      /never changed/,
    );
    expect((await profiles.get(marie, world.daf))!.masterCv).toEqual({ version: 1, content: masterCv });
  });
});

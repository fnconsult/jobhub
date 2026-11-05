import type { MasterCvContent, SearchCriteria } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionCards, migrateActionCards, type ActionCards } from "../action-cards";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { UpgradePrompt } from "../billing/upgrade-prompt";
import { createCoachMemory, migrateCoachMemory, type CoachMemory } from "../coach-memory";
import { COACH_PROPOSAL_CARD, coachProposalHandlers } from "../coach-proposals";
import { createProfiles, migrateProfiles, type Profile, type Profiles } from "../profiles";
import type { CoachAction, CoachActionResult, ProposedChange } from "./index";
import { PROFILE_ACTIONS, profileCoachActions } from "./profile";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "25 ans dans l'industrie.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Pilotage financier." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};
const criteria: SearchCriteria = { targetRole: "Directrice financière", locations: ["Paris"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] };
const APPLIED_AT = new Date("2026-11-05T10:20:00Z");
const FULL: UpgradePrompt = { title: "Limite atteinte", message: "Votre forfait permet 1 profil actif.", upgradeTo: null, action: null, href: "/abonnement" };

describe.skipIf(!connectionString)("Coach Actions « Profil » (#719, needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let coachMemory: CoachMemory;
  let actionCards: ActionCards;
  let catalog: CoachAction[];
  let marie: string;
  let profile: Profile;
  let quotaFull: boolean;

  async function signIn(email: string) {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id as string;
  }

  const action = (name: string) => catalog.find((each) => each.name === name)!;

  async function run(name: string, args: unknown, candidateId = marie): Promise<CoachActionResult> {
    const each = action(name);
    return each.run(each.schema.parse(args), { candidateId, language: "fr" });
  }

  /** What `name` proposes with `args`, as a pending card under a reply: its id and ProposedChange. */
  async function proposed(name: string, args: unknown): Promise<{ cardId: string; change: ProposedChange }> {
    const result = await run(name, args);
    if (!result.ok) throw new Error(`not proposed: ${JSON.stringify(result)}`);
    const change = result.data as ProposedChange;
    const card = await actionCards.propose(marie, { kind: COACH_PROPOSAL_CARD, title: change.what, body: `${change.before} → ${change.after}`, focus: { kind: "profile", id: profile.id }, payload: { action: name, change } });
    return { cardId: card.id, change };
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateCoachMemory(database);
    await migrateActionCards(database);
    profiles = createProfiles(database);
    coachMemory = createCoachMemory(database, { ai: {} as never, conversations: { open: async () => null } });
    quotaFull = false;
    catalog = profileCoachActions({
      profiles,
      coachMemory,
      places: { suggest: async (query) => (query.toLowerCase().startsWith("lyon") ? [{ name: "Lyon (69)", kind: "commune" }] : []) },
      offersOf: async () => ["Directeur financier, secteur aéronautique. Maîtrise de Kyriba."],
      profileUpgradePrompt: async () => (quotaFull ? FULL : null),
    });
    actionCards = createActionCards(database, coachProposalHandlers(catalog, () => APPLIED_AT));
    marie = await signIn("marie.dupont@example.fr");
    const created = await profiles.create(marie, { masterCv, searchCriteria: criteria });
    if (!created.ok) throw new Error("no Profile");
    profile = created.profile;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("ships the Profil group: Search Criteria, Master CV, archive, restore and Coach Memory, copying text but for archive and restore", () => {
    expect(catalog.map((each) => [each.name, each.group, each.kind, each.copiesText])).toEqual([
      [PROFILE_ACTIONS.searchCriteria, "profile", "propose", true],
      [PROFILE_ACTIONS.masterCv, "profile", "propose", true],
      [PROFILE_ACTIONS.archive, "profile", "propose", false],
      [PROFILE_ACTIONS.restore, "profile", "propose", false],
      [PROFILE_ACTIONS.coachMemory, "profile", "propose", true],
    ]);
    // A Master CV change has no « Annuler » other than a Restore, and every one of them is applied by the Candidate.
    expect(catalog.every((each) => each.apply && each.undo)).toBe(true);
  });

  describe("propose_search_criteria", () => {
    it("« ajoute Lyon à mes lieux » → a card with the place as Place suggestion names it → Appliquer → Annuler: the criteria before", async () => {
      const { cardId, change } = await proposed(PROFILE_ACTIONS.searchCriteria, { profileId: profile.id, addLocations: ["Lyon"] });
      expect(change).toMatchObject({ target: { kind: "profile", id: profile.id, name: profile.name, href: `/profils/${profile.id}` }, what: "Critères de recherche", before: "Lieux : Paris", after: "Lieux : Paris, Lyon (69)" });
      expect(change.fields.map((field) => field.name)).toEqual(["locations"]);
      // Proposed: nothing changed yet.
      expect((await profiles.get(marie, profile.id))?.searchCriteria.locations).toEqual(["Paris"]);

      expect(await actionCards.decide(marie, cardId, "accept")).toMatchObject({ ok: true, card: { status: "accepted", undoable: true } });
      expect(await profiles.get(marie, profile.id)).toMatchObject({
        searchCriteria: { locations: ["Paris", "Lyon (69)"], targetRole: "Directrice financière" },
        searchCriteriaOrigin: { origin: "coach_proposal", cardId, appliedAt: APPLIED_AT },
      });

      expect(await actionCards.undo(marie, cardId)).toMatchObject({ ok: true, card: { status: "undone" } });
      const back = await profiles.get(marie, profile.id);
      expect(back?.searchCriteria).toEqual(criteria);
      expect(back?.searchCriteriaOrigin).toBeUndefined();
    });

    it("applies what the Candidate edited in the page's form, one place per line", async () => {
      const { cardId } = await proposed(PROFILE_ACTIONS.searchCriteria, { profileId: profile.id, addLocations: ["Lyon"], minSalary: 90000 });
      expect(await actionCards.decide(marie, cardId, "accept", { edited: { locations: "Paris\nGrenoble", minSalary: "95000" } })).toMatchObject({ ok: true });
      expect((await profiles.get(marie, profile.id))?.searchCriteria).toMatchObject({ locations: ["Paris", "Grenoble"], minSalary: 95000 });
    });

    it("is refused as a conflict once the criteria changed on the page, and never merged; « Annuler » too", async () => {
      const first = await proposed(PROFILE_ACTIONS.searchCriteria, { profileId: profile.id, addLocations: ["Lyon"] });
      await profiles.changeSearchCriteria(marie, profile.id, { searchCriteria: { ...criteria, locations: ["Paris", "Nantes"] } });
      expect(await actionCards.decide(marie, first.cardId, "accept")).toEqual({ ok: false, error: "conflict" });
      expect((await profiles.get(marie, profile.id))?.searchCriteria.locations).toEqual(["Paris", "Nantes"]);

      const second = await proposed(PROFILE_ACTIONS.searchCriteria, { profileId: profile.id, targetRole: "DAF" });
      await actionCards.decide(marie, second.cardId, "accept");
      await profiles.changeSearchCriteria(marie, profile.id, { searchCriteria: { ...criteria, targetRole: "DAF", locations: ["Paris"] } });
      expect(await actionCards.undo(marie, second.cardId)).toEqual({ ok: false, error: "conflict" });
      expect((await profiles.get(marie, profile.id))?.searchCriteria).toMatchObject({ targetRole: "DAF", locations: ["Paris"] });
    });

    it("refuses criteria the Profile's page would refuse, and says why; nothing about another Candidate's or an Archived Profile", async () => {
      expect(await run(PROFILE_ACTIONS.searchCriteria, { profileId: profile.id, addLocations: ["Lille", "Lens", "Arras", "Douai", "Calais"] })).toMatchObject({ ok: false, error: "refused", reason: expect.stringMatching(/5 lieux/) });
      expect(await run(PROFILE_ACTIONS.searchCriteria, { profileId: profile.id, addLocations: ["Paris"] })).toMatchObject({ ok: false, error: "refused" });
      expect(await run(PROFILE_ACTIONS.searchCriteria, { profileId: profile.id, addLocations: ["Lyon"] }, await signIn("paul.martin@example.fr"))).toEqual({ ok: false, error: "not_found" });
      await profiles.archive(marie, profile.id);
      expect(await run(PROFILE_ACTIONS.searchCriteria, { profileId: profile.id, addLocations: ["Lyon"] })).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_master_cv_changes", () => {
    const edits = {
      changes: [
        { kind: "rephrase", section: "experience", item: "Groupe Seb", description: "Pilotage financier d'un groupe industriel." },
        { kind: "rephrase", section: "summary", text: "25 ans dans l'industrie aéronautique." },
      ],
    };

    it("is reviewed change by change: a Flagged Change is never saved without an accept; the accepted ones make one Master CV Version, with its Origin", async () => {
      const { cardId, change } = await proposed(PROFILE_ACTIONS.masterCv, { profileId: profile.id, ...edits });
      expect(change).toMatchObject({ what: "CV de référence", before: "Version 1", after: "2 changements à relire", fields: [] });
      expect(change.target.href).toBe(`/profils/${profile.id}/cv-de-reference`);
      expect(change.review?.changes).toEqual([
        expect.objectContaining({ id: "summary.rephrased", fromOffer: ["aéronautique"] }),
        expect.objectContaining({ id: "experience.rephrased.0" }),
      ]);
      expect(change.review?.changes[1]?.fromOffer).toBeUndefined();

      // « Appliquer » in one click does not exist: without the accepted changes, nothing is saved.
      expect(await actionCards.decide(marie, cardId, "accept")).toMatchObject({ ok: false, error: "invalid" });
      expect(await actionCards.decide(marie, cardId, "accept", { edited: {} })).toMatchObject({ ok: false, error: "invalid" });
      expect((await profiles.get(marie, profile.id))?.masterCv.version).toBe(1);

      // The Flagged Change not accepted: the Master CV's words stay.
      expect(await actionCards.decide(marie, cardId, "accept", { edited: { accepted: ["experience.rephrased.0"] } })).toMatchObject({ ok: true, card: { undoable: true } });
      const saved = await profiles.get(marie, profile.id);
      expect(saved?.masterCv.version).toBe(2);
      expect(saved?.masterCv.content.summary).toBe(masterCv.summary);
      expect(saved?.masterCv.content.experience[0]?.description).toBe("Pilotage financier d'un groupe industriel.");
      const versions = await profiles.masterCvVersions(marie, profile.id);
      expect(versions?.[0]).toMatchObject({ version: 2, origin: { origin: "coach_proposal", cardId, appliedAt: APPLIED_AT } });
    });

    it("« Annuler » is a Restore of the version before: a new version, the history kept", async () => {
      const { cardId } = await proposed(PROFILE_ACTIONS.masterCv, { profileId: profile.id, ...edits });
      await actionCards.decide(marie, cardId, "accept", { edited: { accepted: ["experience.rephrased.0", "summary.rephrased"] } });

      expect(await actionCards.undo(marie, cardId)).toMatchObject({ ok: true, card: { status: "undone" } });
      const versions = await profiles.masterCvVersions(marie, profile.id);
      expect(versions?.map((version) => [version.version, version.restoredFrom])).toEqual([
        [3, 1],
        [2, null],
        [1, null],
      ]);
      expect(versions?.[0]?.content).toEqual(masterCv);
    });

    it("is refused as a conflict when a newer version arrived since the proposal, or since it was applied", async () => {
      const first = await proposed(PROFILE_ACTIONS.masterCv, { profileId: profile.id, ...edits });
      await profiles.saveMasterCv(marie, profile.id, { basedOnVersion: 1, content: { ...masterCv, headline: "DAF" } });
      expect(await actionCards.decide(marie, first.cardId, "accept", { edited: { accepted: ["experience.rephrased.0"] } })).toEqual({ ok: false, error: "conflict" });
      expect((await profiles.get(marie, profile.id))?.masterCv.version).toBe(2);

      const second = await proposed(PROFILE_ACTIONS.masterCv, { profileId: profile.id, ...edits });
      await actionCards.decide(marie, second.cardId, "accept", { edited: { accepted: ["experience.rephrased.0"] } });
      await profiles.saveMasterCv(marie, profile.id, { basedOnVersion: 3, content: { ...masterCv, headline: "DAF industrie" } });
      expect(await actionCards.undo(marie, second.cardId)).toEqual({ ok: false, error: "conflict" });
      expect((await profiles.get(marie, profile.id))?.masterCv).toMatchObject({ version: 4, content: { headline: "DAF industrie" } });
    });

    it("never proposes a fact absent from the Master CV: an item it does not have, or a figure it does not state, is refused", async () => {
      expect(await run(PROFILE_ACTIONS.masterCv, { profileId: profile.id, changes: [{ kind: "highlight", section: "skills", item: "Kyriba" }] })).toMatchObject({
        ok: false,
        error: "refused",
        reason: expect.stringContaining("Kyriba"),
      });
      expect(await run(PROFILE_ACTIONS.masterCv, { profileId: profile.id, changes: [{ kind: "rephrase", section: "summary", text: "30 ans dans l'industrie." }] })).toMatchObject({
        ok: false,
        error: "refused",
      });
    });
  });

  describe("propose_profile_archive and propose_profile_restore", () => {
    it("archives a Profile, « Annuler » restores it; restoring one says the Plan Quota it uses, the Upgrade prompt without room", async () => {
      const archive = await proposed(PROFILE_ACTIONS.archive, { profileId: profile.id });
      expect(archive.change).toMatchObject({ what: "Statut du profil", before: "Actif", after: "Archivé" });
      expect(archive.change.quota).toBeUndefined();
      await actionCards.decide(marie, archive.cardId, "accept");
      expect((await profiles.get(marie, profile.id))?.archived).toBe(true);
      await actionCards.undo(marie, archive.cardId);
      expect((await profiles.get(marie, profile.id))?.archived).toBe(false);

      await profiles.archive(marie, profile.id);
      // An Archived Profile is found by its name, to be restored.
      const restore = await proposed(PROFILE_ACTIONS.restore, { name: "directrice financiere" });
      expect(restore.change).toMatchObject({ target: { id: profile.id }, before: "Archivé", after: "Actif", quota: { label: expect.any(String) } });
      expect(restore.change.quota?.prompt).toBeUndefined();
      await actionCards.decide(marie, restore.cardId, "accept");
      expect((await profiles.get(marie, profile.id))?.archived).toBe(false);
      await actionCards.undo(marie, restore.cardId);
      expect((await profiles.get(marie, profile.id))?.archived).toBe(true);

      quotaFull = true;
      expect((await proposed(PROFILE_ACTIONS.restore, { profileId: profile.id })).change.quota).toEqual({ label: expect.any(String), prompt: FULL });
      expect(await run(PROFILE_ACTIONS.archive, { profileId: profile.id })).toEqual({ ok: false, error: "not_found" });
    });
  });

  describe("propose_coach_memory", () => {
    it("proposes one fact to remember, confirmed by the Candidate's « Appliquer »; « Annuler » forgets it", async () => {
      const { cardId, change } = await proposed(PROFILE_ACTIONS.coachMemory, { kind: "goal", text: "Un poste de DAF à Lyon" });
      expect(change).toMatchObject({ target: { kind: "coach_memory", name: "Mémoire du coach", href: "" }, after: "Objectif : Un poste de DAF à Lyon" });
      expect(await coachMemory.list(marie)).toEqual([]);

      await actionCards.decide(marie, cardId, "accept", { edited: { kind: "constraint", text: "Pas de déplacements" } });
      expect((await coachMemory.list(marie)).map(({ kind, text }) => ({ kind, text }))).toEqual([{ kind: "constraint", text: "Pas de déplacements" }]);
      await actionCards.undo(marie, cardId);
      expect(await coachMemory.list(marie)).toEqual([]);
    });

    it("refuses a fact already remembered, one over 300 characters, and any once the Coach Memory holds 30", async () => {
      await coachMemory.confirm(marie, { kind: "goal", text: "Un poste de DAF à Lyon" });
      expect(await run(PROFILE_ACTIONS.coachMemory, { kind: "goal", text: "un poste de DAF à  Lyon" })).toMatchObject({ ok: false, error: "refused" });
      expect(action(PROFILE_ACTIONS.coachMemory).schema.safeParse({ kind: "goal", text: "x".repeat(301) }).success).toBe(false);
      for (let index = 1; index < 30; index += 1) await coachMemory.confirm(marie, { kind: "decision", text: `Décision ${index}` });
      expect(await run(PROFILE_ACTIONS.coachMemory, { kind: "goal", text: "Encore un" })).toMatchObject({ ok: false, error: "refused", reason: expect.stringMatching(/30/) });
    });
  });
});

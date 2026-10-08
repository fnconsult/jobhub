import type { MasterCvContent } from "@jobhub/shared";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionCards, migrateActionCards, type ActionCards } from "../action-cards";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import type { QuotaDecision } from "../billing";
import { createProfiles, migrateProfiles, type Profiles } from "../profiles";
import { createAtsScoring, migrateAtsScores, type AtsScoring } from "./index";

/** Lists every finance keyword but Trésorerie, which it only mentions; says the Candidate's age. */
const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière, 58 ans",
  email: "marie.dupont@example.fr",
  phone: "06 12 34 56 78",
  location: "Lyon",
  summary: "J'ai piloté la trésorerie d'un groupe coté.",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "Budget et consolidation." }],
  education: [{ degree: "Master Finance", institution: "ESSEC", year: "1998" }],
  skills: ["IFRS", "SAP", "Budget", "Consolidation", "Reporting", "Contrôle de gestion", "Clôture", "ERP"],
  languages: [],
};

const REFUSED: QuotaDecision = { allowed: false, quota: "atsScores", plan: "free", limit: 1, upgradeTo: "standard" };

describe.skipIf(!connectionString)("ATS Scoring (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let profiles: Profiles;
  let actionCards: ActionCards;
  let scoring: AtsScoring;
  let quotaAsked: string[];
  let quota: QuotaDecision;
  let marie: string;
  let profileId: string;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  const page = () => ({ kind: "profile", id: profileId }) as const;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateProfiles(database);
    await migrateActionCards(database);
    await migrateAtsScores(database);
    await migrateAtsScores(database); // safe to run twice
    profiles = createProfiles(database);
    quotaAsked = [];
    quota = { allowed: true, remaining: null };
    // The two modules need each other: accepting an "ats_fix" card is ATS Scoring's job.
    actionCards = createActionCards(database, { onAccept: { ats_fix: (card, candidateId) => scoring.acceptFix(card, candidateId) } });
    scoring = createAtsScoring({
      database,
      profiles,
      actionCards,
      atsScoreQuota: async (candidateId) => {
        quotaAsked.push(candidateId);
        return quota;
      },
    });
    marie = await candidate("marie.dupont@example.fr");
    const created = await profiles.create(marie, { masterCv, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } });
    if (!created.ok) throw new Error("fixture Profile refused");
    profileId = created.profile.id;
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("scores the current Master CV against the Profile's target role and keeps the score for the Profile page", async () => {
    const result = await scoring.analyse(marie, profileId, "fr");

    expect(result).toMatchObject({ ok: true, atsScore: { version: 1, score: { score: 97 } } });
    if (!result.ok) return;
    expect(result.atsScore.score.breakdown.keywords.mentioned).toEqual(["Trésorerie"]);
    expect(await scoring.latest(marie, profileId)).toEqual(result.atsScore);
    expect(quotaAsked).toEqual([marie]);
  });

  it("proposes each ATS Fix as an Action Card on the Profile, Senior Advice labelled as such", async () => {
    await scoring.analyse(marie, profileId, "fr");

    const cards = await actionCards.pending(marie, page());
    expect(cards.map((card) => ({ kind: card.kind, title: card.title, category: (card.payload as { fix: { category: string } }).fix.category }))).toEqual([
      { kind: "ats_fix", title: "Ajoutez « Trésorerie » à vos compétences", category: "keywords" },
      { kind: "ats_fix", title: "Conseil senior : retirez votre âge", category: "senior_advice" },
    ]);
    expect(cards[1]!.body).toMatch(/facultatif/);
  });

  it("writes the cards in the Candidate's Interface Language", async () => {
    await scoring.analyse(marie, profileId, "en");

    expect((await actionCards.pending(marie, page())).map((card) => card.title)).toEqual([
      "Add “Trésorerie” to your skills",
      "Senior Advice: remove your age",
    ]);
  });

  it("advises leaving out the photo of a CV that shows one, in either language, and records it once accepted", async () => {
    const withPhoto = { masterCv: { ...masterCv, photo: true }, searchCriteria: { targetRole: "Directrice financière", location: "Lyon" } };
    const english = await profiles.create(marie, withPhoto);
    if (!english.ok) throw new Error("fixture Profile refused");
    await scoring.analyse(marie, english.profile.id, "en");
    expect((await actionCards.pending(marie, { kind: "profile", id: english.profile.id })).map((card) => card.title)).toContain(
      "Senior Advice: leave out your photo",
    );

    await profiles.saveMasterCv(marie, profileId, { basedOnVersion: 1, content: withPhoto.masterCv });
    await scoring.analyse(marie, profileId, "fr");
    const card = (await actionCards.pending(marie, page())).find((pending) => pending.title === "Conseil senior : retirez votre photo");
    expect(card?.body).toMatch(/facultatif/);

    expect(await actionCards.decide(marie, card!.id, "accept")).toMatchObject({ ok: true });
    expect((await profiles.get(marie, profileId))!.masterCv).toMatchObject({ version: 3, content: { photo: false } });
  });

  it("applies an accepted fix as a new Master CV version and recomputes the score, without counting it", async () => {
    await scoring.analyse(marie, profileId, "fr");
    const [keywordFix] = await actionCards.pending(marie, page());

    expect(await actionCards.decide(marie, keywordFix!.id, "accept")).toMatchObject({ ok: true });

    const profile = await profiles.get(marie, profileId);
    expect(profile!.masterCv.version).toBe(2);
    expect(profile!.masterCv.content.skills).toEqual([...masterCv.skills, "Trésorerie"]);
    expect(await scoring.latest(marie, profileId)).toMatchObject({ version: 2, score: { score: 100 } });
    expect(quotaAsked).toHaveLength(1);
  });

  it("applies each accepted fix on its own, one version each", async () => {
    await scoring.analyse(marie, profileId, "fr");
    const [keywordFix, seniorAdvice] = await actionCards.pending(marie, page());

    await actionCards.decide(marie, seniorAdvice!.id, "accept");
    await actionCards.decide(marie, keywordFix!.id, "accept");

    const versions = await profiles.masterCvVersions(marie, profileId);
    expect(versions!.map((version) => [version.version, version.content.headline, version.content.skills.includes("Trésorerie")])).toEqual([
      [3, "Directrice financière", true],
      [2, "Directrice financière", false],
      [1, "Directrice financière, 58 ans", false],
    ]);
  });

  it("changes nothing for a rejected fix, and does not propose it again", async () => {
    await scoring.analyse(marie, profileId, "fr");
    const [, seniorAdvice] = await actionCards.pending(marie, page());

    await actionCards.decide(marie, seniorAdvice!.id, "dismiss");
    expect((await profiles.get(marie, profileId))!.masterCv.version).toBe(1);

    await scoring.analyse(marie, profileId, "fr");
    expect((await actionCards.pending(marie, page())).map((card) => card.title)).toEqual(["Ajoutez « Trésorerie » à vos compétences"]);
  });

  it("keeps a fix pending when the Master CV no longer has what it changes", async () => {
    await scoring.analyse(marie, profileId, "fr");
    const [keywordFix] = await actionCards.pending(marie, page());
    await profiles.saveMasterCv(marie, profileId, { basedOnVersion: 1, content: { ...masterCv, skills: [...masterCv.skills, "Trésorerie"] } });

    expect(await actionCards.decide(marie, keywordFix!.id, "accept")).toEqual({ ok: false, error: "failed" });
    expect((await profiles.get(marie, profileId))!.masterCv.version).toBe(2);
  });

  it("refuses beyond the Plan Quota, without scoring or proposing anything", async () => {
    quota = REFUSED;

    expect(await scoring.analyse(marie, profileId, "fr")).toEqual({ ok: false, error: "quota_exceeded", refusal: REFUSED });
    expect(await scoring.latest(marie, profileId)).toBeNull();
    expect(await actionCards.pending(marie, page())).toEqual([]);
  });

  it("never scores or shows someone else's Profile", async () => {
    const jean = await candidate("jean.martin@example.fr");

    expect(await scoring.analyse(jean, profileId, "fr")).toEqual({ ok: false, error: "not_found" });
    await scoring.analyse(marie, profileId, "fr");
    expect(await scoring.latest(jean, profileId)).toBeNull();
    expect(quotaAsked).toEqual([marie]);
  });
});

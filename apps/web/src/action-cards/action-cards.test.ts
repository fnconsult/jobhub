import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createActionCards, migrateActionCards, type ActionCard } from "./index";

const PROFILE = { kind: "profile", id: "11111111-1111-4111-8111-111111111111" } as const;
const OTHER_PROFILE = { kind: "profile", id: "22222222-2222-4222-8222-222222222222" } as const;

const proposal = {
  kind: "ats_fix",
  title: "Ajoutez « IFRS » à vos compétences",
  body: "Les offres de Directrice financière le demandent souvent.",
  focus: PROFILE,
  payload: { skill: "IFRS" },
};

describe.skipIf(!connectionString)("Action Cards (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let marie: string;
  let jean: string;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateActionCards(database);
    await migrateActionCards(database); // safe to run twice
    marie = await candidate("marie.dupont@example.fr");
    jean = await candidate("jean.martin@example.fr");
  });
  afterEach(async () => {
    await testAuth.stop();
  });

  it("shows the AI Coach's proposal on the page it is about, until the Candidate decides", async () => {
    const cards = createActionCards(database);
    const proposed = await cards.propose(marie, proposal);

    expect(proposed).toEqual({ ...proposal, id: expect.any(String), status: "pending", createdAt: expect.any(Date) });
    expect(await cards.pending(marie, PROFILE)).toEqual([proposed]);
    expect(await cards.pending(marie, OTHER_PROFILE)).toEqual([]);
  });

  it("applies an accepted card through its kind's handler, then takes it off the page", async () => {
    const applied: { candidateId: string; card: ActionCard }[] = [];
    const cards = createActionCards(database, { onAccept: { ats_fix: async (card, candidateId) => void applied.push({ card, candidateId }) } });
    const { id } = await cards.propose(marie, proposal);

    const decided = await cards.decide(marie, id, "accept");

    expect(decided).toMatchObject({ ok: true, card: { id, status: "accepted" } });
    expect(applied).toMatchObject([{ candidateId: marie, card: { id, payload: { skill: "IFRS" } } }]);
    expect(await cards.pending(marie, PROFILE)).toEqual([]);
  });

  it("takes a dismissed card off the page without applying it", async () => {
    let applied = 0;
    const cards = createActionCards(database, { onAccept: { ats_fix: async () => void applied++ } });
    const { id } = await cards.propose(marie, proposal);

    expect(await cards.decide(marie, id, "dismiss")).toMatchObject({ ok: true, card: { status: "dismissed" } });
    expect(applied).toBe(0);
    expect(await cards.pending(marie, PROFILE)).toEqual([]);
  });

  it("decides a card only once", async () => {
    let applied = 0;
    const cards = createActionCards(database, { onAccept: { ats_fix: async () => void applied++ } });
    const { id } = await cards.propose(marie, proposal);

    await cards.decide(marie, id, "accept");
    expect(await cards.decide(marie, id, "accept")).toEqual({ ok: false, error: "already_decided" });
    expect(await cards.decide(marie, id, "dismiss")).toEqual({ ok: false, error: "already_decided" });
    expect(applied).toBe(1);
  });

  it("keeps the card on the page when applying it fails", async () => {
    const cards = createActionCards(database, {
      onAccept: {
        ats_fix: async () => {
          throw new Error("Master CV changed meanwhile");
        },
      },
    });
    const { id } = await cards.propose(marie, proposal);

    expect(await cards.decide(marie, id, "accept")).toEqual({ ok: false, error: "failed" });
    expect(await cards.pending(marie, PROFILE)).toMatchObject([{ id, status: "pending" }]);
  });

  it("never shows or lets anyone else decide a Candidate's cards", async () => {
    const cards = createActionCards(database);
    const { id } = await cards.propose(marie, proposal);

    expect(await cards.pending(jean, PROFILE)).toEqual([]);
    expect(await cards.decide(jean, id, "dismiss")).toEqual({ ok: false, error: "not_found" });
    expect(await cards.decide(marie, "not-a-uuid", "dismiss")).toEqual({ ok: false, error: "not_found" });
    expect(await cards.pending(marie, PROFILE)).toHaveLength(1);
  });
});

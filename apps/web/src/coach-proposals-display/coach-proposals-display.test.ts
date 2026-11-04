import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CoachProposalCard } from "../coach-proposals/card";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { coachProposalsDisplayOf, createCoachProposalsDisplays, migrateCoachProposalsDisplay } from "./index";
import { DEFAULT_COACH_PROPOSALS_DISPLAY, formOpenedOnArrival, readCoachProposalsDisplay } from "./choice";

const card = (id: string, more: Partial<CoachProposalCard> = {}, fields = true): CoachProposalCard => ({
  id,
  status: "pending",
  change: {
    target: { kind: "application", id: "a1", name: "DAF H/F · Acme", href: "/candidatures/a1" },
    what: "Statut de la candidature",
    before: "Postulée",
    after: "Entretien",
    value: { status: "interview" },
    fields: fields ? [{ name: "status", label: "Statut de la candidature", type: "select", options: [{ value: "interview", label: "Entretien" }] }] : [],
  },
  undoable: false,
  ...more,
});

const DESK = { phone: false, typing: false };

describe("Propositions du coach (setting) — the two values (#717, ADR-0077)", () => {
  it("is « Carte » by default; reads « card » and « form », anything else as the default", () => {
    expect(DEFAULT_COACH_PROPOSALS_DISPLAY).toBe("card");
    expect(readCoachProposalsDisplay("card")).toBe("card");
    expect(readCoachProposalsDisplay("form")).toBe("form");
    expect(readCoachProposalsDisplay(undefined)).toBe("card");
    expect(readCoachProposalsDisplay("drawer")).toBe("card");
  });
});

describe("formOpenedOnArrival — the form « Formulaire » opens by itself when a reply's proposals arrive", () => {
  it("is none under « Carte »: the card alone shows", () => {
    expect(formOpenedOnArrival("card", [card("c1")], DESK)).toBeNull();
  });

  it("is the reply's first proposal's under « Formulaire », once: never a second one of the same reply", () => {
    expect(formOpenedOnArrival("form", [card("c1"), card("c2")], DESK)).toBe("c1");
  });

  it("is none when the first proposal has no form to open (no fields, the Upgrade prompt, already decided)", () => {
    expect(formOpenedOnArrival("form", [card("c1", {}, false), card("c2")], DESK)).toBeNull();
    const quota = card("c1");
    quota.change.quota = { label: "1 recherche", prompt: { reason: "quota" } as never };
    expect(formOpenedOnArrival("form", [quota], DESK)).toBeNull();
    expect(formOpenedOnArrival("form", [card("c1", { status: "accepted" })], DESK)).toBeNull();
    expect(formOpenedOnArrival("form", [], DESK)).toBeNull();
  });

  it("is none on a phone while the Candidate types; on a phone otherwise, or typing on a wide screen, it opens", () => {
    expect(formOpenedOnArrival("form", [card("c1")], { phone: true, typing: true })).toBeNull();
    expect(formOpenedOnArrival("form", [card("c1")], { phone: true, typing: false })).toBe("c1");
    expect(formOpenedOnArrival("form", [card("c1")], { phone: false, typing: true })).toBe("c1");
  });
});

describe.skipIf(!connectionString)("Propositions du coach (setting): stored with the account, in the Data export (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  const NOW = new Date("2026-11-04T17:20:00.000Z");

  async function candidate(id: string) {
    await database.query(`INSERT INTO candidate (id, name, email, "emailVerified", "interfaceLanguage", "createdAt", "updatedAt") VALUES ($1, $1, $2, true, 'fr', $3, $3)`, [
      id,
      `${id}@example.fr`,
      "2026-01-15T10:00:00Z",
    ]);
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateCoachProposalsDisplay(database);
    await migrateCoachProposalsDisplay(database); // safe to run twice
    await candidate("marie");
    await candidate("john");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("is « Carte » for every Candidate until they choose; their choice is theirs alone, and can go back", async () => {
    const displays = createCoachProposalsDisplays(database, { now: () => NOW });
    expect(await displays.of("marie")).toBe("card");

    expect(await displays.choose("marie", "form")).toBe("form");
    expect(await displays.of("marie")).toBe("form");
    expect(await displays.of("john")).toBe("card");

    expect(await displays.choose("marie", "card")).toBe("card");
    expect(await displays.of("marie")).toBe("card");
  });

  it("is in the Data export: the value and since when, « Carte » with no date before any choice", async () => {
    expect(await coachProposalsDisplayOf(database, "marie")).toEqual({ display: "card", chosenAt: null });
    await createCoachProposalsDisplays(database, { now: () => NOW }).choose("marie", "form");
    expect(await coachProposalsDisplayOf(database, "marie")).toEqual({ display: "form", chosenAt: NOW });
  });

  it("goes with the account", async () => {
    await createCoachProposalsDisplays(database).choose("marie", "form");
    await database.query(`DELETE FROM candidate WHERE id = $1`, ["marie"]);
    const { rows } = await database.query(`SELECT 1 FROM coach_proposals_display WHERE candidate_id = $1`, ["marie"]);
    expect(rows).toEqual([]);
  });
});

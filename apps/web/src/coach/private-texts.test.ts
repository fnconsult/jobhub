import { describe, expect, it } from "vitest";
import type { Queryable } from "../database/pool";
import type { Profiles } from "../profiles";
import { privateTextsOf } from "./private-texts";

// « Périmètre du coach » (ADR-0114), check 4: what a reply must never repeat, read for the Guardrails only.

const cv = (fullName: string, email: string, phone: string, location: string) => ({ masterCv: { version: 1, content: { fullName, email, phone, location } } });
const profiles = {
  list: async (candidateId: string) => (candidateId === "marie" ? [{ id: "p1" }, { id: "p2" }, { id: "p-old" }] : []),
  get: async (_candidateId: string, id: string) =>
    ({ p1: cv("Marie Dupont", "marie@example.fr", "06 12 34 56 78", "12 rue des Lilas, 69003 Lyon"), p2: cv("Marie Dupont", "marie@example.fr", "", "Lyon"), "p-old": cv("Marie", "", "", "") })[id] ?? null,
} as unknown as Pick<Profiles, "list" | "get">;

describe("privateTextsOf", () => {
  it("gives each Master CV's identity values once, and the Candidate's Private Coach Notes", async () => {
    const asked: unknown[][] = [];
    const database: Queryable = {
      query: (async (sql: string, values: unknown[]) => {
        asked.push([sql, values]);
        return { rows: [{ text: "Anxieuse avant les entretiens collectifs." }] };
      }) as unknown as Queryable["query"],
    };

    expect(await privateTextsOf(database, profiles)("marie")).toEqual({
      identity: ["Marie Dupont", "marie@example.fr", "06 12 34 56 78", "12 rue des Lilas, 69003 Lyon"],
      notes: ["Anxieuse avant les entretiens collectifs."],
    });
    expect(asked).toEqual([[expect.stringContaining("FROM private_coach_note WHERE candidate_id = $1"), ["marie"]]]);
  });
});

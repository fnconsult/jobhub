import { it, expect } from "vitest";
import { calLegalReady } from "./legal";
import type { LegalTextVersionRecord } from "@jobhub/help";
import type { Queryable } from "../database/pool";
it("requires real current coverage and recipient evidence, a 30-day observation, and ignores fixtures in production/staging", async () => {
  let observed: Date | null = null;
  const database = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.startsWith("INSERT") && !observed) observed = values[1] as Date;
      return { rows: observed ? [{ firstSeen: observed }] : [] };
    },
  } as unknown as Queryable;
  const registry: LegalTextVersionRecord[] = ["confidentialite", "contrat-coach"].map((text) => ({
    text: text as LegalTextVersionRecord["text"],
    version: "2026-01-01",
    sha256: "TEST-ONLY",
    url: "/test-only",
    change: "substantielle",
    coachingCapabilities: ["cal-com"],
  }));
  const globals = { [Symbol.for("jobbbox.e2e.cal-legal")]: { recipients: ["cal-com"], firstSeen: "2026-11-01T00:00Z" } };
  const input = { registry, globals, env: { JOBHUB_TARGET: "e2e" }, now: new Date("2026-11-30T23:59:59Z") };
  expect(await calLegalReady(database, input)).toBe(false);
  expect(await calLegalReady(database, { ...input, now: new Date("2026-12-01T00:00Z") })).toBe(true);
  for (const target of ["production", "staging"])
    expect(await calLegalReady(database, { ...input, env: { JOBHUB_TARGET: target }, now: new Date("2026-12-05") })).toBe(false);
  expect(
    await calLegalReady(database, {
      ...input,
      registry: [...registry, { ...registry[0]!, version: "2026-11-20", sha256: "NEW-TEST-ONLY", coachingCapabilities: [] }],
      now: new Date("2026-12-05"),
    }),
  ).toBe(false);
  expect(await calLegalReady(database, { ...input, registry: [], now: new Date("2026-12-05") })).toBe(false);
});

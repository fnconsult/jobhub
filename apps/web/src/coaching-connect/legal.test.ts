import { describe, it, expect } from "vitest";
import type { LegalTextVersionRecord } from "@jobhub/help";
import { connectLegalReady, connectLegalRegistry } from "./legal";
const record = (text: LegalTextVersionRecord["text"], version = "2026-01-01"): LegalTextVersionRecord => ({
  text,
  version,
  sha256: "test-only-not-legal-proof",
  url: "/test-only",
  change: "substantielle",
  coachingCapabilities: ["stripe-connect", "marketplace"],
});
describe("human-approved Connect coverage", () => {
  it("ignores a fixture in production/staging and refuses a target flag without its explicit harness", () => {
    const globals = { [Symbol.for("jobbbox.e2e.coaching-legal")]: [record("cgv"), record("confidentialite"), record("contrat-coach")] };
    expect(connectLegalRegistry({ JOBHUB_TARGET: "production" }, globals)).toEqual(connectLegalRegistry({ JOBHUB_TARGET: "production" }, {}));
    expect(connectLegalRegistry({ JOBHUB_TARGET: "staging" }, globals)).toEqual(connectLegalRegistry({ JOBHUB_TARGET: "staging" }, {}));
    expect(connectLegalRegistry({ JOBHUB_TARGET: "e2e" }, {})).toEqual(connectLegalRegistry({ JOBHUB_TARGET: "production" }, {}));
    expect(connectLegalRegistry({ JOBHUB_TARGET: "e2e" }, globals)).toHaveLength(3);
  });
  it("does not activate for absent, partial or future legal versions", () => {
    const now = new Date("2026-11-10T12:00Z");
    expect(connectLegalReady([], now)).toBe(false);
    expect(connectLegalReady([record("cgv"), record("confidentialite")], now)).toBe(false);
    expect(connectLegalReady([record("cgv"), record("confidentialite"), record("contrat-coach", "2026-12-01")], now)).toBe(false);
  });
  it("requires explicit coverage on all current binding texts and fails closed again after a newer omission", () => {
    const registry = [record("cgv"), record("confidentialite"), record("contrat-coach")],
      now = new Date("2026-11-10T12:00Z");
    expect(connectLegalReady(registry, now)).toBe(true);
    expect(connectLegalReady([...registry, { ...record("confidentialite", "2026-11-01"), coachingCapabilities: [] }], now)).toBe(false);
    expect(
      connectLegalReady(
        registry.map((v) => ({ ...v, coachingCapabilities: undefined })),
        now,
      ),
    ).toBe(false);
  });
});

import { it, expect } from "vitest";
import type { LegalTextVersionRecord } from "@jobhub/help";
import { taxLegalReady } from "./legal";
it("requires current human DAC7 coverage of every text and closes when a newer version omits it", () => {
  const registry = ["cgv", "contrat-coach", "confidentialite"].map((text) => ({
    text,
    version: "2026-01-01",
    sha256: "test-only",
    url: "/test-only",
    change: "substantielle",
    coachingCapabilities: ["dac7"],
  })) as LegalTextVersionRecord[];
  const now = new Date("2026-11-11T12:00Z");
  expect(taxLegalReady([], now)).toBe(false);
  expect(taxLegalReady(registry, now)).toBe(true);
  expect(taxLegalReady([...registry, { ...registry[2]!, version: "2026-11-01", coachingCapabilities: [] }], now)).toBe(false);
});

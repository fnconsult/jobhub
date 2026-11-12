import { it, expect } from "vitest";
import type { LegalTextVersionRecord } from "@jobhub/help";
import { cancellationLegalReady } from "./legal";
import { connectLegalRegistry } from "../coaching-connect/legal";
const record = (text: LegalTextVersionRecord["text"], version = "2026-01-01"): LegalTextVersionRecord => ({
  text,
  version,
  sha256: "test-only-not-approval",
  url: "/test-only",
  change: "substantielle",
  coachingCapabilities: ["cancellations"],
});
it("requires current human coverage and ignores test injection in production", () => {
  const registry = [record("cgv"), record("contrat-coach"), record("confidentialite")],
    now = new Date("2026-11-11T12:00Z");
  expect(cancellationLegalReady()).toBe(false);
  const fake = { [Symbol.for("jobbbox.e2e.coaching-legal")]: registry };
  expect(connectLegalRegistry({ JOBHUB_TARGET: "production" }, fake)).toEqual(connectLegalRegistry({ JOBHUB_TARGET: "production" }, {}));
  expect(connectLegalRegistry({ JOBHUB_TARGET: "e2e" }, {})).toEqual(connectLegalRegistry({ JOBHUB_TARGET: "production" }, {}));
  expect(cancellationLegalReady(registry, now)).toBe(true);
  expect(cancellationLegalReady([...registry, { ...record("cgv", "2026-11-01"), coachingCapabilities: [] }], now)).toBe(false);
});

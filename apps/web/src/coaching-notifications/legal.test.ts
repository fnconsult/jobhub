import { it, expect } from "vitest";
import type { LegalTextVersionRecord } from "@jobhub/help";
import { coachingNoticesLegalReady, coachingNoticesEnabled } from "./legal";
const record = (text: LegalTextVersionRecord["text"]): LegalTextVersionRecord => ({
  text,
  version: "2026-01-01",
  sha256: "test-only-not-approval",
  url: "/test-only",
  change: "substantielle",
  coachingCapabilities: ["coach-space"],
});
it("requires current human coverage rather than enabling new deliveries by default", () => {
  expect(coachingNoticesLegalReady([])).toBe(false);
  const records = [record("cgv"), record("contrat-coach"), record("confidentialite")];
  expect(coachingNoticesLegalReady(records, new Date("2026-11-11T12:00Z"))).toBe(true);
  expect(
    coachingNoticesLegalReady([...records, { ...record("confidentialite"), version: "2026-11-01", coachingCapabilities: [] }], new Date("2026-11-11T12:00Z")),
  ).toBe(false);
});

it("requires rollout AND operator confirmation that Cal reminders are disabled", () => {
  const records = [record("cgv"), record("contrat-coach"), record("confidentialite")],
    now = new Date("2026-11-11T12:00Z");
  expect(coachingNoticesEnabled(false, true, records, now)).toBe(false);
  expect(coachingNoticesEnabled(true, false, records, now)).toBe(false);
  expect(coachingNoticesEnabled(true, true, [], now)).toBe(false);
  expect(coachingNoticesEnabled(true, true, records, now)).toBe(true);
});

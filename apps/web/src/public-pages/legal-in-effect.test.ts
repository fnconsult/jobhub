import type { LegalTextVersionRecord } from "@jobhub/help";
import { describe, expect, it } from "vitest";
import { legalTextInEffect } from "./legal-in-effect";

const record = (text: LegalTextVersionRecord["text"], version: string): LegalTextVersionRecord => ({
  text,
  version,
  url: `/legal/${text}/${version}`,
  sha256: "a".repeat(64),
  change: "substantielle",
});

describe("legalTextInEffect (#550)", () => {
  const registry = [record("cgu", "2026-01-01"), record("cgu", "2026-06-01"), record("cgu", "2027-01-01"), record("confidentialite", "2025-01-01")];

  it("names the CGU version in effect that day, never one still to come, with its permanent URL only", () => {
    expect(legalTextInEffect("cgu", "2026-11-02", registry)).toEqual({ version: "2026-06-01", url: "/legal/cgu/2026-06-01" });
    expect(legalTextInEffect("cgu", "2026-06-01", registry)).toEqual({ version: "2026-06-01", url: "/legal/cgu/2026-06-01" });
  });

  it("says no version is in effect before the first one, or while the registry holds none", () => {
    expect(legalTextInEffect("cgu", "2025-12-31", registry)).toEqual({ version: null });
    expect(legalTextInEffect("cgu", "2026-11-02", [])).toEqual({ version: null });
    expect(legalTextInEffect("cgv", "2026-11-02", registry)).toEqual({ version: null });
  });

  it("knows no text that does not exist", () => {
    expect(legalTextInEffect("contrat-coach", "2026-11-02", [record("contrat-coach", "2026-01-01")])).toBeNull();
    expect(legalTextInEffect("conditions", "2026-11-02", registry)).toBeNull();
  });
});

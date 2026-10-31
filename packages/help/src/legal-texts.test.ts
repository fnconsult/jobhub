import { describe, expect, it } from "vitest";
import { legalText, legalTextHistory, privacyPolicyCoverage, legalTextVersionInEffect, legalTextVersionRecord, parisDay, type LegalTextVersion, type LegalTextVersionRecord } from "./index";

const cgu = (effective: string, change: LegalTextVersion["change"], summary: string): LegalTextVersion => ({
  text: "cgu",
  locale: "fr",
  effective,
  title: "Conditions générales d'utilisation",
  change,
  approvedBy: "Camille Martin",
  summary,
  inBrief: [],
  sections: [{ id: "invite", number: 1, title: "L'extension sans compte", body: "Rien n'est gardé." }],
});

// Two test versions of the CGU, and one not in effect yet.
const written = [cgu("2026-06-01", "substantielle", "Première version."), cgu("2026-10-12", "mineure", "Une coquille corrigée."), cgu("2027-01-01", "substantielle", "Nouveaux Plans.")];
const today = "2026-10-30";

describe("legalText — one Legal Text as /legal shows it", () => {
  it("is the version in effect today, with the earlier one in its history", () => {
    const shown = legalText("cgu", "fr", { on: today }, written);
    expect(shown?.version.effective).toBe("2026-10-12");
    expect(shown?.inEffect).toBe(true);
    expect(shown?.history.map((entry) => entry.effective)).toEqual(["2026-10-12", "2026-06-01"]);
  });

  it("is a dated version when asked, said not to be the one in effect", () => {
    const shown = legalText("cgu", "fr", { on: today, version: "2026-06-01" }, written);
    expect(shown?.version.summary).toBe("Première version.");
    expect(shown?.inEffect).toBe(false);
    expect(legalText("cgu", "fr", { on: today, version: "2026-10-12" }, written)?.inEffect).toBe(true);
  });

  it("never serves a version before its effective date, and serves it from that day on", () => {
    expect(legalText("cgu", "fr", { on: today, version: "2027-01-01" }, written)).toBeNull();
    expect(legalText("cgu", "fr", { on: today }, written)?.history.map((entry) => entry.effective)).not.toContain("2027-01-01");
    expect(legalText("cgu", "fr", { on: "2027-01-01" }, written)?.version.effective).toBe("2027-01-01");
  });

  it("is null for a text the team has not written yet, for a date that is no version, and before the first version", () => {
    expect(legalText("mentions-legales", "fr", { on: today }, written)).toBeNull();
    expect(legalText("cgu", "fr", { on: today, version: "2026-07-01" }, written)).toBeNull();
    expect(legalText("cgu", "fr", { on: "2026-05-31" }, written)).toBeNull();
    expect(legalText("cgu", "fr", { on: today })).toBeNull();
  });
});

describe("legalTextHistory — the version history of /legal/<text>/versions", () => {
  it("lists each version in effect so far, newest first: its date, change, history line and permanent URL", () => {
    expect(legalTextHistory("cgu", "fr", today, written)).toEqual([
      { effective: "2026-10-12", change: "mineure", summary: "Une coquille corrigée.", url: "/legal/cgu/2026-10-12" },
      { effective: "2026-06-01", change: "substantielle", summary: "Première version.", url: "/legal/cgu/2026-06-01" },
    ]);
    expect(legalTextHistory("cgv", "fr", today, written)).toEqual([]);
  });
});

describe("the version registry (#510)", () => {
  const registry: LegalTextVersionRecord[] = [
    { text: "cgu", version: "2027-01-01", url: "/legal/cgu/2027-01-01", sha256: "c".repeat(64), change: "substantielle" },
    { text: "cgu", version: "2026-10-12", url: "/legal/cgu/2026-10-12", sha256: "b".repeat(64), change: "mineure" },
    { text: "cgu", version: "2026-06-01", url: "/legal/cgu/2026-06-01", sha256: "a".repeat(64), change: "substantielle" },
  ];

  it("finds one version by its id, the same in French and English", () => {
    expect(legalTextVersionRecord("cgu", "2026-06-01", registry)?.sha256).toBe("a".repeat(64));
    expect(legalTextVersionRecord("cgu", "2026-07-01", registry)).toBeNull();
  });

  it("tells the version in effect on a day, never one still to come", () => {
    expect(legalTextVersionInEffect("cgu", today, registry)?.version).toBe("2026-10-12");
    expect(legalTextVersionInEffect("cgu", "2027-01-01", registry)?.version).toBe("2027-01-01");
    expect(legalTextVersionInEffect("cgu", "2026-01-01", registry)).toBeNull();
    expect(legalTextVersionInEffect("cgv", today, registry)).toBeNull();
  });
});

describe("privacyPolicyCoverage — the recipients outside the EU the privacy policy in effect names (#548)", () => {
  const policy = (effective: string, recipientsOutsideEu: string[]): LegalTextVersion => ({
    ...cgu(effective, "substantielle", "Politique."),
    text: "confidentialite",
    title: "Politique de confidentialité",
    recipientsOutsideEu,
  });
  const policies = [policy("2026-06-01", ["anthropic"]), policy("2026-10-12", ["anthropic", "stripe"]), policy("2027-01-01", ["anthropic", "stripe", "lusha"])];

  it("is the version in effect that day and the Tools it names, never those of a version still to come", () => {
    expect(privacyPolicyCoverage(today, [...written, ...policies])).toEqual({ version: "2026-10-12", recipientsOutsideEu: ["anthropic", "stripe"] });
    expect(privacyPolicyCoverage("2026-07-01", policies)).toEqual({ version: "2026-06-01", recipientsOutsideEu: ["anthropic"] });
  });

  it("names no version and no Tool before the first privacy policy is in effect", () => {
    expect(privacyPolicyCoverage("2026-05-31", policies)).toEqual({ version: null, recipientsOutsideEu: [] });
    expect(privacyPolicyCoverage(today, written)).toEqual({ version: null, recipientsOutsideEu: [] });
  });
});

describe("parisDay — the day in France, which the effective dates are", () => {
  it("is the calendar day in Europe/Paris, not in UTC", () => {
    expect(parisDay(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12-01");
    expect(parisDay(new Date("2026-07-31T21:59:00Z"))).toBe("2026-07-31");
    expect(parisDay(new Date("2026-07-31T22:00:00Z"))).toBe("2026-08-01");
  });
});

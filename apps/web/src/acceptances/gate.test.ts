import { describe, expect, it } from "vitest";
import { acceptanceHref, acceptanceReturn, openWhilePending } from "./gate";

describe("what a Candidate reaches before accepting the CGU (ADR-0062)", () => {
  it.each(["/acceptation", "/compte/donnees", "/abonnement", "/abonnement?code=BIENVENUE", "/compte/supprime", "/legal/cgu", "/legal/cgu/2026-12-01", "/connexion", "/en/legal/cgu", "/en/connexion"])("reaches %s", (path) => {
    expect(openWhilePending(path)).toBe(true);
  });

  it.each(["/", "/candidatures", "/profils/abc", "/compte", "/compte/profils", "/compte/donnees-perso", "/acceptations", "/abonnements", "/legalese", "/en", "/en/candidatures"])("does not reach %s", (path) => {
    expect(openWhilePending(path)).toBe(false);
  });

  it("is sent to the Acceptance screen, to come back to the page they asked for", () => {
    expect(acceptanceHref("/candidatures?vue=tableau")).toBe("/acceptation?suite=%2Fcandidatures%3Fvue%3Dtableau");
    expect(acceptanceHref("/")).toBe("/acceptation");
    expect(acceptanceHref(null)).toBe("/acceptation");
  });

  it("comes back only to a page of this site, never the Acceptance screen itself", () => {
    expect(acceptanceReturn("/candidatures")).toBe("/candidatures");
    expect(acceptanceReturn("//evil.example")).toBe("/");
    expect(acceptanceReturn("https://evil.example")).toBe("/");
    expect(acceptanceReturn("/acceptation")).toBe("/");
    expect(acceptanceReturn(undefined)).toBe("/");
  });
});

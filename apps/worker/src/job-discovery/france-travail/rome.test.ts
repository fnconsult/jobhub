import { describe, expect, it } from "vitest";
import { romeCodesFor, romeTableGaps } from "./rome";

describe("ROME codes for a Search Criteria title", () => {
  it("maps a French job title to its ROME code", () => {
    expect(romeCodesFor("Directeur administratif et financier")).toEqual(["M1205"]);
  });

  it("reads the feminine form, accents, case and the (H/F) mention alike", () => {
    expect(romeCodesFor("DIRECTRICE FINANCIÈRE (H/F)")).toEqual(["M1205"]);
    expect(romeCodesFor("Directrice administrative et financière")).toEqual(["M1205"]);
    expect(romeCodesFor("Cheffe comptable F/H")).toEqual(["M1206"]);
  });

  it("maps an English title and an acronym", () => {
    expect(romeCodesFor("Chief Financial Officer")).toEqual(["M1205"]);
    expect(romeCodesFor("CFO")).toEqual(["M1205"]);
    expect(romeCodesFor("DRH")).toEqual(["M1503"]);
  });

  it("gives every code a title covering several jobs names, each once", () => {
    expect(romeCodesFor("Directeur commercial et marketing")).toEqual(["D1406", "M1705"]);
  });

  it("matches whole words only", () => {
    // "cfo" inside another word is not the acronym.
    expect(romeCodesFor("Responsable Cfore")).toEqual([]);
  });

  it("gives nothing for a title it does not know, so the search falls back to keywords", () => {
    expect(romeCodesFor("Chef de projet tisserand")).toEqual([]);
    expect(romeCodesFor("")).toEqual([]);
  });
});

describe("the ROME table, checked against ROME 4.0's open data (#406)", () => {
  // The codes the table uses, as ROME 4.0 v62 (2026-10-19) lists them.
  const v62 = new Map(
    ["M1205", "M1204", "M1206", "M1201", "M1202", "M1503", "M1301", "M1402", "D1406", "M1707", "M1705", "M1703", "M1704", "E1103", "M1803", "M1805", "M1806", "M1101", "N1301", "N1302", "H2502", "H1502", "H1206", "H1102", "K1903"].map(
      (code) => [code, code],
    ),
  );

  it("has no code ROME 4.0 does not list", () => {
    expect(romeTableGaps(v62)).toEqual([]);
  });

  it("names each code ROME does not list", () => {
    const withoutDaf = new Map(v62);
    withoutDaf.delete("M1205");

    expect(romeTableGaps(withoutDaf)).toEqual([{ code: "M1205", label: "Direction administrative et financière" }]);
  });
});

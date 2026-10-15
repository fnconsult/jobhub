import { describe, expect, it } from "vitest";
import { romeCodesFor } from "./rome";

describe("ROME codes for a Search Criteria title", () => {
  it("maps a French job title to its ROME code", () => {
    expect(romeCodesFor("Directeur administratif et financier")).toEqual(["M1205"]);
  });

  it("reads the feminine form, accents, case and the (H/F) mention alike", () => {
    expect(romeCodesFor("DIRECTRICE FINANCIÈRE (H/F)")).toEqual(["M1205"]);
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

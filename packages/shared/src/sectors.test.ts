import { describe, expect, it } from "vitest";
import { industryChoices, industryLabels, isSector, isSubsector, searchedSubsectors, sectorOf, SECTORS, subsectorsOf, type IndustryReference } from "./sectors";

describe("Sectors and Subsectors (NAF rév. 2)", () => {
  it("are the 21 sections, A to U, and their 88 divisions", () => {
    expect(SECTORS).toHaveLength(21);
    expect(SECTORS[0]).toBe("A");
    expect(SECTORS[20]).toBe("U");
    expect(SECTORS.flatMap(subsectorsOf)).toHaveLength(88);
    expect(subsectorsOf("A")).toEqual(["01", "02", "03"]);
    expect(subsectorsOf("K")).toEqual(["64", "65", "66"]);
  });

  it("know which Sector a Subsector belongs to", () => {
    expect(sectorOf("29")).toBe("C");
    expect(sectorOf("64")).toBe("K");
    expect(sectorOf("99")).toBe("U");
    // No division 04 nor 34 in NAF rév. 2.
    expect(sectorOf("04")).toBeUndefined();
    expect(isSubsector("34")).toBe(false);
    expect(isSector("C")).toBe(true);
    expect(isSector("V")).toBe(false);
    expect(isSector("toString")).toBe(false);
  });
});

describe("the Sectors, Subsectors and Domains a Profile keeps", () => {
  it("are each kept once, in the nomenclature's order", () => {
    expect(industryChoices({ sectors: ["K", "C", "K"], subsectors: ["64", "29", "64"], domains: ["M13", "C12", "M13"] })).toEqual({
      sectors: ["C", "K"],
      subsectors: ["29", "64"],
      domains: ["C12", "M13"],
    });
  });

  it("include the Sector of each Subsector chosen", () => {
    expect(industryChoices({ sectors: [], subsectors: ["29"], domains: [] })).toEqual({ sectors: ["C"], subsectors: ["29"], domains: [] });
  });

  it("are none when none is chosen", () => {
    expect(industryChoices({ sectors: [], subsectors: [], domains: [] })).toEqual({ sectors: [], subsectors: [], domains: [] });
  });
});

describe("the Subsectors a search filters by", () => {
  it("are the Subsectors chosen, and every Subsector of a Sector chosen without one", () => {
    expect(searchedSubsectors({ sectors: ["C", "K"], subsectors: ["29"] })).toEqual(["29", "64", "65", "66"]);
  });

  it("are none without a Sector", () => {
    expect(searchedSubsectors({ sectors: [], subsectors: [] })).toEqual([]);
  });
});

const reference: IndustryReference = {
  sectors: [
    { code: "C", label: { fr: "Industrie manufacturière", en: "Manufacturing" } },
    { code: "K", label: { fr: "Activités financières et d'assurance", en: "Financial and insurance activities" } },
  ],
  subsectors: [{ code: "29", parent: "C", label: { fr: "Industrie automobile", en: "Manufacture of motor vehicles, trailers and semi-trailers" } }],
  domains: [{ code: "M13", parent: "M", label: { fr: "Direction d'entreprise" } }],
};

describe("Sectors and Domains in words", () => {
  it("name each choice by its most precise label: a Subsector chosen, or a Sector chosen without one", () => {
    expect(industryLabels({ sectors: ["C", "K"], subsectors: ["29"], domains: ["M13"] }, reference, "fr")).toEqual({
      sectors: ["Industrie automobile", "Activités financières et d'assurance"],
      domains: ["Direction d'entreprise"],
    });
  });

  it("are in English where the nomenclature has it, in French otherwise", () => {
    expect(industryLabels({ sectors: ["K"], subsectors: [], domains: ["M13"] }, reference, "en")).toEqual({
      sectors: ["Financial and insurance activities"],
      domains: ["Direction d'entreprise"],
    });
  });

  it("leave out a code the reference data does not name", () => {
    expect(industryLabels({ sectors: ["A"], subsectors: [], domains: ["Z99"] }, reference, "fr")).toEqual({ sectors: [], domains: [] });
  });
});

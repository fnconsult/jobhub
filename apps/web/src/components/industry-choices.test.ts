import type { IndustryReference } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { industryOptions, matchingOptions, withSectors } from "./industry-choices";

const reference: IndustryReference = {
  sectors: [
    { code: "C", label: { fr: "Industrie manufacturière", en: "Manufacturing" } },
    { code: "K", label: { fr: "Activités financières et d'assurance", en: "Financial and insurance activities" } },
  ],
  subsectors: [
    { code: "29", parent: "C", label: { fr: "Industrie automobile", en: "Manufacture of motor vehicles, trailers and semi-trailers" } },
    { code: "30", parent: "C", label: { fr: "Fabrication d'autres matériels de transport", en: "Manufacture of other transport equipment" } },
    { code: "64", parent: "K", label: { fr: "Activités des services financiers, hors assurance et caisses de retraite" } },
  ],
  domains: [
    { code: "C13", parent: "C", label: { fr: "Finance" } },
    { code: "M13", parent: "M", label: { fr: "Direction d'entreprise" } },
  ],
};

describe("the options a Sectors, Subsectors or Domains input offers", () => {
  it("are every Sector, by its label in the page's language", () => {
    expect(industryOptions(reference, "sectors", [], "en")).toEqual([
      { code: "C", label: "Manufacturing" },
      { code: "K", label: "Financial and insurance activities" },
    ]);
  });

  it("are, for Subsectors, only those of the Sectors chosen, each said with its Sector", () => {
    expect(industryOptions(reference, "subsectors", ["K"], "fr")).toEqual([
      { code: "64", label: "Activités des services financiers, hors assurance et caisses de retraite", group: "Activités financières et d'assurance" },
    ]);
    expect(industryOptions(reference, "subsectors", [], "fr")).toEqual([]);
  });

  it("are every Domain, by its French label, the only one ROME gives", () => {
    expect(industryOptions(reference, "domains", [], "en").map((option) => option.label)).toEqual(["Finance", "Direction d'entreprise"]);
  });
});

describe("the options matching what the Candidate types", () => {
  const options = industryOptions(reference, "subsectors", ["C", "K"], "fr");

  it("are those not chosen yet whose label holds every word typed, without case or accents", () => {
    expect(matchingOptions(options, [], "fabrication materiels").map((option) => option.code)).toEqual(["30"]);
    expect(matchingOptions(options, ["29"], "").map((option) => option.code)).toEqual(["30", "64"]);
    expect(matchingOptions(options, [], "AUTOMOBILE").map((option) => option.code)).toEqual(["29"]);
  });

  it("are found by code too", () => {
    expect(matchingOptions(options, [], "64").map((option) => option.code)).toEqual(["64"]);
  });
});

describe("choosing Sectors", () => {
  it("keeps the Subsectors of the Sectors still chosen, and drops the others", () => {
    expect(withSectors({ sectors: ["C", "K"], subsectors: ["29", "64"] }, ["K"])).toEqual({ sectors: ["K"], subsectors: ["64"] });
    expect(withSectors({ sectors: ["C"], subsectors: ["29"] }, ["C", "K"])).toEqual({ sectors: ["C", "K"], subsectors: ["29"] });
  });
});

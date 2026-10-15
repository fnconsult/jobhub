import { describe, expect, it } from "vitest";
import { countryIn, englishName } from "./countries";

describe("the country a location names", () => {
  it.each([
    ["Paris, France", "FR"],
    ["Île-de-France", "FR"],
    ["Londres, Royaume-Uni", "GB"],
    ["London, UK", "GB"],
    ["Genève, Suisse", "CH"],
    ["Amsterdam, Pays-Bas", "NL"],
    ["MÜNCHEN, DEUTSCHLAND", "DE"],
    ["Abidjan, Côte d'Ivoire", "CI"],
    ["New York, NY, United States", "US"],
  ])("reads %s as %s, whatever the language, accents or case", (location, country) => {
    expect(countryIn(location)).toBe(country);
  });

  it.each(["Lyon", "Issy-les-Moulineaux", "Remote", "Télétravail", "Saint-Denis de la Réunion", ""])("reads no country from %j: a city alone gives none", (location) => {
    expect(countryIn(location)).toBeUndefined();
  });

  it("takes the last country named, and the longest name ending there", () => {
    expect(countryIn("Bruxelles (Belgique) ou Lille, France")).toBe("FR");
    expect(countryIn("Belfast, Northern Ireland")).toBe("GB");
    expect(countryIn("Dublin, Ireland")).toBe("IE");
    expect(countryIn("Santa Fe, New Mexico")).toBe("US");
  });

  it("names each country in English, lowercase, as Apollo takes it", () => {
    expect(englishName("FR")).toBe("france");
    expect(englishName("GB")).toBe("united kingdom");
    expect(englishName("US")).toBe("united states");
  });
});

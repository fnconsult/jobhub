import { describe, expect, it } from "vitest";
import { countryIn } from "./country";

describe("the country a Job Offer's location names", () => {
  it.each([
    ["Paris, France", "FR"],
    ["Issy-les-Moulineaux, Île-de-France, France", "FR"],
    ["Issy-les-Moulineaux (92)", "FR"],
    ["Saint-Denis (974)", "FR"],
    ["London, United Kingdom", "GB"],
    ["London, UK", "GB"],
    ["Londres, Royaume-Uni", "GB"],
    ["Berlin, Deutschland", "DE"],
    ["Genève - Suisse", "CH"],
    ["Bruxelles, Belgique (Hybride)", "BE"],
    ["New York, NY, USA", "US"],
    ["São Paulo, Brasil", "BR"],
  ])("%s is in %s", (location, country) => {
    expect(countryIn(location)).toBe(country);
  });

  it.each([["Issy-les-Moulineaux"], ["Paris 17e"], ["Télétravail"], ["Remote"], ["Atlanta, Georgia"], [""]])("%s names no country", (location) => {
    expect(countryIn(location)).toBeUndefined();
  });
});

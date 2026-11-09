import { describe, expect, it } from "vitest";
import { cleanName, fullNameOf, IDENTITY_NAME_MAX_LENGTH, namesFromFullName } from "./names";

describe("a Candidate's Given Name and Family Name, worked out of a full name (#918)", () => {
  it("takes the family name a French CV writes in capitals, and writes it as a name", () => {
    expect(namesFromFullName("DUPONT Marie")).toEqual({ givenName: "Marie", familyName: "Dupont" });
    expect(namesFromFullName("Marie DUPONT")).toEqual({ givenName: "Marie", familyName: "Dupont" });
  });

  it("takes the first word as the Given Name when no word is in capitals", () => {
    expect(namesFromFullName("Marie Dupont")).toEqual({ givenName: "Marie", familyName: "Dupont" });
    expect(namesFromFullName("  Jean   de la   Fontaine ")).toEqual({ givenName: "Jean", familyName: "de la Fontaine" });
  });

  it("keeps given names of several words apart from the family name in capitals", () => {
    expect(namesFromFullName("DUPONT-MOREL Marie Claire")).toEqual({ givenName: "Marie Claire", familyName: "Dupont-Morel" });
    expect(namesFromFullName("Jean-Pierre LE GALL")).toEqual({ givenName: "Jean-Pierre", familyName: "Le Gall" });
  });

  it("writes a full name all in capitals as names, its first word the Given Name", () => {
    expect(namesFromFullName("MARIE DUPONT")).toEqual({ givenName: "Marie", familyName: "Dupont" });
    expect(namesFromFullName("ÉLODIE D'ARCY")).toEqual({ givenName: "Élodie", familyName: "D'Arcy" });
  });

  it("is a Given Name alone for one word, and nothing for no word", () => {
    expect(namesFromFullName("Marie")).toEqual({ givenName: "Marie", familyName: "" });
    expect(namesFromFullName("   ")).toEqual({ givenName: "", familyName: "" });
  });
});

describe("the account's name, « Prénom Nom » (#918)", () => {
  it("is the Given Name then the Family Name, or the one there is, or empty", () => {
    expect(fullNameOf({ givenName: "Marie", familyName: "Dupont" })).toBe("Marie Dupont");
    expect(fullNameOf({ givenName: "Marie", familyName: null })).toBe("Marie");
    expect(fullNameOf({ givenName: "", familyName: "Dupont" })).toBe("Dupont");
    expect(fullNameOf({ givenName: null, familyName: null })).toBe("");
  });
});

describe("a name the Candidate enters", () => {
  it("is trimmed, its runs of spaces made one", () => {
    expect(cleanName("  Marie   Claire \n")).toBe("Marie Claire");
    expect(cleanName("   ")).toBe("");
  });

  it("is at most 80 characters", () => {
    expect(IDENTITY_NAME_MAX_LENGTH).toBe(80);
  });
});

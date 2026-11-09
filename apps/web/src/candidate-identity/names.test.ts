import { describe, expect, it } from "vitest";
import { calledName, cleanName, fullNameOf, IDENTITY_NAME_MAX_LENGTH, initialsOf, namesFromFullName } from "./names";

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

describe("the name the Sidebar calls the Candidate by (#923)", () => {
  it("is the Preferred Name, else the Given Name, else none", () => {
    expect(calledName({ givenName: "Marie", preferredName: "Mimi" })).toBe("Mimi");
    expect(calledName({ givenName: "Marie", preferredName: null })).toBe("Marie");
    expect(calledName({ givenName: null, preferredName: null })).toBeNull();
  });

  it("takes a name of white space alone for none", () => {
    expect(calledName({ givenName: " Marie ", preferredName: "  " })).toBe("Marie");
    expect(calledName({ givenName: " ", preferredName: "" })).toBeNull();
  });
});

describe("the Candidate's initials, the Sidebar's stand-in for a photo (#923)", () => {
  it("are the Given Name's and the Family Name's first letters", () => {
    expect(initialsOf({ givenName: "Marie", familyName: "Dupont" })).toBe("MD");
    expect(initialsOf({ givenName: "élodie", familyName: "ébert" })).toBe("ÉÉ");
  });

  it("skip the particles a family name starts with", () => {
    expect(initialsOf({ givenName: "Marie-Christine", familyName: "de La Rochefoucauld-Montbazon" })).toBe("MR");
    expect(initialsOf({ givenName: "Jean", familyName: "de la Fontaine" })).toBe("JF");
    expect(initialsOf({ givenName: "Anne", familyName: "d'Arcy" })).toBe("AA");
    expect(initialsOf({ givenName: "Jean-Pierre", familyName: "Le Gall" })).toBe("JL");
  });

  it("are the one name's letter when there is one, none without a name", () => {
    expect(initialsOf({ givenName: "Marie", familyName: null })).toBe("M");
    expect(initialsOf({ givenName: null, familyName: "Dupont" })).toBe("D");
    expect(initialsOf({ givenName: null, familyName: null })).toBeNull();
    expect(initialsOf({ givenName: " ", familyName: "" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { identityIn, personNamesIn } from "./index";

describe("the phone numbers and email addresses a text shows (#228: the Guardrails' fixed leak rule)", () => {
  it("gives each one as written, national and international phone numbers included", () => {
    expect(identityIn("Appelez Paul au 06 12 34 56 78 ou au +33 (0)7 11 22 33 44, ou écrivez à paul.martin@acme.fr.")).toEqual({
      phones: ["06 12 34 56 78", "+33 (0)7 11 22 33 44"],
      emails: ["paul.martin@acme.fr"],
    });
  });

  it("does not take dates, salary ranges, SIRET numbers or rounded quantities for phone numbers", () => {
    expect(identityIn("Du 01/09/2026, salaire 55 000 – 65 000 €, SIRET 552 100 554 00013, +30 000 000 visiteurs.")).toEqual({ phones: [], emails: [] });
  });
});

describe("the people a text names (#446: Email intake's output rules)", () => {
  it("gives a common first name followed by a capitalised word, and a capitalised word after an honorific", () => {
    expect(personNamesIn("Pour toute question, contactez Claire Martin au standard. Signé : Mme Durand-Leroy, RH.")).toEqual(["Claire Martin", "Mme Durand-Leroy"]);
  });

  it("gives no name for a job title, a company or a place", () => {
    expect(personNamesIn("Responsable Contrôle de Gestion chez Exemple Industrie, à Saint-Étienne (CDI).")).toEqual([]);
  });
});

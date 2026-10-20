import { describe, expect, it } from "vitest";
import { identityIn } from "./index";

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

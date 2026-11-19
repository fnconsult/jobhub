import { describe, expect, it } from "vitest";
import { jobOfferLanguage, periodIn, textLanguage } from "./index";

describe("the Document Language a Job Offer defaults to", () => {
  it("is French for a posting written in French", () => {
    expect(
      jobOfferLanguage({
        title: "Directeur administratif et financier H/F",
        content: "Rattaché au directeur général, vous pilotez la consolidation et le contrôle de gestion du groupe. Vous avez 15 ans d'expérience dans la finance.",
      }),
    ).toBe("fr");
  });

  it("is English for a posting written in English", () => {
    expect(
      jobOfferLanguage({
        title: "Chief Financial Officer",
        content: "Reporting to the CEO, you will lead the finance team and own the group consolidation. You have 15 years of experience in finance and you are fluent in French.",
      }),
    ).toBe("en");
  });

  it("is French, the French market's language, when the posting says too little to tell", () => {
    expect(jobOfferLanguage({ title: "CFO", content: "SAP, IFRS" })).toBe("fr");
  });

  it("reads no word inside a reference, a model or a code: « A350 », « 4a7in2 » or « S4/HANA » say nothing", () => {
    expect(jobOfferLanguage({ title: "Ingénieur A350 (H/F)", content: "Vous rejoignez la ligne A350. Réf. 4a7in2-on9a S4/HANA 3a" })).toBe("fr");
  });
});

describe("the language a text of a document is written in", () => {
  it("is told from its common words and the words of a CV (months, « aujourd'hui », levels), else unknown", () => {
    expect(textLanguage("Consolidation IFRS de 12 filiales et pilotage de la trésorerie.")).toBe("fr");
    expect(textLanguage("IFRS consolidation of 12 subsidiaries and cash management.")).toBe("en");
    expect(textLanguage("janv. 2005 – aujourd'hui")).toBe("fr");
    expect(textLanguage("Jan 2005 – present")).toBe("en");
    expect(textLanguage("langue maternelle")).toBe("fr");
    expect(textLanguage("fluent")).toBe("en");
    // Too little to tell: a proper noun, a figure, a word both languages share.
    expect(textLanguage("IFRS")).toBeNull();
    expect(textLanguage("2005 – 2024")).toBeNull();
    expect(textLanguage("Reporting")).toBeNull();
  });

  it("reads no word inside a reference, a model or a code: « a » in « 4a7k2m » or « A350 » is no English (#1078)", () => {
    expect(textLanguage("Directrice financière CV-SECRET-1763560000000-4a7k2m (adapté, fr)")).toBeNull();
    expect(textLanguage("Programme A350 et 3a")).toBe("fr");
    expect(textLanguage("Lead of the A350 programme")).toBe("en");
    expect(textLanguage("Migration S4/HANA, B2B2X, 1er")).toBeNull();
  });
});

describe("a job's period in another Document Language", () => {
  it("has its month names and words translated, its figures kept as they are", () => {
    expect(periodIn("janv. 2005 – aujourd'hui", "en")).toBe("Jan. 2005 – present");
    expect(periodIn("Septembre 1995 - Décembre 2004", "en")).toBe("September 1995 - December 2004");
    expect(periodIn("depuis mars 2019", "en")).toBe("since March 2019");
    expect(periodIn("Jan 2005 – present", "fr")).toBe("janv. 2005 – aujourd'hui");
    expect(periodIn("2005 – 2024", "en")).toBe("2005 – 2024");
  });
});

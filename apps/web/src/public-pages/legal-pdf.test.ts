import type { LegalTextVersion } from "@jobhub/help";
import { describe, expect, it } from "vitest";
import { legalPdfBlocks, legalTextPdf } from "./legal-pdf";

const privacy: LegalTextVersion = {
  text: "confidentialite",
  locale: "fr",
  effective: "2026-10-12",
  title: "Politique de confidentialité",
  change: "substantielle",
  approvedBy: "Camille Martin",
  summary: "Première version.",
  inBrief: ["Vos données restent dans l'Union européenne."],
  sections: [
    { id: "section-1", number: 1, title: "Qui est responsable", body: "Jobbbox est édité par **FN Consult**.\n\nÉcrivez-nous." },
    { id: "section-2", number: 2, title: "Ce que nous collectons", body: "- Votre adresse e-mail.\n- Vos CV." },
  ],
};

describe("legalPdfBlocks — a Legal Text Version's lines in its PDF (« Télécharger en PDF »)", () => {
  it("says its title and effective date, « En bref », each numbered section without Markdown marks, then who approved it", () => {
    expect(legalPdfBlocks(privacy)).toEqual([
      { kind: "name", text: "Politique de confidentialité" },
      { kind: "contact", text: "En vigueur depuis le 12 octobre 2026" },
      { kind: "heading", text: "En bref" },
      { kind: "text", text: "• Vos données restent dans l'Union européenne." },
      { kind: "heading", text: "1. Qui est responsable" },
      { kind: "text", text: "Jobbbox est édité par FN Consult." },
      { kind: "gap" },
      { kind: "text", text: "Écrivez-nous." },
      { kind: "heading", text: "2. Ce que nous collectons" },
      { kind: "text", text: "• Votre adresse e-mail." },
      { kind: "text", text: "• Vos CV." },
      { kind: "gap" },
      { kind: "text", text: "Approuvé par Camille Martin, directeur de la publication, le 12 octobre 2026" },
    ]);
  });

  it("speaks the document's language", () => {
    expect(legalPdfBlocks({ ...privacy, locale: "en", inBrief: ["Your data stays in the EU."] }).slice(1, 3)).toEqual([
      { kind: "contact", text: "In effect since October 12, 2026" },
      { kind: "heading", text: "In short" },
    ]);
  });
});

describe("legalTextPdf — the file", () => {
  it("is a PDF named after the text and its version, its effective date", async () => {
    const file = await legalTextPdf(privacy);
    expect(file.fileName).toBe("Politique de confidentialité 2026-10-12.pdf");
    expect(new TextDecoder().decode(file.bytes.slice(0, 5))).toBe("%PDF-");
  });
});

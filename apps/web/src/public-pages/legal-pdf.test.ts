import type { LegalDocument } from "@jobhub/help";
import { describe, expect, it } from "vitest";
import { legalDocumentPdf, legalPdfBlocks } from "./legal-pdf";

const privacy: LegalDocument = {
  id: "confidentialite",
  locale: "fr",
  version: "3.2",
  effective: "2026-10-12",
  title: "Politique de confidentialité",
  summary: ["Vos données restent dans l'Union européenne."],
  sections: [
    { id: "section-1", number: 1, title: "Qui est responsable", body: "Jobbbox est édité par **FN Consult**.\n\nÉcrivez-nous." },
    { id: "section-2", number: 2, title: "Ce que nous collectons", body: "- Votre adresse e-mail.\n- Vos CV." },
  ],
};

describe("legalPdfBlocks — a Legal Document's lines in its PDF (« Télécharger en PDF », #470)", () => {
  it("says its title, effective date and version, « En bref », then each numbered section, without Markdown marks", () => {
    expect(legalPdfBlocks(privacy)).toEqual([
      { kind: "name", text: "Politique de confidentialité" },
      { kind: "contact", text: "En vigueur depuis le 12 octobre 2026 · Version 3.2" },
      { kind: "heading", text: "En bref" },
      { kind: "text", text: "• Vos données restent dans l'Union européenne." },
      { kind: "heading", text: "1. Qui est responsable" },
      { kind: "text", text: "Jobbbox est édité par FN Consult." },
      { kind: "gap" },
      { kind: "text", text: "Écrivez-nous." },
      { kind: "heading", text: "2. Ce que nous collectons" },
      { kind: "text", text: "• Votre adresse e-mail." },
      { kind: "text", text: "• Vos CV." },
    ]);
  });

  it("speaks the document's language", () => {
    expect(legalPdfBlocks({ ...privacy, locale: "en", summary: ["Your data stays in the EU."] }).slice(1, 3)).toEqual([
      { kind: "contact", text: "In effect since October 12, 2026 · Version 3.2" },
      { kind: "heading", text: "In short" },
    ]);
  });
});

describe("legalDocumentPdf — the file", () => {
  it("is a PDF named after the document and its version", async () => {
    const file = await legalDocumentPdf(privacy);
    expect(file.fileName).toBe("Politique de confidentialité 3.2.pdf");
    expect(new TextDecoder().decode(file.bytes.slice(0, 5))).toBe("%PDF-");
  });
});

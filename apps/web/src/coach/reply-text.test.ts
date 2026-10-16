import { describe, expect, it } from "vitest";
import { coachReplyBlocks } from "./reply-text";

const plain = (text: string) => ({ text, strong: false, emphasis: false });
const strong = (text: string) => ({ text, strong: true, emphasis: false });

describe("an AI Coach reply, as the Coach Panel shows it (#164)", () => {
  it("keeps plain text as paragraphs, split on blank lines, with their line breaks", () => {
    expect(coachReplyBlocks("Bonjour Marie.\nComment allez-vous ?\n\nVoici mon conseil.")).toEqual([
      { kind: "paragraph", lines: [[plain("Bonjour Marie.")], [plain("Comment allez-vous ?")]] },
      { kind: "paragraph", lines: [[plain("Voici mon conseil.")]] },
    ]);
  });

  it("sets **bold** text in bold, without its asterisks (QA #63, case 3.3)", () => {
    expect(coachReplyBlocks("Vous visez le poste de **Directrice des opérations** à __Lyon__.")).toEqual([
      { kind: "paragraph", lines: [[plain("Vous visez le poste de "), strong("Directrice des opérations"), plain(" à "), strong("Lyon"), plain(".")]] },
    ]);
  });

  it("sets *italic* and _italic_ text in italics, and bold inside it in both", () => {
    expect(coachReplyBlocks("Un *Lean management* reconnu, _très_ recherché : ***priorité***.")).toEqual([
      {
        kind: "paragraph",
        lines: [
          [
            plain("Un "),
            { text: "Lean management", strong: false, emphasis: true },
            plain(" reconnu, "),
            { text: "très", strong: false, emphasis: true },
            plain(" recherché : "),
            { text: "priorité", strong: true, emphasis: true },
            plain("."),
          ],
        ],
      },
    ]);
  });

  it("leaves asterisks and underscores that do not mark text: in words, in sums, alone", () => {
    expect(coachReplyBlocks("Le fichier mon_cv_2026.pdf, 5 * 3 = 15 et 2*3*4.")).toEqual([
      { kind: "paragraph", lines: [[plain("Le fichier mon_cv_2026.pdf, 5 * 3 = 15 et 2*3*4.")]] },
    ]);
  });

  it("drops a ** or __ left unclosed, rather than showing it", () => {
    expect(coachReplyBlocks("Le poste de **Directrice à Lyon.")).toEqual([{ kind: "paragraph", lines: [[plain("Le poste de Directrice à Lyon.")]] }]);
  });

  it("makes a list of lines starting with -, * or •", () => {
    expect(coachReplyBlocks("Vos points forts :\n- **Pilotage**\n* Lean management\n• Budget")).toEqual([
      { kind: "paragraph", lines: [[plain("Vos points forts :")]] },
      { kind: "list", ordered: false, start: 1, items: [[[strong("Pilotage")]], [[plain("Lean management")]], [[plain("Budget")]]] },
    ]);
  });

  it("makes a numbered list of lines starting with 1. or 1), from its first number, even with blank lines between items", () => {
    expect(coachReplyBlocks("3. Relancer\n\n4) Préparer l'entretien")).toEqual([
      { kind: "list", ordered: true, start: 3, items: [[[plain("Relancer")]], [[plain("Préparer l'entretien")]]] },
    ]);
  });

  it("keeps a line that follows a list item, indented or not, in that item", () => {
    expect(coachReplyBlocks("1. **Pilotage**\n   Vous avez dirigé 3 sites.\n2. Budget\n\nEn résumé : un bon profil.")).toEqual([
      { kind: "list", ordered: true, start: 1, items: [[[strong("Pilotage")], [plain("Vous avez dirigé 3 sites.")]], [[plain("Budget")]]] },
      { kind: "paragraph", lines: [[plain("En résumé : un bon profil.")]] },
    ]);
  });

  it("starts a new list when bullets follow numbers", () => {
    expect(coachReplyBlocks("1. Relancer\n- par e-mail")).toEqual([
      { kind: "list", ordered: true, start: 1, items: [[[plain("Relancer")]]] },
      { kind: "list", ordered: false, start: 1, items: [[[plain("par e-mail")]]] },
    ]);
  });

  it("sets a heading as a bold paragraph of its own, shows a quote as text and leaves out horizontal rules", () => {
    expect(coachReplyBlocks("## Votre positionnement\nUn profil solide.\n\n---\n> Une citation")).toEqual([
      { kind: "paragraph", lines: [[strong("Votre positionnement")]] },
      { kind: "paragraph", lines: [[plain("Un profil solide.")]] },
      { kind: "paragraph", lines: [[plain("Une citation")]] },
    ]);
  });

  it("shows inline code and links as their text", () => {
    expect(coachReplyBlocks("Tapez `Directrice` sur [l'Apec](https://www.apec.fr).")).toEqual([
      { kind: "paragraph", lines: [[plain("Tapez Directrice sur l'Apec.")]] },
    ]);
  });
});

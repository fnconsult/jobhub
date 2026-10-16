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

  it("shows inline code and links as their text", () => {
    expect(coachReplyBlocks("Tapez `Directrice` sur [l'Apec](https://www.apec.fr).")).toEqual([
      { kind: "paragraph", lines: [[plain("Tapez Directrice sur l'Apec.")]] },
    ]);
  });
});

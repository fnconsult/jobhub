import { describe, expect, it } from "vitest";
import { contentBlocks } from "./content-blocks";

describe("A Job Offer's content, laid out", () => {
  it("splits the posting into paragraphs at blank lines, keeping line breaks within one", () => {
    expect(contentBlocks("Acme recrute son DAF.\nPoste basé à Lyon.\n\n\nRémunération attractive.")).toEqual([
      { kind: "paragraph", lines: ["Acme recrute son DAF.", "Poste basé à Lyon."] },
      { kind: "paragraph", lines: ["Rémunération attractive."] },
    ]);
  });

  it("turns bulleted and numbered lines into lists", () => {
    expect(contentBlocks("Vos missions :\n- Piloter la clôture\n• Encadrer 12 personnes\n2. Négocier avec les banques\nÀ très vite")).toEqual([
      { kind: "heading", text: "Vos missions :" },
      { kind: "list", items: ["Piloter la clôture", "Encadrer 12 personnes", "Négocier avec les banques"] },
      { kind: "paragraph", lines: ["À très vite"] },
    ]);
  });

  it("makes a short line on its own that ends with a colon, or is in capitals, a heading", () => {
    expect(contentBlocks("PROFIL RECHERCHÉ\n\nVous avez 15 ans d'expérience.\n\nAvantages :\n\nTélétravail 2 jours.")).toEqual([
      { kind: "heading", text: "PROFIL RECHERCHÉ" },
      { kind: "paragraph", lines: ["Vous avez 15 ans d'expérience."] },
      { kind: "heading", text: "Avantages :" },
      { kind: "paragraph", lines: ["Télétravail 2 jours."] },
    ]);
  });

  it("keeps a long sentence ending with a colon, or a short line inside a paragraph, as text", () => {
    const long = "Rattaché au Directeur Général, vous prendrez en charge l'ensemble des fonctions suivantes :";
    expect(contentBlocks(`${long}\n\nCDI\nLyon`)).toEqual([
      { kind: "paragraph", lines: [long] },
      { kind: "paragraph", lines: ["CDI", "Lyon"] },
    ]);
  });

  it("ignores surrounding spaces and Windows line endings", () => {
    expect(contentBlocks("  Bonjour  \r\n\r\n   \r\n  - un point ")).toEqual([
      { kind: "paragraph", lines: ["Bonjour"] },
      { kind: "list", items: ["un point"] },
    ]);
  });
});

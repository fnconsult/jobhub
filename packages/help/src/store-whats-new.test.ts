import { describe, expect, it } from "vitest";
import type { ReleaseNote } from "./release-notes";
import { STORE_WHATS_NEW_LIMIT, storeWhatsNew } from "./store-whats-new";

const note = (changes: ReleaseNote["changes"], locale: ReleaseNote["locale"] = "fr"): ReleaseNote => ({
  version: "0.2.0",
  locale,
  date: "2026-11-20",
  title: "Jobbbox dans votre poche",
  tags: ["candidature"],
  image: null,
  announce: false,
  intro: "Une introduction **en Markdown**, pour Nouveautés.",
  changes,
});

describe("the stores' « Nouveautés », from the Version's Release Note (#704, ADR-0063)", () => {
  it("is the Release Note's title, then each change in plain text, its bold lead when it has one", () => {
    const text = storeWhatsNew(
      note([
        { kind: "new", text: "**L'app Jobbbox** : vos candidatures et votre coach sur iPhone, iPad et Android." },
        { kind: "improved", text: "Le score de correspondance s'affiche plus vite, voir [l'aide](/aide/score)." },
        { kind: "fixed", text: "**Rappels** : la veille, à la bonne heure." },
      ]),
      "fr",
    );
    expect(text).toBe(
      ["Jobbbox dans votre poche", "", "• L'app Jobbbox", "• Le score de correspondance s'affiche plus vite, voir l'aide.", "• Rappels"].join("\n"),
    );
  });

  it("fits Google Play's 500 characters, the shorter of the two stores, cut at a whole change", () => {
    const changes = Array.from({ length: 30 }, (_, i) => ({ kind: "new" as const, text: `**Une nouveauté numéro ${i + 1} au nom assez long**` }));
    const text = storeWhatsNew(note(changes), "fr");
    expect(STORE_WHATS_NEW_LIMIT).toBe(500);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text.split("\n").at(-1)).toBe("• Et d'autres nouveautés dans l'app, rubrique Nouveautés.");
    expect(text).toContain("• Une nouveauté numéro 1 au nom assez long");
  });

  it("says fixes and improvements for a Version with no Release Note (nothing a Candidate can see)", () => {
    expect(storeWhatsNew(null, "fr")).toBe("Corrections et améliorations.");
    expect(storeWhatsNew(null, "en")).toBe("Fixes and improvements.");
  });

  it("is written in English from the English Release Note", () => {
    const text = storeWhatsNew({ ...note([{ kind: "new", text: "**The Jobbbox app**: on iPhone, iPad and Android." }], "en"), title: "Jobbbox in your pocket" }, "en");
    expect(text).toBe("Jobbbox in your pocket\n\n• The Jobbbox app");
  });
});

import { describe, expect, it } from "vitest";
import { legalDocument, type LegalDocument } from "./index";

const version = (id: LegalDocument["id"], number: string, effective: string): LegalDocument => ({
  id,
  locale: "fr",
  version: number,
  effective,
  title: "Politique de confidentialité",
  summary: [],
  sections: [{ id: "section-1", number: 1, title: "Qui", body: "FN Consult." }],
});

describe("legalDocument — one Legal Document, as the Légal page shows it", () => {
  const written = [version("confidentialite", "3.2", "2026-10-12"), version("confidentialite", "3.10", "2026-12-01"), version("confidentialite", "2.0", "2026-03-01"), version("cookies", "1.0", "2026-10-12")];

  it("is its latest version, with the earlier ones newest first", () => {
    const shown = legalDocument("confidentialite", "fr", {}, written);
    expect(shown?.document.version).toBe("3.10");
    expect(shown?.earlier).toEqual([
      { version: "3.2", effective: "2026-10-12" },
      { version: "2.0", effective: "2026-03-01" },
    ]);
  });

  it("is an earlier version when asked, the others listed beside it", () => {
    const shown = legalDocument("confidentialite", "fr", { version: "2.0" }, written);
    expect(shown?.document.version).toBe("2.0");
    expect(shown?.earlier.map((entry) => entry.version)).toEqual(["3.10", "3.2"]);
  });

  it("is null for a document the team has not written yet, or a version it never had", () => {
    expect(legalDocument("mentions-legales", "fr", {}, written)).toBeNull();
    expect(legalDocument("confidentialite", "fr", { version: "9.9" }, written)).toBeNull();
    expect(legalDocument("confidentialite", "fr")).toBeNull();
  });
});

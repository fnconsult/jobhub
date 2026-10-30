// @vitest-environment jsdom
import { legalDocument, type LegalDocument } from "@jobhub/help";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LegalDocumentView } from "./LegalDocumentView";
import { renderInFrench } from "./testing";

const privacy = (version: string, effective: string): LegalDocument => ({
  id: "confidentialite",
  locale: "fr",
  version,
  effective,
  title: "Politique de confidentialité",
  summary: ["Vos données restent hébergées dans l'Union européenne.", "Vous supprimez tout depuis Mon compte."],
  sections: [
    { id: "section-1", number: 1, title: "Qui est responsable de vos données", body: "Jobbbox est édité par **FN Consult**." },
    { id: "section-2", number: 2, title: "Ce que nous collectons", body: "- Votre adresse e-mail.\n- Vos CV." },
  ],
});
const written = [privacy("3.2", "2026-10-12"), privacy("3.1", "2026-06-01")];

describe("LegalDocumentView — a Legal Document on the Légal page (#470)", () => {
  it("lists the Legal Documents on the left, the one read marked as the current page", () => {
    renderInFrench(<LegalDocumentView id="confidentialite" shown={legalDocument("confidentialite", "fr", {}, written)} />);
    const documents = screen.getByRole("navigation", { name: "Documents légaux" });
    expect(within(documents).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Conditions d'utilisation",
      "Conditions générales de vente",
      "Politique de confidentialité",
      "Cookies",
      "Sous-traitants et IA",
      "Mentions légales",
    ]);
    expect(within(documents).getByRole("link", { name: "Politique de confidentialité" }).getAttribute("aria-current")).toBe("page");
    expect(within(documents).getByRole("link", { name: "Cookies" }).getAttribute("href")).toBe("/legal/cookies");
  });

  it("shows its title, effective date, version, earlier versions, « En bref » and numbered sections", () => {
    renderInFrench(<LegalDocumentView id="confidentialite" shown={legalDocument("confidentialite", "fr", {}, written)} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Politique de confidentialité");
    expect(screen.getByText("En vigueur depuis le 12 octobre 2026")).toBeTruthy();
    expect(screen.getByText("Version 3.2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Version 3.1, en vigueur depuis le 1 juin 2026" }).getAttribute("href")).toBe("/legal/confidentialite?version=3.1");
    const summary = screen.getByRole("region", { name: "En bref" });
    expect(within(summary).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => [heading.textContent, heading.id])).toEqual([
      ["En bref", expect.any(String)],
      ["1.Qui est responsable de vos données", "section-1"],
      ["2.Ce que nous collectons", "section-2"],
    ]);
    expect(screen.getByText("FN Consult").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "Télécharger en PDF" }).getAttribute("href")).toBe("/api/legal/confidentialite/pdf?version=3.2&lang=fr");
  });

  it("has « Sur cette page » on the right, one link per section", () => {
    renderInFrench(<LegalDocumentView id="confidentialite" shown={legalDocument("confidentialite", "fr", {}, written)} />);
    const toc = screen.getByRole("navigation", { name: "Sur cette page" });
    expect(within(toc).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Qui est responsable de vos données", "#section-1"],
      ["Ce que nous collectons", "#section-2"],
    ]);
  });

  it("says when an earlier version is read, and leads back to the one in effect", () => {
    renderInFrench(<LegalDocumentView id="confidentialite" shown={legalDocument("confidentialite", "fr", { version: "3.1" }, written)} />);
    expect(screen.getByText("Vous lisez une version précédente de ce texte.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lire la version en vigueur" }).getAttribute("href")).toBe("/legal/confidentialite");
  });

  it("shows that a text the team has not written yet is not published", () => {
    renderInFrench(<LegalDocumentView id="mentions-legales" shown={null} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Mentions légales");
    expect(screen.getByRole("heading", { name: "Ce texte n'est pas encore publié" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Sur cette page" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Télécharger en PDF" })).toBeNull();
  });
});

// @vitest-environment jsdom
import { legalText, legalTextHistory, type LegalTextVersion } from "@jobhub/help";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LegalTextHistoryView, LegalTextView } from "./LegalTextView";
import { renderInFrench } from "./testing";

const cgu = (effective: string, change: LegalTextVersion["change"], summary: string, locale: LegalTextVersion["locale"] = "fr"): LegalTextVersion => ({
  text: "cgu",
  locale,
  effective,
  title: locale === "fr" ? "Conditions générales d'utilisation" : "Terms of use",
  change,
  approvedBy: "Camille Martin",
  summary,
  inBrief: ["Jobbbox vous aide à chercher un emploi.", "Vous devez avoir 18 ans."],
  sections: [
    { id: "section-1", number: 1, title: "Objet", body: "Jobbbox est édité par **FN Consult**." },
    { id: "invite", number: 2, title: "L'extension sans compte", body: "- Vous cochez les conditions courtes.\n- Rien n'est gardé." },
  ],
});
// Two test versions of the CGU, and one still to come.
const written = [cgu("2026-06-01", "substantielle", "Première version."), cgu("2026-10-12", "mineure", "Une coquille corrigée."), cgu("2027-01-01", "substantielle", "Nouveaux Plans.")];
const on = "2026-10-30";

describe("LegalTextView — a Legal Text on Légal (ADR-0062)", () => {
  it("lists the Legal Texts on the left, the one read marked as the current page", () => {
    renderInFrench(<LegalTextView text="cgu" shown={legalText("cgu", "fr", { on }, written)} />);
    const texts = screen.getByRole("navigation", { name: "Textes légaux" });
    expect(within(texts).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Conditions générales d'utilisation", "/legal/cgu"],
      ["Conditions générales de vente", "/legal/cgv"],
      ["Politique de confidentialité", "/legal/confidentialite"],
      ["Mentions légales", "/legal/mentions-legales"],
    ]);
    expect(within(texts).getByRole("link", { name: "Conditions générales d'utilisation" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows the version in effect: its title, effective date, « Versions précédentes », « En bref », sections and who approved it", () => {
    renderInFrench(<LegalTextView text="cgu" shown={legalText("cgu", "fr", { on }, written)} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Conditions générales d'utilisation");
    expect(screen.getByText("En vigueur depuis le 12 octobre 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Versions précédentes" }).getAttribute("href")).toBe("/legal/cgu/versions");
    expect(screen.queryByText("Version archivée :")).toBeNull();
    expect(within(screen.getByRole("region", { name: "En bref" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => [heading.textContent, heading.id])).toEqual([
      ["En bref", expect.any(String)],
      ["1.Objet", "section-1"],
      ["2.L'extension sans compte", "invite"],
    ]);
    expect(screen.getByText("FN Consult").tagName).toBe("STRONG");
    expect(screen.getByText("Approuvé par Camille Martin, directeur de la publication, le 12 octobre 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Télécharger en PDF" }).getAttribute("href")).toBe("/api/legal/cgu/pdf?version=2026-10-12&lang=fr");
  });

  it("has « Sur cette page » on the right, one link per section, by its anchor", () => {
    renderInFrench(<LegalTextView text="cgu" shown={legalText("cgu", "fr", { on }, written)} />);
    const toc = screen.getByRole("navigation", { name: "Sur cette page" });
    expect(within(toc).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["#section-1", "#invite"]);
  });

  it("marks a dated version no longer in effect as archived, and leads to the one in effect", () => {
    renderInFrench(<LegalTextView text="cgu" shown={legalText("cgu", "fr", { on, version: "2026-06-01" }, written)} />);
    expect(screen.getByText("En vigueur depuis le 1 juin 2026")).toBeTruthy();
    const banner = screen.getByText("Version archivée :").closest(".ds-note")!;
    expect(banner.getAttribute("data-tone")).toBe("warn");
    expect(within(banner as HTMLElement).getByRole("link", { name: "voir la version en vigueur" }).getAttribute("href")).toBe("/legal/cgu");
  });

  it("marks a substantial version still to come as upcoming, with its effective date, and leads to the one in effect (#547)", () => {
    renderInFrench(<LegalTextView text="cgu" shown={legalText("cgu", "fr", { on, version: "2027-01-01" }, written)} />);
    expect(screen.getByText("En vigueur à partir du 1 janvier 2027")).toBeTruthy();
    expect(screen.queryByText("Version archivée :")).toBeNull();
    const banner = screen.getByText("Version à venir : elle entre en vigueur le 1 janvier 2027.").closest(".ds-note") as HTMLElement;
    expect(within(banner).getByRole("link", { name: "voir la version en vigueur" }).getAttribute("href")).toBe("/legal/cgu");
  });

  it("says, in English, that the French text prevails, with a link to it", () => {
    const english = written.map((version) => ({ ...version, locale: "en" as const, title: "Terms of use" }));
    renderInFrench(<LegalTextView text="cgu" shown={legalText("cgu", "en", { on, version: "2026-06-01" }, english)} />);
    const note = screen.getByText("Traduction : le texte français fait foi.").closest(".ds-note") as HTMLElement;
    expect(within(note).getByRole("link", { name: "Lire le texte français" }).getAttribute("href")).toBe("/legal/cgu/2026-06-01?lang=fr");
  });

  it("shows that a text the team has not written yet is not published", () => {
    renderInFrench(<LegalTextView text="mentions-legales" shown={null} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Mentions légales");
    expect(screen.getByRole("heading", { name: "Ce texte n'est pas encore publié" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Sur cette page" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Télécharger en PDF" })).toBeNull();
  });
});

describe("LegalTextHistoryView — a Legal Text's version history", () => {
  it("lists each version in effect so far, newest first: its date and link, its change and its line; never one to come", () => {
    renderInFrench(<LegalTextHistoryView text="cgu" history={legalTextHistory("cgu", "fr", on, written)} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Historique des versions");
    const entries = screen.getAllByRole("listitem");
    expect(entries.map((entry) => entry.textContent)).toEqual([
      "Version du 12 octobre 2026MineureUne coquille corrigée.",
      "Version du 1 juin 2026SubstantiellePremière version.",
    ]);
    expect(within(entries[1]!).getByRole("link", { name: "Version du 1 juin 2026" }).getAttribute("href")).toBe("/legal/cgu/2026-06-01");
    expect(screen.getByRole("navigation", { name: "Textes légaux" })).toBeTruthy();
  });

  it("shows that a text without any version is not published", () => {
    renderInFrench(<LegalTextHistoryView text="cgv" history={[]} />);
    expect(screen.getByRole("heading", { name: "Ce texte n'est pas encore publié" })).toBeTruthy();
  });
});

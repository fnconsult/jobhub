// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AiActivityProvider } from "./AiActivity";
import { Fiche, FicheButtons, FicheProvider, type FicheContent } from "./Fiche";

vi.mock("next/navigation", () => ({ usePathname: () => "/candidatures/a1/entretiens", useSearchParams: () => new URLSearchParams() }));

const CONTENT: FicheContent = {
  card: <p>Ledger · Paris</p>,
  sections: [
    { href: "/candidatures/a1/offre", label: "L'offre" },
    { href: "/candidatures/a1/entretiens", label: "Entretiens" },
  ],
  results: [{ href: "/candidatures/a1/documents?resultat=cover_letter", label: "Lettre de motivation", detail: "Brouillon du 12 octobre 2026" }],
};

function Page({ content = CONTENT }: { content?: FicheContent }) {
  return (
    <AiActivityProvider elements={[]}>
      <FicheProvider>
        <header>
          <FicheButtons />
        </header>
        <main />
        <Fiche content={content} />
      </FicheProvider>
    </AiActivityProvider>
  );
}

const topBar = () => screen.getByRole("banner");
const fiche = () => screen.getByRole("complementary", { name: "Fiche" });
const group = (name: string) => within(fiche()).getByRole("button", { name });

describe("the Fiche (#603, ADR-0070)", () => {
  it("shows the object's card, then its Sections, Activity and Results, with no heading of its own nor ✕", () => {
    renderInFrench(<Page />);

    expect(within(fiche()).getByText("Ledger · Paris")).toBeTruthy();
    expect(group("Sections").getAttribute("aria-expanded")).toBe("true");
    expect(group("Activité").getAttribute("aria-expanded")).toBe("true");
    expect(group("Résultats").getAttribute("aria-expanded")).toBe("true");
    expect(within(fiche()).queryByRole("button", { name: "Fermer" })).toBeNull();
    expect(within(fiche()).queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("links each Section and Result to its address, the one open marked as the current page", () => {
    renderInFrench(<Page />);

    expect(within(fiche()).getByRole("link", { name: "L'offre" }).getAttribute("href")).toBe("/candidatures/a1/offre");
    expect(within(fiche()).getByRole("link", { name: "Entretiens" }).getAttribute("aria-current")).toBe("page");
    expect(within(fiche()).getByRole("link", { name: "L'offre" }).getAttribute("aria-current")).toBeNull();
    const letter = within(fiche()).getByRole("link", { name: /Lettre de motivation/ });
    expect(letter.getAttribute("href")).toBe("/candidatures/a1/documents?resultat=cover_letter");
    expect(letter.textContent).toContain("Brouillon du 12 octobre 2026");
  });

  it("shows the page's AI Activity in its Activity group", () => {
    renderInFrench(<Page />);

    expect(within(fiche()).getByText(/Aucun contenu produit par l'IA sur cette page/)).toBeTruthy();
  });

  it("says so when there is no Result yet", () => {
    renderInFrench(<Page content={{ ...CONTENT, results: [] }} />);

    expect(within(fiche()).getByText(/Aucun résultat pour l'instant/)).toBeTruthy();
  });

  it("folds and unfolds each group", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);

    await user.click(group("Sections"));
    expect(group("Sections").getAttribute("aria-expanded")).toBe("false");
    expect(within(fiche()).queryByRole("link", { name: "L'offre" })).toBeNull();

    await user.click(group("Résultats"));
    expect(within(fiche()).queryByRole("link", { name: /Lettre de motivation/ })).toBeNull();

    await user.click(group("Sections"));
    expect(within(fiche()).getByRole("link", { name: "L'offre" })).toBeTruthy();
  });

  it("opens and closes with « Fiche » in the Top Bar alone", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const button = within(topBar()).getByRole("button", { name: "Fiche" });
    expect(button.getAttribute("aria-expanded")).toBe("true");

    await user.click(button);
    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await user.click(button);
    expect(fiche()).toBeTruthy();
  });

  it("opens on its Activity group with « Activité », which folds that group when it is shown", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const ficheButton = within(topBar()).getByRole("button", { name: "Fiche" });
    const activity = within(topBar()).getByRole("button", { name: "Activité" });
    await user.click(group("Activité"));
    await user.click(ficheButton);
    expect(activity.getAttribute("aria-expanded")).toBe("false");

    await user.click(activity);
    expect(group("Activité").getAttribute("aria-expanded")).toBe("true");
    expect(activity.getAttribute("aria-expanded")).toBe("true");

    await user.click(activity);
    expect(fiche()).toBeTruthy();
    expect(group("Activité").getAttribute("aria-expanded")).toBe("false");
    expect(activity.getAttribute("aria-expanded")).toBe("false");
  });
});

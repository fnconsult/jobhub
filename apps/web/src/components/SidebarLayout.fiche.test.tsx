// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { SidebarLayout } from "./SidebarLayout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/candidatures/a1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const FICHE = { card: <p>Ledger · Paris</p>, sections: [{ href: "/candidatures/a1/offre", label: "L'offre" }], results: [] };

function ApplicationPage() {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title="Responsable logistique" version="1.2.3" freeConversations={[]} fiche={FICHE}>
      <p>La conversation</p>
    </SidebarLayout>
  );
}

const topBar = () => screen.getByRole("banner");

describe("an object's page under « Conversation au centre » (#603, ADR-0070)", () => {
  beforeEach(() => {
    // A desktop: wider than every breakpoint, narrower than none (the compact Top Bar's, #897).
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: !query.includes("<"), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("has « Fiche » and AI Activity's button, « Activité », in its Top Bar, in place of « Aide » (#809)", () => {
    renderInFrench(<ApplicationPage />);

    expect(within(topBar()).getByRole("button", { name: "Fiche" }).getAttribute("aria-expanded")).toBe("true");
    expect(within(topBar()).getByRole("button", { name: "Activité IA" }).textContent).toBe("Activité");
    expect(within(topBar()).queryByRole("button", { name: "Activité" })).toBeNull();
    expect(within(topBar()).queryByRole("button", { name: "Aide" })).toBeNull();
  });

  it("shows the Fiche beside the page, outside it", () => {
    renderInFrench(<ApplicationPage />);

    const fiche = screen.getByRole("complementary", { name: "Fiche" });
    expect(within(fiche).getByText("Ledger · Paris")).toBeTruthy();
    expect(screen.getByRole("main").contains(fiche)).toBe(false);
  });

});

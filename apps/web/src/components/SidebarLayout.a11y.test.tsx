// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      <section aria-label="Conversation avec le Coach IA">
        <textarea aria-label="Votre message" />
      </section>
    </SidebarLayout>
  );
}

/** Whether `first` comes before `second` in the document, so in the order Tab reaches them. */
const before = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the columns of an object's page, for assistive technologies (#608, ADR-0070)", () => {
  beforeEach(() => {
    // Wide enough for the Fiche and the Work Pane beside the conversation.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names each column as a region of its own: the conversation, the Work Pane and the Fiche", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    await user.click(screen.getByRole("button", { name: "Signalement" }));

    expect(within(screen.getByRole("main")).getByRole("region", { name: "Conversation avec le Coach IA" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Envoyer un signalement" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Fiche" })).toBeTruthy();
  });

  it("puts the conversation first in the tab order, then the Work Pane, then the Fiche", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    await user.click(screen.getByRole("button", { name: "Signalement" }));

    const conversation = screen.getByRole("region", { name: "Conversation avec le Coach IA" });
    const pane = screen.getByRole("complementary", { name: "Envoyer un signalement" });
    const fiche = screen.getByRole("complementary", { name: "Fiche" });
    expect(before(conversation, pane)).toBe(true);
    expect(before(pane, fiche)).toBe(true);
  });

  it("moves the focus into the Work Pane as it opens, and gives it back as it closes", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    const opener = screen.getByRole("button", { name: "Signalement" });

    await user.click(opener);
    const pane = screen.getByRole("complementary", { name: "Envoyer un signalement" });
    expect(pane.contains(document.activeElement)).toBe(true);

    await user.click(within(pane).getByRole("button", { name: "Fermer" }));
    expect(document.activeElement).toBe(opener);
  });
});

// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { SidebarLayout } from "./SidebarLayout";

const pathname = vi.hoisted(() => ({ current: "/candidatures/a1" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const FICHE = { card: <p>Ledger · Paris</p>, sections: [{ href: "/candidatures/a1/offre", label: "L'offre" }], results: [] };

/** An Application's page: its conversation, and its Fiche beside it. */
function ApplicationPage() {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title="Responsable logistique" version="1.2.3" freeConversations={[]} fiche={FICHE}>
      <section aria-label="Conversation avec le Coach IA">
        <textarea aria-label="Votre message" />
      </section>
    </SidebarLayout>
  );
}

/** The home page: its conversation, and the Activité column. */
function HomePage() {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title="Nouvelle conversation" version="1.2.3" freeConversations={[]}>
      <section aria-label="Conversation avec le Coach IA">
        <textarea aria-label="Votre message" />
      </section>
    </SidebarLayout>
  );
}

const topBar = () => screen.getByRole("banner");
const USAGE = { used: 1, allowed: 4, percent: 25, quotas: [{ quota: "jobSearches" as const, used: 1, limit: 4 }], jobDigest: "weekly" as const };
const ficheButton = () => within(topBar()).getByRole("button", { name: "Fiche" });
const activityButton = () => within(topBar()).getByRole("button", { name: "Activité" });

describe("an object's page on a phone (#608, ADR-0070)", () => {
  beforeEach(() => {
    pathname.current = "/candidatures/a1";
    // Below 64rem: no room beside the conversation.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the conversation alone, the Fiche closed", () => {
    renderInFrench(<ApplicationPage />);

    expect(ficheButton().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    expect(screen.getByRole("main").closest("[inert]")).toBeNull();
  });

  it("opens the Fiche over the conversation, full screen, titled, the focus on its title and the page behind out of reach", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    await user.click(ficheButton());

    const fiche = screen.getByRole("complementary", { name: "Fiche" });
    expect(document.activeElement).toBe(within(fiche).getByRole("heading", { level: 2, name: "Fiche" }));
    expect(screen.getByRole("main").closest("[inert]")).not.toBeNull();
    expect(topBar().closest("[inert]")).not.toBeNull();
    expect(fiche.closest("[inert]")).toBeNull();
  });

  it("closes the Fiche with its ✕, the focus back on « Fiche » in the Top Bar", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    await user.click(ficheButton());

    await user.click(within(screen.getByRole("complementary", { name: "Fiche" })).getByRole("button", { name: "Fermer" }));

    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    expect(screen.getByRole("main").closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(ficheButton());
  });

  it("closes the Fiche with Escape too", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    await user.click(ficheButton());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    expect(document.activeElement).toBe(ficheButton());
  });

  it("opens the Activité column over the home page's conversation, closed by its ✕", async () => {
    pathname.current = "/";
    const user = userEvent.setup();
    renderInFrench(<HomePage />);

    await user.click(activityButton());
    const column = screen.getByRole("complementary", { name: "Activité" });
    expect(document.activeElement).toBe(within(column).getByRole("heading", { level: 2, name: "Activité" }));
    expect(screen.getByRole("main").closest("[inert]")).not.toBeNull();

    await user.click(within(column).getByRole("button", { name: "Fermer" }));

    expect(screen.queryByRole("complementary", { name: "Activité" })).toBeNull();
    expect(document.activeElement).toBe(activityButton());
  });

  it("puts the page behind out of reach while the Work Pane is open over it, and gives it back when it closes", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    await user.click(screen.getByRole("button", { name: "Signalement" }));

    const pane = screen.getByRole("complementary", { name: "Envoyer un signalement" });
    expect(screen.getByRole("main").closest("[inert]")).not.toBeNull();
    expect(pane.closest("[inert]")).toBeNull();

    await user.click(within(pane).getByRole("button", { name: "Fermer" }));

    expect(screen.getByRole("main").closest("[inert]")).toBeNull();
  });

  it("opens a HelpTerm of the Sidebar's drawer in the Work Pane once the drawer has closed, the focus on its title", async () => {
    pathname.current = "/";
    const user = userEvent.setup();
    renderInFrench(
      <SidebarLayout profiles={[]} canAddProfile={false} title="Nouvelle conversation" version="1.2.3" freeConversations={[]} usage={USAGE}>
        <p>La conversation</p>
      </SidebarLayout>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const drawer = screen.getByRole("dialog");
    await user.click(within(drawer).getByRole("button", { name: /^Hebdomadaire/ }));
    await user.click(within(drawer).getByRole("button", { name: /\(aide\)$/ }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const pane = await screen.findByRole("complementary", { name: "Quota" });
    expect(pane.closest("[inert]")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(pane).getByRole("heading", { level: 2, name: "Quota" })));
  });
});

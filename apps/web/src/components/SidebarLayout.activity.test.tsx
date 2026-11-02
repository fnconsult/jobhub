// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { useConversationFirst, type PageConversation } from "./conversation-first";
import { SidebarLayout } from "./SidebarLayout";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

/** The page's conversation, registered as CoachConversationPage does, with its Context bar's figures. */
function Conversation({ context }: { context: PageConversation["context"] }) {
  const register = useConversationFirst()?.setPage;
  useEffect(() => {
    register?.({ conversationId: "c1", replying: false, context, repliesInView: [], clear: async () => true, startNew: null, askAbout: () => {} });
    return () => register?.(null);
  }, [register, context]);
  return <p>La conversation</p>;
}

function Page({ fiche = null }: { fiche?: Parameters<typeof SidebarLayout>[0]["fiche"] }) {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title="Accueil" version="1.2.3" freeConversations={[]} fiche={fiche}>
      <Conversation context={{ messages: 12, tokens: 3_100 }} />
    </SidebarLayout>
  );
}

const topBar = () => screen.getByRole("banner");
const activityButton = () => within(topBar()).getByRole("button", { name: "Activité" });

describe("« Activité » on the home page and the menus (#607, ADR-0070)", () => {
  beforeEach(() => {
    pathname.current = "/";
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

  it("is in the Top Bar in place of AI Activity's button, the column closed", () => {
    renderInFrench(<Page />);

    expect(activityButton().getAttribute("aria-expanded")).toBe("false");
    expect(within(topBar()).queryByRole("button", { name: /Activité IA/ })).toBeNull();
    expect(within(topBar()).queryByRole("button", { name: "Fiche" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Activité" })).toBeNull();
  });

  it("opens the Activité column beside the conversation, with the Context bar and AI Activity, and no heading nor ✕", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);

    await user.click(activityButton());

    const column = screen.getByRole("complementary", { name: "Activité" });
    expect(activityButton().getAttribute("aria-expanded")).toBe("true");
    expect(activityButton().getAttribute("aria-controls")).toBe(column.id);
    expect(screen.getByRole("main").contains(column)).toBe(false);
    expect(within(column).getByRole("group", { name: "Contexte de la conversation" })).toBeTruthy();
    expect(within(column).getByText("12 / 40 messages · 3,1k / 12k jetons")).toBeTruthy();
    expect(within(column).getByText("Aucun contenu produit par l'IA sur cette page")).toBeTruthy();
    expect(within(column).queryByRole("heading", { level: 2 })).toBeNull();
    expect(within(column).queryByRole("button", { name: /Fermer/ })).toBeNull();
  });

  it("closes it again", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);

    await user.click(activityButton());
    await user.click(activityButton());

    expect(activityButton().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("complementary", { name: "Activité" })).toBeNull();
  });

});

describe("the Context bar in an object's Fiche (#607)", () => {
  beforeEach(() => {
    pathname.current = "/candidatures/a1";
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

  it("is in its Activity group, before AI Activity", () => {
    renderInFrench(<Page fiche={{ card: <p>Ledger · Paris</p>, sections: [], results: [] }} />);

    const fiche = screen.getByRole("complementary", { name: "Fiche" });
    const group = within(fiche).getByRole("group", { name: "Contexte de la conversation" });
    expect(within(group).getByText("12 / 40 messages · 3,1k / 12k jetons")).toBeTruthy();
    expect(group.closest("[data-group]")?.getAttribute("data-group")).toBe("activity");
  });
});

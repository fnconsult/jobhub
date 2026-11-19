// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_WELCOME_SPLIT_WIDTH, SIDE_PANEL_WIDTH } from "@/design/panel-width";
import { renderInFrench } from "@/design/testing";
import { AiActivityLiveProvider, useAiActivityLive } from "./AiActivityLive";
import { SidebarLayout } from "./SidebarLayout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/profils/nouveau",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

type Live = ReturnType<typeof useAiActivityLive>;

/** Hands AI Activity's live store to the test, as the onboarding page feeds it. */
function Grab({ onLive }: { onLive: (live: Live) => void }) {
  const live = useAiActivityLive();
  useEffect(() => {
    onLive(live);
  }, [live, onLive]);
  return null;
}

/** `/profils/nouveau`: the first welcome (`split`), or « Ajouter un profil ». */
function render({ split }: { split: boolean }) {
  let live: Live = null;
  renderInFrench(
    <AiActivityLiveProvider>
      <Grab onLive={(now) => (live = now)} />
      <SidebarLayout profiles={[]} canAddProfile title="Créer un profil" version="1.2.3" freeConversations={[]} split={split}>
        <section className="page-conversation" aria-label="Créer un profil avec votre coach" />
      </SidebarLayout>
    </AiActivityLiveProvider>,
  );
  return { live: () => live };
}

const activity = () => screen.queryByRole("complementary", { name: "Activité" });
const building = () => within(activity()!).getByRole("region", { name: "Profil en construction" });

/** A screen of `width` px: below 64rem, a phone. */
function screenOf(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const rem = Number(/(\d+(?:\.\d+)?)rem/.exec(query)?.[1] ?? 0);
    return { matches: width >= rem * 16, media: query, addEventListener: () => {}, removeEventListener: () => {} };
  });
}

describe("The first welcome's split (#1051)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty(FIRST_WELCOME_SPLIT_WIDTH.property);
  });

  it("opens split in two on a wide screen: the conversation, and Activité beside it", () => {
    screenOf(1440);
    render({ split: true });
    expect(activity()).not.toBeNull();
    expect(activity()!.classList.contains("first-welcome-split")).toBe(true);
    expect(screen.getByRole("button", { name: /Activité IA/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("resizes with the side panel's handle, from the keyboard, its width remembered apart from Activité's elsewhere", () => {
    screenOf(1440);
    render({ split: true });
    const handle = within(activity()!).getByRole("separator", { name: "Redimensionner la fiche" });
    expect(handle.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(handle, { key: "End" });
    expect(window.localStorage.getItem(FIRST_WELCOME_SPLIT_WIDTH.storageKey)).not.toBeNull();
    expect(window.localStorage.getItem(SIDE_PANEL_WIDTH.storageKey)).toBeNull();
    expect(document.documentElement.style.getPropertyValue(FIRST_WELCOME_SPLIT_WIDTH.property)).not.toBe("");
  });

  it("does not split on a phone", () => {
    screenOf(390);
    render({ split: true });
    expect(activity()).toBeNull();
  });

  it("leaves « Ajouter un profil » as it was: Activité closed as the page loads", () => {
    screenOf(1440);
    render({ split: false });
    expect(activity()).toBeNull();
  });

  it("is never empty before the Profile is born: the Profile in construction, filled as the Candidate answers", () => {
    screenOf(1440);
    const { live } = render({ split: true });
    expect(within(building()).getByText("Lecture du CV").nextElementSibling?.textContent).toContain("Pas encore envoyé");
    expect(within(building()).getByText("Poste visé").nextElementSibling?.textContent).toContain("Pas encore dans votre profil");

    act(() => {
      live()!.noteCreation({ type: "interviewed", answered: 0, skipped: 0, provenance: null });
      live()!.noteCreation({ type: "building", targetRole: "Directrice financière", locations: ["Lyon", "Villeurbanne"] });
    });
    expect(within(building()).getByText("Lecture du CV").nextElementSibling?.textContent).toContain("Sans CV");
    expect(within(building()).getByText("Poste visé").nextElementSibling?.textContent).toContain("Directrice financière");
    expect(within(building()).getByText("Lieux").nextElementSibling?.textContent).toContain("Lyon, Villeurbanne");
  });

  it("gives way to the offered Job Search's progress once it starts", () => {
    screenOf(1440);
    const { live } = render({ split: true });
    act(() => live()!.follow({ jobSearchId: "js_1", href: "/profils/nouveau", matching: 0, refining: [], best: [] }));
    expect(within(activity()!).queryByRole("region", { name: "Profil en construction" })).toBeNull();
  });

  it("shows no Profile in construction in Activité outside the first welcome", () => {
    screenOf(1440);
    render({ split: false });
    fireEvent.click(screen.getByRole("button", { name: /Activité IA/ }));
    expect(within(activity()!).queryByRole("region", { name: "Profil en construction" })).toBeNull();
  });
});

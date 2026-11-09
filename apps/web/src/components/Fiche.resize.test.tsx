// @vitest-environment jsdom
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { FICHE_WIDTH_STORAGE_KEY } from "@/design/fiche-width";
import { SidebarLayout } from "./SidebarLayout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/candidatures/a1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const FICHE = {
  card: <p>Ledger · Paris</p>,
  sections: [{ href: "/candidatures/a1/offre", label: "L'offre" }],
  results: [],
};

function ApplicationPage() {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title="Responsable logistique" version="1.2.3" freeConversations={[]} fiche={FICHE}>
      <p>La conversation</p>
    </SidebarLayout>
  );
}

function HomePage() {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title="Accueil" version="1.2.3" freeConversations={[]}>
      <p>La conversation</p>
    </SidebarLayout>
  );
}

/** A screen: `wide` above 64rem, a phone otherwise. */
function screenOf({ wide }: { wide: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide ? !query.includes("<") : query.includes("<"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const handle = () => screen.getByRole("separator", { name: "Redimensionner la fiche" });
const store = new Map<string, string>();

describe("the Fiche's resize handle (#932)", () => {
  beforeEach(() => {
    screenOf({ wide: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    // A 1600px window, the Sidebar open: 1344px for the conversation and its columns.
    vi.stubGlobal("innerWidth", 1600);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("workspace") ? 1344 : 0;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("--fiche-width");
  });

  it("is a vertical separator on the Fiche's left edge, from its default width to half the window at most", () => {
    renderInFrench(<ApplicationPage />);

    const fiche = screen.getByRole("complementary", { name: "Fiche" });
    expect(within(fiche).getByRole("separator")).toBe(handle());
    expect(handle().getAttribute("aria-orientation")).toBe("vertical");
    expect(handle().getAttribute("aria-valuemin")).toBe("320");
    expect(handle().getAttribute("aria-valuemax")).toBe("704");
    expect(handle().getAttribute("aria-valuenow")).toBe("320");
    expect(handle().tabIndex).toBe(0);
  });

  it("← widens it and → narrows it by a step, remembered in this browser", () => {
    renderInFrench(<ApplicationPage />);

    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle().getAttribute("aria-valuenow")).toBe("384");
    expect(store.get(FICHE_WIDTH_STORAGE_KEY)).toBe("384");
    expect(document.documentElement.style.getPropertyValue("--fiche-width")).toBe("384px");

    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle().getAttribute("aria-valuenow")).toBe("352");
  });

  it("End takes it to its widest, Home back to its narrowest", () => {
    renderInFrench(<ApplicationPage />);

    fireEvent.keyDown(handle(), { key: "End" });
    expect(handle().getAttribute("aria-valuenow")).toBe("704");
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(handle().getAttribute("aria-valuenow")).toBe("320");
  });

  it("follows the pointer as it is dragged, and keeps the width on release", () => {
    renderInFrench(<ApplicationPage />);

    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle(), { clientX: 900, pointerId: 1 });
    expect(handle().getAttribute("aria-valuenow")).toBe("420");
    fireEvent.pointerMove(handle(), { clientX: 200, pointerId: 1 });
    expect(handle().getAttribute("aria-valuenow")).toBe("704");
    fireEvent.pointerUp(handle(), { clientX: 200, pointerId: 1 });
    expect(store.get(FICHE_WIDTH_STORAGE_KEY)).toBe("704");
  });

  it("goes to its widest on a click without dragging, and back to its narrowest on the next (WCAG 2.2, 2.5.7)", () => {
    vi.useFakeTimers();
    renderInFrench(<ApplicationPage />);

    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle(), { clientX: 998, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 998, pointerId: 1 });
    fireEvent.click(handle(), { detail: 1 });
    // Not at once: the click may be a double-click's first.
    expect(handle().getAttribute("aria-valuenow")).toBe("320");
    act(() => vi.advanceTimersByTime(300));
    expect(handle().getAttribute("aria-valuenow")).toBe("704");
    expect(store.get(FICHE_WIDTH_STORAGE_KEY)).toBe("704");

    fireEvent.click(handle(), { detail: 1 });
    act(() => vi.advanceTimersByTime(300));
    expect(handle().getAttribute("aria-valuenow")).toBe("320");
  });

  it("ignores the click that ends a drag", () => {
    renderInFrench(<ApplicationPage />);

    fireEvent.pointerDown(handle(), { clientX: 1000, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle(), { clientX: 900, pointerId: 1 });
    fireEvent.pointerUp(handle(), { clientX: 900, pointerId: 1 });
    fireEvent.click(handle(), { detail: 1 });
    expect(handle().getAttribute("aria-valuenow")).toBe("420");
  });

  it("goes back to its default width on a double-click, forgetting the one it had", () => {
    vi.useFakeTimers();
    store.set(FICHE_WIDTH_STORAGE_KEY, "480");
    renderInFrench(<ApplicationPage />);
    expect(handle().getAttribute("aria-valuenow")).toBe("480");

    // A double-click's two clicks: the first waits, the second brings back the default width.
    act(() => {
      fireEvent.click(handle(), { detail: 1 });
      fireEvent.click(handle(), { detail: 2 });
      vi.advanceTimersByTime(300);
    });
    expect(handle().getAttribute("aria-valuenow")).toBe("320");
    expect(store.has(FICHE_WIDTH_STORAGE_KEY)).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--fiche-width")).toBe("");
  });

  it("shows a remembered width wider than the window allows at the widest it may be, keeping the choice", () => {
    store.set(FICHE_WIDTH_STORAGE_KEY, "900");
    renderInFrench(<ApplicationPage />);

    expect(handle().getAttribute("aria-valuenow")).toBe("704");
    expect(store.get(FICHE_WIDTH_STORAGE_KEY)).toBe("900");
  });

  it("is on the Activité column too, the same column", async () => {
    renderInFrench(<HomePage />);
    fireEvent.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Activité IA",
      }),
    );

    const column = await screen.findByRole("complementary", {
      name: "Activité",
    });
    expect(
      within(column).getByRole("separator", {
        name: "Redimensionner la fiche",
      }),
    ).toBeTruthy();
  });

  it("is not there on a phone, where the Fiche takes the whole screen", () => {
    screenOf({ wide: false });
    renderInFrench(<ApplicationPage />);
    fireEvent.click(
      within(screen.getByRole("banner")).getAllByRole("button", {
        name: "Fiche",
      })[0]!,
    );

    expect(screen.queryByRole("separator")).toBeNull();
  });
});

// @vitest-environment jsdom
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { helpArticle } from "@/coach-help";
import { renderInFrench } from "@/design/testing";
import { WORK_PANE_WIDTH } from "@/design/panel-width";
import { useWorkPane } from "./work-pane";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

vi.mock("next/navigation", () => ({ usePathname: () => "/compte", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const ARTICLE = helpArticle("page-account", "fr")!;

function Opener() {
  const pane = useWorkPane();
  return (
    <button type="button" onClick={() => pane?.open({ kind: "help", article: ARTICLE })}>
      Aide
    </button>
  );
}

/** The page as SidebarLayout lays it out: the conversation and the Work Pane, children of the workspace. */
function Page({ fiche = false }: { fiche?: boolean }) {
  return (
    <WorkPaneProvider version="1.2.3">
      <div className="workspace">
        <main>
          <Opener />
        </main>
        <WorkPane />
        {fiche ? <aside className="fiche" aria-label="Fiche" /> : null}
      </div>
    </WorkPaneProvider>
  );
}

/** A screen: `wide` from 64rem, a phone otherwise. */
function screenOf({ wide }: { wide: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide ? !query.includes("<") : query.includes("<"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "Aide" }));
const handle = () => screen.getByRole("separator", { name: "Redimensionner le panneau" });
const store = new Map<string, string>();

describe("the Work Pane's resize handle (#932)", () => {
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
    // A 1600px window, the Sidebar open: 1344px for the conversation and its columns; the Fiche, when open, 320px.
    vi.stubGlobal("innerWidth", 1600);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("workspace") ? 1344 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("fiche") ? 320 : 0;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("--work-pane-width");
  });

  it("is a focusable vertical separator on the pane's left edge, from 20rem to half the window, at its default width", () => {
    renderInFrench(<Page />);
    open();

    const pane = screen.getByRole("complementary", { name: "Mon compte" });
    expect(within(pane).getByRole("separator")).toBe(handle());
    expect(pane.firstElementChild).toBe(handle());
    expect(handle().getAttribute("aria-orientation")).toBe("vertical");
    expect(handle().getAttribute("aria-valuemin")).toBe("320");
    // Half the window (800px) would leave the conversation under 28rem: 1344 − 31rem = 848, so 800.
    expect(handle().getAttribute("aria-valuemax")).toBe("800");
    // 32% of 1600px is 512px, which is also its 32rem cap.
    expect(handle().getAttribute("aria-valuenow")).toBe("512");
    expect(handle().tabIndex).toBe(0);
  });

  it("leaves room for the side panel beside it", () => {
    renderInFrench(<Page fiche />);
    open();
    // 1344 − 31rem − (320 + 1rem) = 512.
    expect(handle().getAttribute("aria-valuemax")).toBe("512");
  });

  it("← widens it and → narrows it by a step, Home and End to its limits, remembered in this browser", () => {
    renderInFrench(<Page />);
    open();

    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(handle().getAttribute("aria-valuenow")).toBe("544");
    expect(store.get(WORK_PANE_WIDTH.storageKey)).toBe("544");
    expect(document.documentElement.style.getPropertyValue("--work-pane-width")).toBe("544px");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle().getAttribute("aria-valuenow")).toBe("480");
    fireEvent.keyDown(handle(), { key: "Home" });
    expect(handle().getAttribute("aria-valuenow")).toBe("320");
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(handle().getAttribute("aria-valuenow")).toBe("320");
    fireEvent.keyDown(handle(), { key: "End" });
    expect(handle().getAttribute("aria-valuenow")).toBe("800");
  });

  it("keeps Escape for the pane, but its own keys do not close it", () => {
    renderInFrench(<Page />);
    open();
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(screen.queryByRole("complementary")).not.toBeNull();
    fireEvent.keyDown(handle(), { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("follows the pointer as it is dragged, within its limits, and keeps the width on release", () => {
    renderInFrench(<Page />);
    open();

    fireEvent.pointerDown(handle(), { clientX: 900, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle(), { clientX: 800, pointerId: 1 });
    expect(handle().getAttribute("aria-valuenow")).toBe("612");
    expect(store.has(WORK_PANE_WIDTH.storageKey)).toBe(false);
    fireEvent.pointerMove(handle(), { clientX: 1400, pointerId: 1 });
    expect(handle().getAttribute("aria-valuenow")).toBe("320");
    fireEvent.pointerUp(handle(), { clientX: 1400, pointerId: 1 });
    expect(store.get(WORK_PANE_WIDTH.storageKey)).toBe("320");
  });

  it("goes to its widest on a click, and back to its default width, forgotten, on a double-click", () => {
    vi.useFakeTimers();
    renderInFrench(<Page />);
    open();

    fireEvent.click(handle(), { detail: 1 });
    act(() => vi.advanceTimersByTime(300));
    expect(handle().getAttribute("aria-valuenow")).toBe("800");

    fireEvent.click(handle(), { detail: 1 });
    fireEvent.click(handle(), { detail: 2 });
    act(() => vi.advanceTimersByTime(300));
    expect(handle().getAttribute("aria-valuenow")).toBe("512");
    expect(store.has(WORK_PANE_WIDTH.storageKey)).toBe(false);
  });

  it("starts at the width this browser remembers", () => {
    store.set(WORK_PANE_WIDTH.storageKey, "600");
    renderInFrench(<Page />);
    open();
    expect(handle().getAttribute("aria-valuenow")).toBe("600");
  });

  it("has no handle on a phone, where the pane takes the whole screen", () => {
    screenOf({ wide: false });
    renderInFrench(<Page />);
    open();
    expect(screen.getByRole("complementary")).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
  });
});

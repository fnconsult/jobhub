// @vitest-environment jsdom
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachSpaceLayout } from "./CoachSpaceLayout";
vi.mock("next/navigation", () => ({ usePathname: () => "/espace-coach/seances", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("the Human Coach's own navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("names the page in the Top Bar and keeps its content in one main landmark", () => {
    renderInFrench(<CoachSpaceLayout><section>Cartes de séance</section></CoachSpaceLayout>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Mes séances");
    expect(screen.getByRole("main").textContent).toBe("Cartes de séance");
    expect(screen.getAllByRole("navigation")[0]!.querySelectorAll("a")).toHaveLength(8);
  });
  it("opens the drawer at the current page, traps focus, and restores it on Escape", async () => {
    const user = userEvent.setup();
    renderInFrench(<CoachSpaceLayout><button type="button">Dans la page</button></CoachSpaceLayout>);
    const menu = screen.getByRole("button", { name: "Menu" });
    await user.click(menu);
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    expect(document.activeElement).toBe(within(drawer).getByRole("link", { name: "Mes séances" }));
    await user.tab({ shift: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(menu);
  });
  it("opens Notifications with the existing accessible drawer", async () => {
    const user = userEvent.setup();
    renderInFrench(<CoachSpaceLayout><p>Cartes</p></CoachSpaceLayout>);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("dialog", { name: "Notifications" }).textContent).toContain("Aucune notification.");
  });
});

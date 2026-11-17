// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { SidebarShell } from "./SidebarShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/candidatures",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function Shell({ label = "Jobbbox" }: { label?: string }) {
  return (
    <SidebarShell brand={{ href: "/", label }} nav={() => <nav aria-label="Menu principal" />} title="Candidatures" signOut={false}>
      <p>La page</p>
    </SidebarShell>
  );
}

describe("the logo at the top of the Sidebar (#988, ADR-0105)", () => {
  beforeEach(() => {
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

  it("leads home with the symbol, then the name, which stays the link's accessible name", () => {
    const { container } = renderInFrench(<Shell />);
    const brand = container.querySelector<HTMLAnchorElement>(".sidebar-docked .brand")!;
    expect(brand.getAttribute("href")).toBe("/");
    expect(brand.textContent).toBe("Jobbbox");
    const symbol = brand.querySelector("svg.ds-logo")!;
    expect(symbol.getAttribute("aria-hidden")).toBe("true");
    // Still: it moves only in the public header (ADR-0105).
    expect(symbol.hasAttribute("data-animated")).toBe(false);
  });

  it("names the Back Office's « Jobbbox · Back Office »", () => {
    const { container } = renderInFrench(<Shell label="Jobbbox · Back Office" />);
    expect(container.querySelector(".sidebar-docked .brand")!.textContent).toBe("Jobbbox · Back Office");
  });

  it("puts the symbol alone in the Top Bar, named « Jobbbox », for when the Sidebar is collapsed", () => {
    renderInFrench(<Shell />);
    const topbar = screen.getByRole("banner");
    const home = within(topbar).getByRole("link", { name: "Jobbbox" });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.classList.contains("topbar-brand")).toBe(true);
    expect(home.textContent).toBe("");
    expect(home.querySelector("svg.ds-logo:not([data-animated])")).not.toBeNull();
  });

  it("shows that symbol only while the docked Sidebar is collapsed, never inside the app", () => {
    const css = readFileSync("apps/web/src/app/app.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const shown = [...css.matchAll(/([^{}]+)\{[^{}]*display:\s*inline-flex[^{}]*\}/g)].map((rule) => rule[1]!.trim()).filter((selector) => selector.includes(".topbar-brand"));
    expect(shown.length).toBeGreaterThan(0);
    for (const selector of shown) expect(selector).toContain('html[data-sidebar="closed"]');
    expect(css).toMatch(/\.topbar \.topbar-brand\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/html\[data-in-app\][^{]*\.topbar-brand[^{]*\{[^}]*display:\s*none/);
  });
});

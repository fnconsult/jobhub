// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import type { UnfoldedMenu } from "@/sidebar-menus";
import { ConversationFirstProvider, SidebarConversations, SidebarMenu } from "./conversation-first";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

const APPLICATIONS: UnfoldedMenu = {
  shown: [
    { id: "a1", label: "Acme · DAF H/F", href: "/candidatures/a1", toHandle: false },
    { id: "a2", label: "Ledger · Contrôleur de gestion", href: "/candidatures/a2", toHandle: true },
  ],
  total: 12,
};

/** The Sidebar under « Conversation au centre »: « Coach », then Mes candidatures, which unfolds into its Applications. */
function Sidebar({ menus = { applications: APPLICATIONS } }: { menus?: { applications?: UnfoldedMenu } }) {
  return (
    <ConversationFirstProvider conversations={[{ id: "11111111-1111-4111-8111-111111111111", title: "Préparer mon pitch" }]} menus={menus}>
      <nav aria-label="Navigation principale">
        <SidebarConversations />
        <ul>
          <SidebarMenu menu="applications" href="/candidatures" current={pathname.current.startsWith("/candidatures")} icon={null} label="Mes candidatures" />
        </ul>
      </nav>
    </ConversationFirstProvider>
  );
}

const sidebar = () => screen.getByRole("navigation", { name: "Navigation principale" });
const applications = () => within(sidebar()).getByRole("list", { name: "Mes candidatures" });

describe("a Sidebar menu with objects, « Conversation au centre » on (ADR-0070, #604)", () => {
  beforeEach(() => {
    pathname.current = "/";
    window.localStorage.clear();
  });
  afterEach(() => window.localStorage.clear());

  it("unfolds Mes candidatures into its Applications, those à traiter marked, then « Tout voir (N) » to its page", () => {
    renderInFrench(<Sidebar />);
    expect(within(sidebar()).getByRole("link", { name: "Mes candidatures" }).getAttribute("href")).toBe("/candidatures");
    const links = within(applications()).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Acme · DAF H/F", "/candidatures/a1"],
      ["Ledger · Contrôleur de gestion, à traiter", "/candidatures/a2"],
      ["Tout voir (12)", "/candidatures"],
    ]);
  });

  it("highlights the Application open, rather than Mes candidatures", () => {
    pathname.current = "/candidatures/a2";
    renderInFrench(<Sidebar />);
    expect(within(applications()).getByRole("link", { name: /Contrôleur de gestion/ }).getAttribute("aria-current")).toBe("page");
    expect(within(applications()).getByRole("link", { name: "Acme · DAF H/F" }).getAttribute("aria-current")).toBeNull();
    expect(within(sidebar()).getByRole("link", { name: "Mes candidatures" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks Mes candidatures as the page shown on its own page", () => {
    pathname.current = "/candidatures";
    renderInFrench(<Sidebar />);
    expect(within(sidebar()).getByRole("link", { name: "Mes candidatures" }).getAttribute("aria-current")).toBe("page");
  });

  it("remembers in this browser that a menu was folded", async () => {
    const user = userEvent.setup();
    const { unmount } = renderInFrench(<Sidebar />);
    const fold = within(sidebar()).getByRole("button", { name: "Dérouler « Mes candidatures »" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    await user.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(within(sidebar()).queryByRole("list", { name: "Mes candidatures" })).toBeNull();
    unmount();

    renderInFrench(<Sidebar />);
    expect(within(sidebar()).getByRole("button", { name: "Dérouler « Mes candidatures »" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(sidebar()).queryByRole("list", { name: "Mes candidatures" })).toBeNull();
  });

  it("remembers « Coach » folded too, apart from the other menus", async () => {
    const user = userEvent.setup();
    const { unmount } = renderInFrench(<Sidebar />);
    await user.click(within(sidebar()).getByRole("button", { name: "Coach" }));
    unmount();

    renderInFrench(<Sidebar />);
    expect(within(sidebar()).getByRole("button", { name: "Coach" }).getAttribute("aria-expanded")).toBe("false");
    expect(applications()).toBeTruthy();
  });

  it("unfolds still when this browser keeps nothing (storage blocked)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderInFrench(<Sidebar />);
    expect(applications()).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("is a plain link when the menu has no object", () => {
    renderInFrench(<Sidebar menus={{ applications: { shown: [], total: 0 } }} />);
    expect(within(sidebar()).getByRole("link", { name: "Mes candidatures" })).toBeTruthy();
    expect(within(sidebar()).queryByRole("button", { name: "Dérouler « Mes candidatures »" })).toBeNull();
  });
});

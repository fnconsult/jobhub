// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import type { UnfoldedMenu } from "@/sidebar-menus";
import { ConversationFirstProvider, SidebarConversations, SidebarMenu } from "./conversation-first";

const pathname = vi.hoisted(() => ({ current: "/" }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current, useRouter: () => ({ refresh }) }));

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

describe("an Application's « … » in the Sidebar, as every conversation has it (#1130)", () => {
  const CONVERSATION = "33333333-3333-4333-8333-333333333333";
  const RENAMABLE: UnfoldedMenu = {
    shown: [
      { id: "a1", label: "Exemple Digital · Building tomorrow, together", title: "Building tomorrow, together", href: "/candidatures/a1", toHandle: false, conversationId: CONVERSATION },
      { id: "a2", label: "Ledger · Contrôleur de gestion", title: "Contrôleur de gestion", href: "/candidatures/a2", toHandle: true },
    ],
    total: 2,
  };
  let fetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    pathname.current = "/";
    window.localStorage.clear();
    refresh.mockClear();
    fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  const openActions = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    within(sidebar()).getByRole("button", { name: `Actions pour « ${name} »` }).focus();
    await user.keyboard("{Enter}");
    return screen.findByRole("menu");
  };

  it("renames the Application from « Renommer »: its own title, for this Candidate only, and the page follows", async () => {
    fetch.mockResolvedValueOnce(Response.json({ id: "a1" }));
    const user = userEvent.setup();
    renderInFrench(<Sidebar menus={{ applications: RENAMABLE }} />);

    await user.click(within(await openActions(user, "Exemple Digital · Building tomorrow, together")).getByRole("menuitem", { name: "Renommer" }));
    const title = within(sidebar()).getByRole("textbox", { name: "Intitulé de la candidature" });
    expect(title).toHaveProperty("value", "Building tomorrow, together");
    await user.clear(title);
    await user.type(title, "Senior Program Director – Delivery Management{Enter}");

    expect(fetch).toHaveBeenCalledWith("/api/applications/a1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "Senior Program Director – Delivery Management" }) }));
    expect(refresh).toHaveBeenCalled();
  });

  it("clears its conversation after a confirming Dialog, the Application staying; none to clear before its first message", async () => {
    const user = userEvent.setup();
    renderInFrench(<Sidebar menus={{ applications: RENAMABLE }} />);

    await user.click(within(await openActions(user, "Exemple Digital · Building tomorrow, together")).getByRole("menuitem", { name: "Effacer la conversation" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Effacer" }));
    expect(fetch).toHaveBeenCalledWith(`/api/coach/conversations/${CONVERSATION}`, { method: "DELETE" });
    expect(refresh).toHaveBeenCalled();

    await user.keyboard("{Escape}");
    const menu = await openActions(user, "Ledger · Contrôleur de gestion");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Renommer"]);
  });
});

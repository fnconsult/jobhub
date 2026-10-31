// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { ClearConversationButton, ConversationFirstProvider, SidebarConversations, useConversationFirst, type PageConversation } from "./conversation-first";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

const FREE = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Préparer mon pitch" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Négocier le salaire" },
];

/** A page showing its conversation, as the home page does: it registers itself with the Top Bar and the Sidebar. */
function Page({ page }: { page: PageConversation }) {
  const conversationFirst = useConversationFirst();
  const register = conversationFirst?.setPage;
  useEffect(() => {
    register?.(page);
    return () => register?.(null);
  }, [register, page]);
  return null;
}

function Shell({ page }: { page?: PageConversation }) {
  return (
    <ConversationFirstProvider conversations={FREE}>
      <nav aria-label="Navigation principale">
        <SidebarConversations />
      </nav>
      <header>
        <ClearConversationButton />
      </header>
      {page ? <Page page={page} /> : null}
    </ConversationFirstProvider>
  );
}

const sidebar = () => screen.getByRole("navigation", { name: "Navigation principale" });

describe("the Sidebar's conversations, « Conversation au centre » on (#601, ADR-0070)", () => {
  beforeEach(() => {
    pathname.current = "/";
    // « Coach » folded is remembered in this browser (#604): each test starts with it unfolded.
    window.localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("has « Nouvelle conversation », to the home page, and « Coach » with the Free conversations, each its own page", () => {
    renderInFrench(<Shell />);
    expect(within(sidebar()).getByRole("link", { name: "Nouvelle conversation" }).getAttribute("href")).toBe("/");
    const coach = within(sidebar()).getByRole("list", { name: "Coach" });
    const links = within(coach).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Préparer mon pitch", `/conversations/${FREE[0]!.id}`],
      ["Négocier le salaire", `/conversations/${FREE[1]!.id}`],
    ]);
  });

  it("marks the conversation shown as the current page", () => {
    pathname.current = `/conversations/${FREE[1]!.id}`;
    renderInFrench(<Shell />);
    expect(within(sidebar()).getByRole("link", { name: "Négocier le salaire" }).getAttribute("aria-current")).toBe("page");
    expect(within(sidebar()).getByRole("link", { name: "Préparer mon pitch" }).getAttribute("aria-current")).toBeNull();
  });

  it("folds and unfolds « Coach »", async () => {
    renderInFrench(<Shell />);
    const coach = within(sidebar()).getByRole("button", { name: "Coach" });
    expect(coach.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(coach);
    expect(coach.getAttribute("aria-expanded")).toBe("false");
    expect(within(sidebar()).queryByRole("link", { name: "Préparer mon pitch" })).toBeNull();
  });

  it("renames a Free conversation from its actions", async () => {
    const fetch = vi.fn(async () => Response.json({ conversation: { id: FREE[0]!.id, title: "Mon pitch", lastMessageAt: "2026-10-31T10:00:00.000Z" } }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderInFrench(<Shell />);

    within(sidebar()).getByRole("button", { name: "Actions pour « Préparer mon pitch »" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Renommer" }));
    const name = within(sidebar()).getByRole("textbox", { name: "Nom de la conversation" });
    await user.clear(name);
    await user.type(name, "Mon pitch{Enter}");

    expect(fetch).toHaveBeenCalledWith(`/api/coach/conversations/${FREE[0]!.id}`, expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: "Mon pitch" }) }));
    expect(await within(sidebar()).findByRole("link", { name: "Mon pitch" })).toBeTruthy();
  });

  it("deletes a Free conversation after a confirming Dialog, the focus starting on « Annuler »", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderInFrench(<Shell />);

    within(sidebar()).getByRole("button", { name: "Actions pour « Négocier le salaire »" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Supprimer" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Supprimer la conversation « Négocier le salaire » ?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(fetch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Supprimer" }));

    expect(fetch).toHaveBeenCalledWith(`/api/coach/conversations/${FREE[1]!.id}`, { method: "DELETE" });
    await waitFor(() => expect(within(sidebar()).queryByRole("link", { name: "Négocier le salaire" })).toBeNull());
  });

  it("starts a new conversation on the page, rather than reloading it, when the page deletes the one it shows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const startNew = vi.fn();
    const page: PageConversation = { conversationId: FREE[0]!.id, replying: false, clear: vi.fn(), startNew };
    const user = userEvent.setup();
    renderInFrench(<Shell page={page} />);

    within(sidebar()).getByRole("button", { name: "Actions pour « Préparer mon pitch »" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Supprimer" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Supprimer" }));

    await waitFor(() => expect(startNew).toHaveBeenCalledTimes(1));
  });

  it("« Nouvelle conversation » starts afresh on the page that shows one", async () => {
    const startNew = vi.fn();
    renderInFrench(<Shell page={{ conversationId: FREE[0]!.id, replying: false, clear: vi.fn(), startNew }} />);
    await userEvent.click(within(sidebar()).getByRole("link", { name: "Nouvelle conversation" }));
    expect(startNew).toHaveBeenCalledTimes(1);
  });
});

describe("« Effacer » in the Top Bar (#601, ADR-0070)", () => {
  it("is there only while a page shows its conversation", () => {
    renderInFrench(<Shell />);
    expect(screen.queryByRole("button", { name: "Effacer" })).toBeNull();
  });

  it("asks first, the focus on « Annuler », and deletes nothing on « Annuler »", async () => {
    const clear = vi.fn(async () => true);
    const user = userEvent.setup();
    renderInFrench(<Shell page={{ conversationId: FREE[0]!.id, replying: false, clear, startNew: vi.fn() }} />);

    await user.click(screen.getByRole("button", { name: "Effacer" }));
    const dialog = screen.getByRole("alertdialog", { name: "Effacer cette conversation ?" });
    expect(within(dialog).getByText("Tous les messages de cette conversation seront supprimés. La Mémoire du coach reste.")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Annuler" }));
    await user.keyboard("{Enter}");
    expect(clear).not.toHaveBeenCalled();
  });

  it("deletes every message of the page's conversation once confirmed, and takes it off the Sidebar", async () => {
    const clear = vi.fn(async () => true);
    const user = userEvent.setup();
    renderInFrench(<Shell page={{ conversationId: FREE[0]!.id, replying: false, clear, startNew: vi.fn() }} />);

    await user.click(screen.getByRole("button", { name: "Effacer" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Effacer" }));

    expect(clear).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(sidebar()).queryByRole("link", { name: "Préparer mon pitch" })).toBeNull());
  });
});

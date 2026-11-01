// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachConversationPage } from "./CoachPanel";
import { ClearConversationButton, ConversationFirstProvider } from "./conversation-first";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const CONVERSATION = { id: "33333333-3333-4333-8333-333333333333", title: "Préparer mon pitch", subject: null, profile: null, lastMessageAt: "2026-10-31T10:00:00.000Z" };

/**
 * The server, as /api/coach and /api/coach/conversations behave: a live reply names its conversation at once, then runs
 * until the Candidate stops it; aborted, only the Candidate's message is saved, a moment later, in that conversation.
 */
function fakeServer() {
  const saved = new Set<string>();
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/coach" && init?.method === "POST") {
      const signal = init.signal!;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "conversation", conversation: CONVERSATION })}\n`));
          signal.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
            setTimeout(() => saved.add(CONVERSATION.id), 0);
          });
        },
      });
      return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
    }
    if (url === `/api/coach/conversations/${CONVERSATION.id}` && init?.method === "DELETE") {
      return new Response(null, { status: saved.delete(CONVERSATION.id) ? 204 : 404 });
    }
    return new Response(null, { status: 404 });
  });
  return { fetch, saved };
}

function HomePage() {
  return (
    <ConversationFirstProvider conversations={[]}>
      <header>
        <ClearConversationButton />
      </header>
      <CoachConversationPage conversationId={null} />
    </ConversationFirstProvider>
  );
}

describe("« Effacer » on the home conversation while its first reply is on its way (#601)", () => {
  let server: ReturnType<typeof fakeServer>;
  beforeEach(() => {
    server = fakeServer();
    vi.stubGlobal("fetch", server.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("never says « Conversation effacée. » while the message stays saved", async () => {
    const user = userEvent.setup();
    renderInFrench(<HomePage />);

    await user.type(screen.getByRole("textbox", { name: "Votre message" }), "Comment préparer mon pitch ?{Enter}");
    await screen.findByRole("button", { name: "Arrêter" });
    await user.click(screen.getByRole("button", { name: "Effacer" }));
    const dialog = screen.queryByRole("alertdialog");
    if (dialog) await user.click(within(dialog).getByRole("button", { name: "Effacer" }));
    // Whatever the Stop that clearing causes saves, a moment later.
    await new Promise((settled) => setTimeout(settled, 20));

    const saysCleared = screen.queryByText("Conversation effacée.") !== null;
    expect({ saysCleared, stillSaved: server.saved.has(CONVERSATION.id) }).not.toEqual({ saysCleared: true, stillSaved: true });
  });

  it("cannot clear until the reply has come or been stopped, then deletes the message the Stop saved", async () => {
    const user = userEvent.setup();
    renderInFrench(<HomePage />);

    await user.type(screen.getByRole("textbox", { name: "Votre message" }), "Comment préparer mon pitch ?{Enter}");
    await screen.findByRole("button", { name: "Arrêter" });

    // The server has the message already: clearing now would leave it saved by the Stop that follows.
    const clear = screen.getByRole("button", { name: "Effacer" });
    expect(clear.hasAttribute("disabled")).toBe(true);
    await user.click(clear);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Arrêter" }));
    await waitFor(() => expect(server.saved.has(CONVERSATION.id)).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Effacer" }).hasAttribute("disabled")).toBe(false));

    await user.click(screen.getByRole("button", { name: "Effacer" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Effacer" }));

    expect(await screen.findByText("Conversation effacée.")).toBeTruthy();
    expect(server.saved.has(CONVERSATION.id)).toBe(false);
  });
});

const MENU_CONVERSATION = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Mes candidatures",
  subject: { kind: "menu", id: "applications", name: "Mes candidatures" },
  profile: null,
  lastMessageAt: "2026-10-31T10:00:00.000Z",
};

/** The server, for a menu's conversation: replies at once (not live), and gives back the one saved. */
function menuServer({ saved = false }: { saved?: boolean } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/coach" && init?.method === "POST")
      return Response.json({ conversation: MENU_CONVERSATION, reply: "Commencez par la relance chez Acme.", blocked: { message: false, reply: false }, couldNotAnswer: false });
    if (url === `/api/coach/conversations/${MENU_CONVERSATION.id}` && init?.method === "DELETE") return new Response(null, { status: 204 });
    if (url === `/api/coach/conversations/${MENU_CONVERSATION.id}` && saved)
      return Response.json({ conversation: { ...MENU_CONVERSATION, aiDisclosure: true, messages: [{ from: "candidate", text: "Par quoi commencer ?" }, { from: "coach", text: "Par la relance." }] } });
    return new Response(null, { status: 404 });
  });
}

function ApplicationsPage({ conversationId = null }: { conversationId?: string | null }) {
  return (
    <ConversationFirstProvider conversations={[]}>
      <header>
        <ClearConversationButton />
      </header>
      <CoachConversationPage
        conversationId={conversationId}
        subject={{ kind: "menu", id: "applications" }}
        introduction={<p>Vos candidatures, et ce qui les attend.</p>}
        card={<section aria-label="Liste des candidatures">2 candidatures</section>}
        suggestions={<a href="/recherches">Chercher des offres</a>}
      />
    </ConversationFirstProvider>
  );
}

const sentBodies = (fetch: ReturnType<typeof menuServer>) =>
  fetch.mock.calls.filter(([url, init]) => url === "/api/coach" && init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>);

describe("a Sidebar menu's conversation as its page: Mes candidatures (ADR-0070, #604)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/candidatures");
    // A reply's glyph asks whether motion is reduced.
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("shows its card in the thread, and its suggestions until the first message", async () => {
    vi.stubGlobal("fetch", menuServer());
    const user = userEvent.setup();
    renderInFrench(<ApplicationsPage />);
    const thread = screen.getByRole("list", { name: "Vos échanges avec votre coach" });

    expect(within(thread).getByRole("region", { name: "Liste des candidatures" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Chercher des offres" })).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Votre message" }), "Par quoi commencer ?{Enter}");
    expect(await screen.findByText("Commencez par la relance chez Acme.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Chercher des offres" })).toBeNull();
    // The card stays in the thread, before the messages.
    expect(within(thread).getByRole("region", { name: "Liste des candidatures" })).toBeTruthy();
  });

  it("sends each message to the menu's conversation, by its Subject, and stays at its own address", async () => {
    const fetch = menuServer();
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderInFrench(<ApplicationsPage />);

    await user.type(screen.getByRole("textbox", { name: "Votre message" }), "Par quoi commencer ?{Enter}");
    await screen.findByText("Commencez par la relance chez Acme.");
    await user.type(screen.getByRole("textbox", { name: "Votre message" }), "Et ensuite ?{Enter}");
    await waitFor(() => expect(sentBodies(fetch)).toHaveLength(2));

    for (const body of sentBodies(fetch)) {
      expect(body.subject).toEqual({ kind: "menu", id: "applications" });
      expect(body.conversationId).toBeUndefined();
    }
    expect(window.location.pathname).toBe("/candidatures");
  });

  it("brings back the menu's saved conversation", async () => {
    vi.stubGlobal("fetch", menuServer({ saved: true }));
    renderInFrench(<ApplicationsPage conversationId={MENU_CONVERSATION.id} />);
    expect(await screen.findByText("Par la relance.")).toBeTruthy();
  });

  it("clears it with « Effacer » and stays on the menu's page", async () => {
    const fetch = menuServer({ saved: true });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderInFrench(<ApplicationsPage conversationId={MENU_CONVERSATION.id} />);
    await screen.findByText("Par la relance.");

    await user.click(screen.getByRole("button", { name: "Effacer" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Effacer" }));

    expect(await screen.findByText("Conversation effacée.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(`/api/coach/conversations/${MENU_CONVERSATION.id}`, { method: "DELETE" });
    expect(screen.queryByText("Par la relance.")).toBeNull();
    expect(window.location.pathname).toBe("/candidatures");
    expect(screen.getByRole("region", { name: "Liste des candidatures" })).toBeTruthy();
  });
});

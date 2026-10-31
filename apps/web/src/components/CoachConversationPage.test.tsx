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

// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachConversationPage } from "./CoachConversationPage";
import { ContextBar } from "./ContextBar";
import { ConversationFirstProvider } from "./conversation-first";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const CONVERSATION = { id: "33333333-3333-4333-8333-333333333333", title: "Préparer mon pitch", subject: null, profile: null, lastMessageAt: "2026-10-31T10:00:00.000Z" };

/** The server, as /api/coach and /api/coach/conversations say a conversation's Context bar's figures (#607). */
function server({ saved, replied }: { saved: { messages: number; tokens: number }; replied: { messages: number; tokens: number } }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/coach/conversations/${CONVERSATION.id}` && init?.method === "DELETE") return new Response(null, { status: 204 });
    if (url === `/api/coach/conversations/${CONVERSATION.id}`) {
      return Response.json({
        conversation: { ...CONVERSATION, aiDisclosure: true, messages: [{ from: "candidate", text: "Bonjour" }, { from: "coach", text: "Bonjour Marie." }], context: saved },
      });
    }
    if (url === "/api/coach" && init?.method === "POST") {
      return Response.json({ conversation: CONVERSATION, reply: "Commencez par votre pitch.", blocked: { message: false, reply: false }, at: "2026-10-31T10:05:00.000Z", context: replied });
    }
    return new Response(null, { status: 404 });
  });
}

function HomePage({ conversationId = CONVERSATION.id }: { conversationId?: string | null }) {
  return (
    <ConversationFirstProvider conversations={[]}>
      <aside aria-label="Activité">
        <ContextBar />
      </aside>
      <CoachConversationPage conversationId={conversationId} />
    </ConversationFirstProvider>
  );
}

const activity = () => screen.getByRole("complementary", { name: "Activité" });
const bar = () => within(activity()).getByRole("group", { name: "Contexte de la conversation" });

describe("the Context bar in Activité (#607, ADR-0070)", () => {
  beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  afterEach(() => vi.unstubAllGlobals());

  it("says the conversation's messages out of the 40 the coach reads and the jetons of its context out of the 12k ceiling, as the server says them", async () => {
    vi.stubGlobal("fetch", server({ saved: { messages: 12, tokens: 3_100 }, replied: { messages: 14, tokens: 3_600 } }));
    renderInFrench(<HomePage />);

    expect(await within(activity()).findByText("12 / 40 messages · 3,1k / 12k jetons")).toBeTruthy();
    expect(within(bar()).getByRole("meter", { name: "Contexte de la conversation" }).getAttribute("aria-valuenow")).toBe("30");
    expect(bar().textContent).not.toMatch(/tokens/);
    expect(within(bar()).queryByRole("button", { name: "Effacer la conversation" })).toBeNull();
  });

  it("follows the conversation: each reply brings its new figures", async () => {
    vi.stubGlobal("fetch", server({ saved: { messages: 12, tokens: 3_100 }, replied: { messages: 14, tokens: 3_600 } }));
    const user = userEvent.setup();
    renderInFrench(<HomePage />);
    await within(activity()).findByText("12 / 40 messages · 3,1k / 12k jetons");

    await user.type(screen.getByRole("textbox", { name: "Votre message" }), "Et ensuite ?{Enter}");

    expect(await within(activity()).findByText("14 / 40 messages · 3,6k / 12k jetons")).toBeTruthy();
  });

  it("is empty before the conversation's first message", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    renderInFrench(<HomePage conversationId={null} />);

    expect(within(bar()).getByText("0 / 40 messages · 0 / 12k jetons")).toBeTruthy();
  });

  it("from 80 %, says the coach reads only the latest messages and offers « Effacer la conversation », after a confirming Dialog", async () => {
    const fetch = server({ saved: { messages: 34, tokens: 9_400 }, replied: { messages: 36, tokens: 9_900 } });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderInFrench(<HomePage />);
    await within(activity()).findByText("34 / 40 messages · 9,4k / 12k jetons");

    expect(within(bar()).getByText("Le coach ne lit que les messages les plus récents.")).toBeTruthy();
    await user.click(within(bar()).getByRole("button", { name: "Effacer la conversation" }));
    const dialog = screen.getByRole("alertdialog", { name: "Effacer cette conversation ?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Annuler" }));
    await user.click(within(dialog).getByRole("button", { name: "Effacer" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/coach/conversations/${CONVERSATION.id}`, { method: "DELETE" }));
    expect(await within(bar()).findByText("0 / 40 messages · 0 / 12k jetons")).toBeTruthy();
    expect(within(bar()).queryByRole("button", { name: "Effacer la conversation" })).toBeNull();
  });

  it("is not there on a page without a conversation", () => {
    renderInFrench(
      <ConversationFirstProvider conversations={[]}>
        <aside aria-label="Activité">
          <ContextBar />
        </aside>
      </ConversationFirstProvider>,
    );

    expect(within(activity()).queryByRole("group", { name: "Contexte de la conversation" })).toBeNull();
  });
});

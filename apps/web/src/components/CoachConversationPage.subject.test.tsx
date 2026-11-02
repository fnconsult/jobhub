// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachConversationPage } from "./CoachConversationPage";
import { ConversationSuggestions } from "./ConversationSuggestions";
import { ClearConversationButton, ConversationFirstProvider, SidebarConversations } from "./conversation-first";

const ADDRESS = "/candidatures/a1";
vi.mock("next/navigation", () => ({ usePathname: () => "/candidatures/a1", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const SUBJECT = { kind: "application", id: "a1" } as const;
const IN_VIEW = { kind: "application", id: "a1", name: "Responsable logistique", profileId: "p1" } as const;
const SAVED = {
  id: "55555555-5555-4555-8555-555555555555",
  title: "Préparer l'entretien",
  subject: { ...SUBJECT, name: "Responsable logistique" },
  profile: { id: "p1", name: "Logistique" },
  lastMessageAt: "2026-10-31T10:00:00.000Z",
};

/** /api/coach and /api/coach/conversations, answering at once; every message sent is kept, and the saved conversation. */
function fakeServer(saved: boolean) {
  const sent: Record<string, unknown>[] = [];
  let exists = saved;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/coach" && init?.method === "POST") {
      sent.push(JSON.parse(String(init.body)));
      exists = true;
      return Response.json({ conversation: SAVED, reply: "Commençons par l'entreprise." });
    }
    if (url === `/api/coach/conversations/${SAVED.id}` && init?.method === "DELETE") {
      exists = false;
      return new Response(null, { status: 204 });
    }
    if (url === `/api/coach/conversations/${SAVED.id}` && exists) {
      return Response.json({ conversation: { ...SAVED, aiDisclosure: true, messages: [{ from: "candidate", text: "Aide-moi à préparer l'entretien." }] } });
    }
    return new Response(null, { status: 404 });
  });
  return { fetch, sent };
}

/** An Application's page under « Conversation au centre »: its conversation, with the Sidebar and « Effacer ». */
function ApplicationPage({ conversationId = null }: { conversationId?: string | null }) {
  return (
    <ConversationFirstProvider conversations={[]}>
      <nav aria-label="Menu">
        <SidebarConversations />
      </nav>
      <header>
        <ClearConversationButton />
      </header>
      <main>
        <CoachConversationPage
          conversationId={conversationId}
          subject={SUBJECT}
          inView={IN_VIEW}
          introduction={<p>Parlons de votre candidature « Responsable logistique ».</p>}
          suggestions={
            <ConversationSuggestions
              suggestions={[
                { label: "Préparer l'entretien", message: "Aide-moi à préparer l'entretien." },
                { label: "Rédiger une relance", message: "Rédige une relance pour cette candidature." },
              ]}
            />
          }
        />
      </main>
    </ConversationFirstProvider>
  );
}

const conversation = () => screen.getByRole("region", { name: "Conversation avec le Coach IA" });
const thread = () => within(conversation()).getByRole("list", { name: "Vos échanges avec votre coach" });

describe("an Application's page is its conversation (#603, ADR-0070)", () => {
  let server: ReturnType<typeof fakeServer>;
  beforeEach(() => {
    window.history.replaceState(null, "", ADDRESS);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("opens, without a message, on the Introduction and the Application's suggestions", () => {
    server = fakeServer(false);
    vi.stubGlobal("fetch", server.fetch);
    renderInFrench(<ApplicationPage />);

    expect(within(thread()).getByText("Parlons de votre candidature « Responsable logistique ».")).toBeTruthy();
    const suggestions = within(conversation()).getByRole("group", { name: "Suggestions" });
    expect(within(suggestions).getByRole("button", { name: "Préparer l'entretien" })).toBeTruthy();
    expect(within(suggestions).getByRole("button", { name: "Rédiger une relance" })).toBeTruthy();
  });

  it("sends a suggestion to the Application's conversation, with the Application in view, and keeps the page's address", async () => {
    server = fakeServer(false);
    vi.stubGlobal("fetch", server.fetch);
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    await user.click(within(conversation()).getByRole("button", { name: "Préparer l'entretien" }));

    expect(await within(thread()).findByText("Commençons par l'entreprise.")).toBeTruthy();
    expect(server.sent).toEqual([
      expect.objectContaining({ subject: SUBJECT, message: "Aide-moi à préparer l'entretien.", focus: { kind: "application", id: "a1", profileId: "p1" } }),
    ]);
    expect(server.sent[0]).not.toHaveProperty("conversationId");
    expect(window.location.pathname).toBe(ADDRESS);
    expect(screen.queryByRole("link", { name: "Préparer l'entretien" })).toBeNull();
    expect(within(conversation()).queryByRole("group", { name: "Suggestions" })).toBeNull();
  });

  it("sends the next messages to the conversation the first one started", async () => {
    server = fakeServer(false);
    vi.stubGlobal("fetch", server.fetch);
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    await user.click(within(conversation()).getByRole("button", { name: "Préparer l'entretien" }));
    await within(thread()).findByText("Commençons par l'entreprise.");

    await user.type(within(conversation()).getByRole("textbox", { name: "Votre message" }), "Et le salaire ?{Enter}");

    await waitFor(() => expect(server.sent).toHaveLength(2));
    expect(server.sent[1]).toMatchObject({ conversationId: SAVED.id, message: "Et le salaire ?" });
    expect(server.sent[1]).not.toHaveProperty("subject");
  });

  it("brings its saved conversation back, and « Effacer » empties it in place", async () => {
    server = fakeServer(true);
    vi.stubGlobal("fetch", server.fetch);
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage conversationId={SAVED.id} />);
    expect(await within(thread()).findByText("Aide-moi à préparer l'entretien.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Effacer" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Effacer" }));

    expect(await screen.findByText("Conversation effacée.")).toBeTruthy();
    expect(within(thread()).queryByText("Aide-moi à préparer l'entretien.")).toBeNull();
    expect(within(conversation()).getByRole("button", { name: "Préparer l'entretien" })).toBeTruthy();
    expect(window.location.pathname).toBe(ADDRESS);
  });

  it("leaves « Nouvelle conversation » to the home page, never turning the Application's conversation into a Free one", async () => {
    server = fakeServer(false);
    vi.stubGlobal("fetch", server.fetch);
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    await user.click(within(conversation()).getByRole("button", { name: "Préparer l'entretien" }));
    await within(thread()).findByText("Commençons par l'entreprise.");

    const link = screen.getByRole("link", { name: "Nouvelle conversation" });
    expect(link.getAttribute("href")).toBe("/");
    await user.click(link);

    expect(within(thread()).getByText("Commençons par l'entreprise.")).toBeTruthy();
  });
});

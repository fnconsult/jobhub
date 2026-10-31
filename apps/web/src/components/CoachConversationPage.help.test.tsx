// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachConversationPage, CoachPanel } from "./CoachPanel";
import { HelpTerm } from "./HelpTerm";
import { ConversationFirstProvider } from "./conversation-first";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn() }) }));

const CONVERSATION = { id: "44444444-4444-4444-8444-444444444444", title: "Relances", subject: null, profile: null, lastMessageAt: "2026-10-31T10:00:00.000Z" };

/** /api/coach, answering at once; every body it was sent is kept. */
function fakeCoach() {
  const sent: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/coach" && init?.method === "POST") {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ conversation: CONVERSATION, reply: "Voici comment relancer." });
    }
    return new Response(null, { status: 404 });
  });
  return { fetch, sent };
}

/** The home page under « Conversation au centre »: its conversation, its suggestions, and the Work Pane beside it. */
function HomePage() {
  return (
    <ConversationFirstProvider conversations={[]}>
      <WorkPaneProvider version="1.2.3">
        <main id="main" tabIndex={-1}>
          <CoachConversationPage conversationId={null} suggestions={<button type="button">Chercher des offres</button>} />
        </main>
        <WorkPane />
      </WorkPaneProvider>
    </ConversationFirstProvider>
  );
}

const conversation = () => screen.getByRole("region", { name: "Conversation avec le Coach IA" });
const box = () => within(conversation()).getByRole("textbox", { name: "Votre message" });
const workPane = () => screen.getByRole("complementary");

describe("the help of a page that is a conversation, in the Work Pane (#602, ADR-0070)", () => {
  let coach: ReturnType<typeof fakeCoach>;
  beforeEach(() => {
    coach = fakeCoach();
    vi.stubGlobal("fetch", coach.fetch);
    // A reply's glyph asks whether things may move.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("suggests the matching Help Articles above the box while typing, without AI, in place of the suggestions", async () => {
    const user = userEvent.setup();
    renderInFrench(<HomePage />);
    expect(within(conversation()).getByRole("group", { name: "Suggestions" })).toBeTruthy();

    await user.type(box(), "relance");

    const found = await within(conversation()).findByRole("list", { name: "Dans l'aide, sans IA" });
    expect(within(found).getByRole("button", { name: /Relance/ })).toBeTruthy();
    expect(within(conversation()).queryByRole("group", { name: "Suggestions" })).toBeNull();
    expect(coach.fetch).not.toHaveBeenCalled();
  });

  it("opens a suggested Help Article in the Work Pane, not in the thread; « Demander au coach » asks about it in the box", async () => {
    const user = userEvent.setup();
    renderInFrench(<HomePage />);
    await user.type(box(), "relance");
    const found = await within(conversation()).findByRole("list", { name: "Dans l'aide, sans IA" });

    await user.click(within(found).getByRole("button", { name: /^Relance/ }));

    expect(within(workPane()).getByRole("heading", { level: 2, name: "Relance" })).toBe(document.activeElement);
    expect(within(conversation()).queryByRole("heading", { name: "Relance" })).toBeNull();
    await user.click(within(workPane()).getByRole("button", { name: "Demander au coach" }));
    expect(document.activeElement).toBe(box());
    expect((box() as HTMLTextAreaElement).value).toBe("À propos de « Relance » : ");
    // The article stays open beside the conversation.
    expect(workPane()).toBeTruthy();

    await user.type(box(), "quand ?{Enter}");
    await waitFor(() => expect(coach.sent).toHaveLength(1));
    expect(coach.sent[0]).toMatchObject({ message: "À propos de « Relance » : quand ?", helpArticle: { id: "glossary-follow-up", title: "Relance" } });
  });

  it("offers « Comment marche cette page ? » while the conversation is empty, which opens the page's Help Article in the Work Pane", async () => {
    const user = userEvent.setup();
    renderInFrench(<HomePage />);

    await user.click(within(conversation()).getByRole("button", { name: "Comment marche cette page ?" }));

    expect(within(workPane()).getByRole("heading", { level: 2, name: "Accueil" })).toBe(document.activeElement);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(within(conversation()).getByRole("button", { name: "Comment marche cette page ?" }));
  });

  it("opens « Signaler un problème », under the box, in the Work Pane", async () => {
    const user = userEvent.setup();
    renderInFrench(<HomePage />);

    await user.click(within(conversation()).getByRole("button", { name: "Signaler un problème" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(workPane()).getByRole("heading", { level: 2, name: "Envoyer un signalement" })).toBe(document.activeElement);
    expect(within(workPane()).getByRole("radio", { name: "Bug" }).getAttribute("aria-checked")).toBe("true");
  });

  it("starts with a question about the Help Article its address names (« Demander au coach » from Mon compte), and drops it from the address", async () => {
    window.history.replaceState(null, "", "/?aide=page-account");
    const user = userEvent.setup();
    renderInFrench(<HomePage />);

    await waitFor(() => expect((box() as HTMLTextAreaElement).value).toBe("À propos de « Mon compte » : "));
    expect(document.activeElement).toBe(box());
    expect(window.location.search).toBe("");
    await user.type(box(), "où changer la langue ?{Enter}");
    await waitFor(() => expect(coach.sent).toHaveLength(1));
    expect(coach.sent[0]).toMatchObject({ helpArticle: { id: "page-account", title: "Mon compte" } });
  });
});

describe("a HelpTerm under « Conversation au centre » (#602)", () => {
  it("opens its Help Article in the Work Pane, never in the Coach Panel", async () => {
    const user = userEvent.setup();
    // As the app nests them: the Coach Panel around every page, the Work Pane in the page's layout.
    renderInFrench(
      <CoachPanel>
        <ConversationFirstProvider conversations={[]}>
          <WorkPaneProvider version="1.2.3">
            <main>
              <p>
                Votre première <HelpTerm term="followUp">Relance</HelpTerm>
              </p>
            </main>
            <WorkPane />
          </WorkPaneProvider>
        </ConversationFirstProvider>
      </CoachPanel>,
    );

    await user.click(screen.getByRole("button", { name: /^Relance/ }));

    expect(screen.getAllByRole("complementary").map((pane) => pane.getAttribute("class"))).toEqual(["work-pane"]);
    expect(within(workPane()).getByRole("heading", { level: 2, name: "Relance" })).toBe(document.activeElement);
  });
});

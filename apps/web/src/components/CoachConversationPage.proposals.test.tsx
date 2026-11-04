// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachProposalCard as Card } from "@/coach-proposals/card";
import { renderInFrench } from "@/design/testing";
import { CoachConversationPage } from "./CoachConversationPage";
import { ConversationFirstProvider } from "./conversation-first";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

vi.mock("next/navigation", () => ({ usePathname: () => "/candidatures/a1", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const CONVERSATION = {
  id: "55555555-5555-4555-8555-555555555555",
  title: "DAF H/F · Acme",
  subject: { kind: "application", id: "a1", name: "DAF H/F · Acme" },
  profile: null,
  lastMessageAt: "2026-11-04T17:00:00.000Z",
};

const proposal = (id: string, what: string): Card => ({
  id,
  status: "pending",
  change: {
    target: { kind: "application", id: "a1", name: "DAF H/F · Acme", href: "/candidatures/a1" },
    what,
    before: "Postulée",
    after: "Entretien",
    value: { status: "interview" },
    fields: [{ name: "status", label: what, type: "select", options: [{ value: "applied", label: "Postulée" }, { value: "interview", label: "Entretien" }] }],
  },
  undoable: false,
});

const FIRST = proposal("11111111-1111-4111-8111-111111111111", "Statut de la candidature");
const SECOND = proposal("22222222-2222-4222-8222-222222222222", "Prochaine étape");

/** The reply the server gives once `release` is called: the Candidate can type meanwhile. */
let release: () => void;

function replyingWith(proposalsDisplay: "card" | "form" | undefined) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/coach" && init?.method === "POST") {
      await new Promise<void>((done) => (release = done));
      return Response.json({
        conversation: CONVERSATION,
        reply: "Je vous propose de passer la candidature en entretien.",
        blocked: { message: false, reply: false },
        couldNotAnswer: false,
        cards: [FIRST, SECOND],
        ...(proposalsDisplay ? { proposalsDisplay } : {}),
      });
    }
    return new Response(null, { status: 404 });
  });
}

/** The screen is wide (a computer) or not (a phone, where the Work Pane covers the conversation). */
function screenWide(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes(">=") ? wide : false, addEventListener() {}, removeEventListener() {} }));
}

function ApplicationPage() {
  return (
    <ConversationFirstProvider conversations={[]}>
      <WorkPaneProvider version="1.2.3">
        <main id="main">
          <CoachConversationPage conversationId={null} subject={{ kind: "application", id: "a1" }} />
        </main>
        <WorkPane />
      </WorkPaneProvider>
    </ConversationFirstProvider>
  );
}

const box = () => screen.getByRole("textbox", { name: "Votre message" });

async function ask(user: ReturnType<typeof userEvent.setup>, { typedMeanwhile = "" } = {}) {
  await user.type(box(), "Où en est ma candidature ?{Enter}");
  await waitFor(() => expect(release).toBeTypeOf("function"));
  if (typedMeanwhile) await user.type(box(), typedMeanwhile);
  release();
  await screen.findByText("Je vous propose de passer la candidature en entretien.");
}

describe("a reply's Coach proposals under « Propositions du coach » (#717, ADR-0077)", () => {
  beforeEach(() => {
    release = undefined as never;
    screenWide(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("« Formulaire »: the Work Pane opens by itself on the first proposal's form, pre-filled; both cards keep their buttons", async () => {
    vi.stubGlobal("fetch", replyingWith("form"));
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    await ask(user);

    const pane = await screen.findByRole("complementary");
    expect(within(pane).getByRole("heading", { level: 2 }).textContent).toContain("Modifier avant d'appliquer : Statut de la candidature");
    expect((within(pane).getByRole("combobox", { name: "Statut de la candidature" }) as HTMLSelectElement).value).toBe("interview");
    for (const card of screen.getAllByRole("article")) {
      expect(within(card).getAllByRole("button").map((each) => each.textContent)).toEqual(["Appliquer", "Modifier avant d'appliquer", "Ignorer"]);
    }
  });

  it("« Carte », or a server that says nothing: only the cards show, the Work Pane stays closed", async () => {
    for (const display of ["card", undefined] as const) {
      vi.stubGlobal("fetch", replyingWith(display));
      const user = userEvent.setup();
      const { unmount } = renderInFrench(<ApplicationPage />);

      await ask(user);

      expect(screen.getAllByRole("article")).toHaveLength(2);
      expect(screen.queryByRole("complementary")).toBeNull();
      unmount();
    }
  });

  it("never opens on a phone while the Candidate types; on a phone with the box empty, it opens", async () => {
    screenWide(false);
    vi.stubGlobal("fetch", replyingWith("form"));
    const user = userEvent.setup();
    const { unmount } = renderInFrench(<ApplicationPage />);

    await ask(user, { typedMeanwhile: "Et pour la rel" });

    expect(screen.queryByRole("complementary")).toBeNull();
    expect((box() as HTMLTextAreaElement).value).toBe("Et pour la rel");
    unmount();

    vi.stubGlobal("fetch", replyingWith("form"));
    renderInFrench(<ApplicationPage />);
    await ask(user);
    expect(await screen.findByRole("complementary")).toBeTruthy();
  });
});

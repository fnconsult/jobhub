// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationContext } from "@/coach/conversation";
import { renderInFrench } from "@/design/testing";
import { CoachConversationPage } from "./CoachConversationPage";
import { ContextBar } from "./ContextBar";
import { ConversationFirstProvider } from "./conversation-first";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

const CONVERSATION = { id: "33333333-3333-4333-8333-333333333333", title: "Préparer mon pitch", subject: null, profile: null, lastMessageAt: "2026-10-31T10:00:00.000Z" };

/** The server, as /api/coach and /api/coach/conversations say a conversation's Context bar's figures (#607). */
function server({ saved, replied }: { saved: ConversationContext; replied: ConversationContext }) {
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

  it("is empty before the coach's first reply: « Le coach n'a pas encore répondu », no figures (#810)", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    renderInFrench(<HomePage conversationId={null} />);

    expect(within(bar()).getByText("Le coach n'a pas encore répondu.")).toBeTruthy();
    expect(within(bar()).queryByText(/messages ·/)).toBeNull();
    const meter = within(bar()).getByRole("meter", { name: "Contexte de la conversation" });
    expect(meter.getAttribute("aria-valuenow")).toBe("0");
    expect(meter.getAttribute("aria-valuetext")).toBe("Le coach n'a pas encore répondu.");
  });

  it("is there, empty, while a Profile is being created on `/profils/nouveau`, which has no conversation yet (#810)", () => {
    pathname.current = "/profils/nouveau";
    try {
      renderInFrench(
        <ConversationFirstProvider conversations={[]}>
          <aside aria-label="Activité">
            <ContextBar />
          </aside>
        </ConversationFirstProvider>,
      );
      expect(within(bar()).getByText("Le coach n'a pas encore répondu.")).toBeTruthy();
      expect(within(bar()).queryByRole("button", { name: "Effacer la conversation" })).toBeNull();
    } finally {
      pathname.current = "/";
    }
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
    expect(await within(bar()).findByText("Le coach n'a pas encore répondu.")).toBeTruthy();
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

describe("the Context bar's Plan, upsell and breakdown (ADR-0078, #732)", () => {
  beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  afterEach(() => vi.unstubAllGlobals());

  const SMALL = { coachContextMessages: 20, coachContextTokens: 6_000 };
  const PREMIUM = { plan: "premium", name: { fr: "Premium", en: "Premium" } };
  const SPLIT = { messages: 1_200, instructions: 1_500, profile: 800, advice: 300, sources: 200 };

  it("counts out of the Candidate's Plan's limits, as the server says them", async () => {
    vi.stubGlobal("fetch", server({ saved: { messages: 6, tokens: 3_000, limits: SMALL }, replied: { messages: 8, tokens: 3_200, limits: SMALL } }));
    renderInFrench(<HomePage />);

    expect(await within(activity()).findByText("6 / 20 messages · 3k / 6k jetons")).toBeTruthy();
  });

  it("from 80 %, names the Plan above that allows more, linking to its card on Mon abonnement", async () => {
    vi.stubGlobal("fetch", server({ saved: { messages: 17, tokens: 3_000, limits: SMALL, upgrade: PREMIUM }, replied: { messages: 19, tokens: 3_200, limits: SMALL, upgrade: PREMIUM } }));
    renderInFrench(<HomePage />);
    await within(activity()).findByText("17 / 20 messages · 3k / 6k jetons");

    expect(within(bar()).getByText(/L'offre Premium lui en fait lire davantage\./)).toBeTruthy();
    expect(within(bar()).getByRole("link", { name: "Découvrir l'offre Premium" }).getAttribute("href")).toBe("/abonnement#plan-premium-title");
  });

  it("offers no upgrade below 80 %, nor when no Plan above allows more", async () => {
    vi.stubGlobal("fetch", server({ saved: { messages: 17, tokens: 3_000, limits: SMALL, upgrade: null }, replied: { messages: 4, tokens: 3_200, limits: SMALL, upgrade: PREMIUM } }));
    const user = userEvent.setup();
    renderInFrench(<HomePage />);
    await within(activity()).findByText("17 / 20 messages · 3k / 6k jetons");
    expect(within(bar()).getByRole("button", { name: "Effacer la conversation" })).toBeTruthy();
    expect(within(bar()).queryByRole("link", { name: /Découvrir/ })).toBeNull();

    await user.type(screen.getByRole("textbox", { name: "Votre message" }), "Et ensuite ?{Enter}");
    await within(activity()).findByText("4 / 20 messages · 3,2k / 6k jetons");
    expect(within(bar()).queryByRole("link", { name: /Découvrir/ })).toBeNull();
  });

  it("opens onto the breakdown: each category and the room left, in jetons and %, out of the Plan's ceiling", async () => {
    const context = { messages: 6, tokens: 4_000, limits: { coachContextMessages: 40, coachContextTokens: 10_000 }, split: SPLIT };
    vi.stubGlobal("fetch", server({ saved: context, replied: context }));
    const user = userEvent.setup();
    renderInFrench(<HomePage />);
    await within(activity()).findByText("6 / 40 messages · 4k / 10k jetons");

    await user.click(within(bar()).getByRole("button", { name: "Voir le détail" }));
    const card = screen.getByRole("dialog", { name: "Détail du contexte" });
    expect(within(card).getByText("4k / 10k jetons")).toBeTruthy();
    expect(within(card).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Messages1,2k jetons · 12 %",
      "Instructions du coach1,5k jetons · 15 %",
      "Profil et CV800 jetons · 8 %",
      "Conseils des agents300 jetons · 3 %",
      "Sources200 jetons · 2 %",
      "Espace libre6k jetons · 60 %",
    ]);
  });

  it("says what the whole reply sent, all its calls summed, apart from the context and never as the bar's figure (#790)", async () => {
    const reply = { calls: 6, turns: 3, rounds: 2, inputTokens: 56_700, cachedInputTokens: 30_000, outputTokens: 1_200 };
    const context = { messages: 2, tokens: 4_000, limits: { coachContextMessages: 40, coachContextTokens: 12_000 }, split: SPLIT, reply };
    vi.stubGlobal("fetch", server({ saved: context, replied: context }));
    const user = userEvent.setup();
    renderInFrench(<HomePage />);
    // The bar keeps its meaning: the context, out of the Plan's ceiling.
    await within(activity()).findByText("2 / 40 messages · 4k / 12k jetons");
    expect(within(bar()).queryByText(/56,7k/)).toBeNull();

    await user.click(within(bar()).getByRole("button", { name: "Voir le détail" }));
    const card = screen.getByRole("dialog", { name: "Détail du contexte" });
    expect(within(card).getByText(/Ce n'est pas le coût de la réponse/)).toBeTruthy();
    const section = within(card).getByRole("region", { name: "Cette réponse" });
    expect(within(section).getByText("Cette réponse : 6 appels, 56,7k jetons envoyés au total")).toBeTruthy();
    expect(within(section).getByText("Le coach a consulté vos données en 2 tours avant de répondre.")).toBeTruthy();
    expect(within(section).getByText("Dont 30k relus dans le cache du fournisseur, moins coûteux.")).toBeTruthy();
    expect(within(section).getByText(/peut dépasser la taille du contexte ci-dessus/)).toBeTruthy();
    // Never the Tools' internal names.
    expect(within(section).queryByText(/lire_profil/)).toBeNull();
  });

  it("says nothing of the whole reply for a reply saved before it was kept", async () => {
    const context = { messages: 2, tokens: 4_000, limits: { coachContextMessages: 40, coachContextTokens: 12_000 }, split: SPLIT, reply: null };
    vi.stubGlobal("fetch", server({ saved: context, replied: context }));
    const user = userEvent.setup();
    renderInFrench(<HomePage />);
    await within(activity()).findByText("2 / 40 messages · 4k / 12k jetons");

    await user.click(within(bar()).getByRole("button", { name: "Voir le détail" }));
    expect(within(screen.getByRole("dialog", { name: "Détail du contexte" })).queryByRole("region", { name: "Cette réponse" })).toBeNull();
  });

  it("is empty before the coach's first reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const user = userEvent.setup();
    renderInFrench(<HomePage conversationId={null} />);

    await user.click(within(bar()).getByRole("button", { name: "Voir le détail" }));
    const card = screen.getByRole("dialog", { name: "Détail du contexte" });
    expect(within(card).getByText("Le détail s'affiche après la première réponse du coach.")).toBeTruthy();
    expect(within(card).queryByRole("listitem")).toBeNull();
  });
});

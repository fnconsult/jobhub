// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provenance } from "@jobhub/shared";
import { activityEntries, type ServedEntry } from "@/ai-activity/entries";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AiActivityLiveProvider, useAiActivityLive } from "./AiActivityLive";
import {
  useConversationFirst,
  type PageConversation,
} from "./conversation-first";
import { SidebarLayout } from "./SidebarLayout";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

/** The page's conversation, registered as CoachConversationPage does, with its Context bar's figures. */
function Conversation({ context }: { context: PageConversation["context"] }) {
  const register = useConversationFirst()?.setPage;
  useEffect(() => {
    register?.({
      conversationId: "c1",
      replying: false,
      context,
      replies: [],
      clear: async () => true,
      startNew: null,
      askAbout: () => {},
    });
    return () => register?.(null);
  }, [register, context]);
  return <p>La conversation</p>;
}

function Page({
  fiche = null,
  aiActivity = [],
}: {
  fiche?: Parameters<typeof SidebarLayout>[0]["fiche"];
  aiActivity?: readonly ServedEntry[];
}) {
  return (
    <SidebarLayout
      profiles={[]}
      canAddProfile={false}
      title="Accueil"
      version="1.2.3"
      freeConversations={[]}
      fiche={fiche}
      aiActivity={aiActivity}
    >
      <Conversation context={{ messages: 12, tokens: 3_100 }} />
    </SidebarLayout>
  );
}

const topBar = () => screen.getByRole("banner");

/** Hands AI Activity's live actions to the test, as the pages feed them (#333). */
function Grab({
  onLive,
}: {
  onLive: (live: ReturnType<typeof useAiActivityLive>) => void;
}) {
  const live = useAiActivityLive();
  useEffect(() => {
    onLive(live);
  }, [live, onLive]);
  return null;
}

/** The Context bar, « En ce moment » and the page's AI Activity, in the order they come in `column`. */
function inOrder(column: HTMLElement): string[] {
  const parts = {
    context: within(column).getByRole("group", {
      name: "Contexte de la conversation",
    }),
    now: within(column).getByRole("region", { name: "En ce moment" }),
    history: within(column).getByText("Rien encore sur cette page."),
  };
  return Object.entries(parts)
    .sort(([, a], [, b]) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .map(([name]) => name);
}
/** AI Activity's button (#809, ADR-0086): « Activité » in the Top Bar, named « Activité IA » and its words. */
const activityButton = () =>
  within(topBar()).getByRole("button", { name: /^Activité IA/ });

/** An AI Coach reply the server read, written by Mistral Large: the page's summary is « 1 modèle · 6,9k tokens ». */
const written: Provenance = {
  v: 1,
  steps: [
    {
      kind: "ai",
      activity: "think_write",
      task: "coaching",
      provider: "mistral",
      endpoint: "api.eu.mistral.ai",
      model: "mistral-large-latest",
      tokens: { input: 6_000, output: 900 },
      ms: 9_000,
      at: "2026-11-07T09:00:00.000Z",
      outcome: "ok",
      count: 1,
    },
  ],
  sites: [],
  startedAt: "2026-11-07T09:00:00.000Z",
  wallMs: 9_000,
};
const REPLIED = activityEntries({
  page: "any",
  replies: [
    {
      messageId: "m1",
      at: written.startedAt,
      question: "Et ce CV ?",
      provenance: written,
      sent: null,
      cards: [],
    },
  ],
});

describe("« Activité » on the home page and the menus (#607, ADR-0070)", () => {
  beforeEach(() => {
    pathname.current = "/";
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is AI Activity's button in the Top Bar, « Activité » on its frame and named « Activité IA », the column closed (#809)", () => {
    renderInFrench(<Page />);

    expect(
      within(topBar()).getAllByRole("button", { name: /Activité/ }),
    ).toEqual([activityButton()]);
    expect(activityButton().getAttribute("aria-expanded")).toBe("false");
    expect(activityButton().getAttribute("title")).toBe("Activité IA");
    // A page with no AI yet: no words, its name « Activité IA » alone.
    expect(within(topBar()).getByRole("button", { name: "Activité IA" })).toBe(
      activityButton(),
    );
    expect(activityButton().textContent).toBe("Activité");
    expect(
      within(topBar()).queryByRole("button", { name: "Fiche" }),
    ).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Activité" }),
    ).toBeNull();
  });

  it("keeps its words, the page's summary, left of its frame and in its name (#369, #809)", () => {
    renderInFrench(<Page aiActivity={REPLIED} />);

    expect(within(topBar()).getByText("1 modèle · 6,9k tokens")).toBeTruthy();
    expect(
      within(topBar()).getByRole("button", {
        name: "Activité IA 1 modèle · 6,9k tokens",
      }),
    ).toBe(activityButton());
  });

  it("opens Activity when its words are clicked, the focus on the button (#809)", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page aiActivity={REPLIED} />);

    await user.click(within(topBar()).getByText("1 modèle · 6,9k tokens"));

    expect(
      screen.getByRole("complementary", { name: "Activité" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(activityButton());
  });

  it("closes Activity with Escape, the focus staying on the button (#809)", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    await user.click(activityButton());

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("complementary", { name: "Activité" }),
    ).toBeNull();
    expect(activityButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(activityButton());
  });

  it("while a Coach reply runs on the page, has its step left of the frame, then its stop icon, both in « En ce moment » once Activity shows (#369, #809)", async () => {
    // As the other queries, but under reduced motion: the live glyph holds still (jsdom draws no path to animate).
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query !== "(prefers-reduced-motion: no-preference)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const user = userEvent.setup();
    const stopped = vi.fn();
    let live: ReturnType<typeof useAiActivityLive> = null;
    renderInFrench(
      <AiActivityLiveProvider>
        <Grab onLive={(given) => (live = given)} />
        <Page aiActivity={REPLIED} />
      </AiActivityLiveProvider>,
    );
    act(() => {
      live!.requestAction("coach_reply", "/", stopped);
    });

    // The step replaces the page's summary, in the words and the button's name.
    expect(within(topBar()).queryByText("1 modèle · 6,9k tokens")).toBeNull();
    expect(
      within(topBar()).getByRole("button", { name: "Activité IA Démarrage" }),
    ).toBe(activityButton());
    // Its stop icon sits between the words and the frame: a button of its own, named by what it stops.
    const stop = within(topBar()).getByRole("button", {
      name: "Arrêter la réponse du coach",
    });
    expect(stop.getAttribute("title")).toBe("Arrêter la réponse du coach");
    const words = within(topBar()).getByText("Démarrage");
    expect(
      words.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      stop.compareDocumentPosition(activityButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(stop);
    expect(stopped).toHaveBeenCalledOnce();
    expect(
      within(topBar())
        .getByRole("button", { name: "Arrêter la réponse du coach" })
        .hasAttribute("disabled"),
    ).toBe(true);

    // Shown, Activity says it all: the Top Bar has neither the step nor the stop icon, its name « Activité IA » alone.
    await user.click(activityButton());
    expect(
      within(topBar()).queryByRole("button", { name: /^Arrêter/ }),
    ).toBeNull();
    expect(within(topBar()).getByRole("button", { name: "Activité IA" })).toBe(
      activityButton(),
    );
  });

  it("speaks English to an English-speaking Candidate: « Activity » on its frame, named « AI activity » and its words (#809)", () => {
    render(
      <I18nProvider locale="en">
        <Page aiActivity={REPLIED} />
      </I18nProvider>,
    );

    const button = within(topBar()).getByRole("button", {
      name: "AI activity 1 model · 6.9k tokens",
    });
    expect(button.textContent).toBe("Activity");
    expect(button.getAttribute("title")).toBe("AI activity");
  });

  it("opens the Activité column beside the conversation, with the Context bar and AI Activity, and no heading nor ✕", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);

    await user.click(activityButton());

    const column = screen.getByRole("complementary", { name: "Activité" });
    expect(activityButton().getAttribute("aria-expanded")).toBe("true");
    expect(activityButton().getAttribute("aria-controls")).toBe(column.id);
    expect(screen.getByRole("main").contains(column)).toBe(false);
    expect(
      within(column).getByRole("group", {
        name: "Contexte de la conversation",
      }),
    ).toBeTruthy();
    expect(
      within(column).getByText("12 / 40 messages · 3,1k / 12k jetons"),
    ).toBeTruthy();
    expect(
      within(column).getByText("Rien encore sur cette page."),
    ).toBeTruthy();
    expect(within(column).queryByRole("heading", { level: 2 })).toBeNull();
    expect(within(column).queryByRole("button", { name: /Fermer/ })).toBeNull();
  });

  it("shows « En ce moment » under the Context bar, before the page's AI Activity (#806, ADR-0086)", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);

    await user.click(activityButton());

    const column = screen.getByRole("complementary", { name: "Activité" });
    expect(inOrder(column)).toEqual(["context", "now", "history"]);
    expect(
      within(
        within(column).getByRole("region", { name: "En ce moment" }),
      ).getByText("Rien ne tourne sur cette page."),
    ).toBeTruthy();
  });

  it("closes it again", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);

    await user.click(activityButton());
    await user.click(activityButton());

    expect(activityButton().getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("complementary", { name: "Activité" }),
    ).toBeNull();
  });
});

describe("the Context bar in an object's Fiche (#607)", () => {
  beforeEach(() => {
    pathname.current = "/candidatures/a1";
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is in its Activity group, before AI Activity", () => {
    renderInFrench(
      <Page
        fiche={{ card: <p>Ledger · Paris</p>, sections: [], results: [] }}
      />,
    );

    const fiche = screen.getByRole("complementary", { name: "Fiche" });
    const group = within(fiche).getByRole("group", {
      name: "Contexte de la conversation",
    });
    expect(
      within(group).getByText("12 / 40 messages · 3,1k / 12k jetons"),
    ).toBeTruthy();
    expect(group.closest("[data-group]")?.getAttribute("data-group")).toBe(
      "activity",
    );
  });

  it("is followed by « En ce moment », then the page's AI Activity (#806, ADR-0086)", () => {
    renderInFrench(
      <Page
        fiche={{ card: <p>Ledger · Paris</p>, sections: [], results: [] }}
      />,
    );

    const fiche = screen.getByRole("complementary", { name: "Fiche" });
    const now = within(fiche).getByRole("region", { name: "En ce moment" });
    expect(now.closest("[data-group]")?.getAttribute("data-group")).toBe(
      "activity",
    );
    expect(inOrder(fiche)).toEqual(["context", "now", "history"]);
  });
});

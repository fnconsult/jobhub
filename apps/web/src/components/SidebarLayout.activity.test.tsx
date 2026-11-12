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
    context: within(column).getByRole("region", {
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
      matches: !query.includes("<"),
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

  it("is AI Activity's icon in the Top Bar, named « Activité IA », its tooltip saying so, the panel closed (#809, #980)", () => {
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
    // An icon alone, as the side panel's other icons (#980).
    expect(activityButton().textContent).toBe("");
    expect(
      within(topBar()).queryByRole("button", { name: "Fiche" }),
    ).toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Activité" }),
    ).toBeNull();
  });

  it("says the page's summary in its name, not beside it (#369, #809, #980)", () => {
    renderInFrench(<Page aiActivity={REPLIED} />);

    expect(within(topBar()).getByText("1 modèle · 6,9k tokens").closest("[hidden]")).not.toBeNull();
    expect(
      within(topBar()).getByRole("button", {
        name: "Activité IA 1 modèle · 6,9k tokens",
      }),
    ).toBe(activityButton());
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
      matches: query !== "(prefers-reduced-motion: no-preference)" && !query.includes("<"),
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

  it("speaks English to an English-speaking Candidate: named « AI activity » and its words (#809)", () => {
    render(
      <I18nProvider locale="en">
        <Page aiActivity={REPLIED} />
      </I18nProvider>,
    );

    const button = within(topBar()).getByRole("button", {
      name: "AI activity 1 model · 6.9k tokens",
    });
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe("AI activity");
  });

  it("opens the side panel on « Activité » beside the conversation, its head naming it with « Fermer le volet », then the Context bar and AI Activity (#980)", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);

    await user.click(activityButton());

    const column = screen.getByRole("complementary", { name: "Activité" });
    expect(activityButton().getAttribute("aria-expanded")).toBe("true");
    expect(activityButton().getAttribute("aria-controls")).toBe(column.id);
    expect(screen.getByRole("main").contains(column)).toBe(false);
    expect(
      within(column).getByRole("region", {
        name: "Contexte de la conversation",
      }),
    ).toBeTruthy();
    expect(
      within(column).getByText("12 / 40 messages · 3,1k / 12k jetons"),
    ).toBeTruthy();
    expect(
      within(column).getByText("Rien encore sur cette page."),
    ).toBeTruthy();
    expect(within(column).getByRole("heading", { level: 2, name: "Activité" })).toBeTruthy();
    expect(within(column).getByRole("button", { name: "Fermer le volet" })).toBeTruthy();
    // Without an object, the panel has « Activité » alone.
    expect(within(topBar()).queryByRole("button", { name: "Fiche" })).toBeNull();
    expect(within(topBar()).queryByRole("button", { name: "Documents" })).toBeNull();
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

describe("the Context bar in an object's side panel (#607, #980)", () => {
  beforeEach(() => {
    pathname.current = "/candidatures/a1";
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: !query.includes("<"),
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

  it("heads its « Activité » view, which AI Activity's icon shows in place of the Fiche", async () => {
    const user = userEvent.setup();
    renderInFrench(
      <Page
        fiche={{ card: <p>Ledger · Paris</p>, sections: [], results: [] }}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Fiche" })).toBeTruthy();

    await user.click(activityButton());

    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    const activity = screen.getByRole("complementary", { name: "Activité" });
    const bar = within(activity).getByRole("region", {
      name: "Contexte de la conversation",
    });
    expect(
      within(bar).getByText("12 / 40 messages · 3,1k / 12k jetons"),
    ).toBeTruthy();
  });

  it("is followed by « En ce moment », then the page's AI Activity (#806, ADR-0086)", async () => {
    const user = userEvent.setup();
    renderInFrench(
      <Page
        fiche={{ card: <p>Ledger · Paris</p>, sections: [], results: [] }}
      />,
    );

    await user.click(activityButton());

    expect(inOrder(screen.getByRole("complementary", { name: "Activité" }))).toEqual(["context", "now", "history"]);
  });
});

describe("the live glyph of « Activité » in the Top Bar (#333, ADR-0034)", () => {
  /** Under reduced motion, so the glyph holds still and draws its strokes: jsdom has none to animate. `narrow`: a phone's width. */
  function stubScreen(narrow: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches:
        query === "(width < 40rem)"
          ? narrow
          : query !== "(prefers-reduced-motion: no-preference)" && !query.includes("<"),
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
  }

  beforeEach(() => {
    pathname.current = "/";
  });
  afterEach(() => vi.unstubAllGlobals());

  /** A glyph as it is drawn: its Activity, and its strokes. */
  const drawn = (glyph: Element | null | undefined) => ({
    activity: glyph?.getAttribute("data-activity"),
    live: glyph?.getAttribute("data-live"),
    strokes: [...(glyph?.querySelectorAll("path") ?? [])].map((path) => path.getAttribute("d")),
  });
  const nowGlyph = () =>
    screen.getByRole("region", { name: "En ce moment" }).querySelector(".activity-glyph");

  const at = "2026-11-09T09:00:00.000Z";
  /** A Job Search between two steps: it searched the web, and its next step has not started yet. */
  const betweenSteps = [
    {
      jobSearchId: "j1",
      profile: { id: "p1", name: "HEAD OF BU" },
      startedAt: at,
      steps: [
        {
          type: "step_ended" as const,
          id: 1,
          step: { kind: "tool" as const, activity: "web_search" as const, tool: "job-site" as const, ms: 900, at, outcome: "ok" as const, count: 4 },
        },
      ],
    },
  ];

  function renderLive() {
    let live: ReturnType<typeof useAiActivityLive> = null;
    renderInFrench(
      <AiActivityLiveProvider>
        <Grab onLive={(given) => (live = given)} />
        <Page aiActivity={REPLIED} />
      </AiActivityLiveProvider>,
    );
    return () => live!;
  }

  it("shows the step « En ce moment » shows, live, even between two steps of a Job Search", async () => {
    stubScreen(false);
    const user = userEvent.setup();
    const live = renderLive();
    act(() => live().jobSearches(betweenSteps, []));

    const button = activityButton().querySelector(".activity-glyph");
    expect(drawn(button)).toMatchObject({ activity: "web_search", live: "true" });

    await user.click(activityButton());
    expect(drawn(activityButton().querySelector(".activity-glyph"))).toEqual(drawn(nowGlyph()));
  });

  it("on a phone, shows that step in the compact Top Bar, where « Activité » takes the visible place", () => {
    stubScreen(true);
    const live = renderLive();
    act(() => live().jobSearches(betweenSteps, []));

    const compact = topBar().querySelector(".topbar-compact-actions:not(.topbar-first-paint)");
    expect(drawn(compact?.querySelector(".activity-glyph"))).toMatchObject({ activity: "web_search", live: "true" });
  });
});

// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AiActivityLiveProvider, useAiActivityLive, type RequestActionLive } from "./AiActivityLive";
import { CoachConversationPage } from "./CoachConversationPage";
import { SidebarLayout } from "./SidebarLayout";

const pathname = vi.hoisted(() => ({ current: "/candidatures/a1" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const FICHE = { card: <p>Ledger · Paris</p>, sections: [{ href: "/candidatures/a1/offre", label: "L'offre" }], results: [] };

/** An action of the page's, run from the test: a Coach reply on its way. */
const running = vi.hoisted(() => ({ action: null as RequestActionLive | null }));
function RunsAReply() {
  const live = useAiActivityLive();
  return (
    <button type="button" onClick={() => (running.action = live!.requestAction("coach_reply", pathname.current, () => {}))}>
      Lancer
    </button>
  );
}

/** An Application's page: its Fiche, « Fiche » and « Activité » in its Top Bar. */
function ApplicationPage() {
  return (
    <AiActivityLiveProvider>
      <SidebarLayout profiles={[]} canAddProfile={false} title="Responsable logistique, Ledger, Paris" version="1.2.3" freeConversations={[]} fiche={FICHE}>
        <RunsAReply />
      </SidebarLayout>
    </AiActivityLiveProvider>
  );
}

/** The home page: its conversation, « Activité » and « Effacer » in its Top Bar. */
function HomePage() {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title="Nouvelle conversation" version="1.2.3" freeConversations={[]}>
      <CoachConversationPage conversationId={null} />
    </SidebarLayout>
  );
}

const topBar = () => screen.getByRole("banner");
const more = () => within(topBar()).getByRole("button", { name: "Autres actions" });
/** Each button's name: its `aria-label`, what its `aria-labelledby` says (« Activité », #809), or its words. */
const names = (buttons: HTMLElement[]) =>
  buttons.map(
    (button) =>
      button.getAttribute("aria-label") ??
      button
        .getAttribute("aria-labelledby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ") ??
      button.textContent,
  );

async function openMore(user: ReturnType<typeof userEvent.setup>) {
  more().focus();
  await user.keyboard("{Enter}");
  return screen.findByRole("menu");
}

/** A screen `width` wide, as the media queries see it. */
function screenWidth(rem: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const [, op, limit] = /\(width (<|>=) ([\d.]+)rem\)/.exec(query) ?? [];
    return { matches: op === "<" ? rem < Number(limit) : rem >= Number(limit), media: query, addEventListener: () => {}, removeEventListener: () => {} };
  });
}

describe("the compact Top Bar on a phone (#897)", () => {
  beforeEach(() => {
    pathname.current = "/candidatures/a1";
    running.action = null;
    // 390 px.
    screenWidth(24.375);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is one line: « Menu », the title, the page's one action and « … », icons alone named by their words", () => {
    renderInFrench(<ApplicationPage />);

    expect(names(within(topBar()).getAllByRole("button"))).toEqual(["Menu", "Fiche", "Autres actions"]);
    for (const button of within(topBar()).getAllByRole("button")) {
      expect(button.textContent).toBe("");
      expect(button.getAttribute("title")).toBe(button.getAttribute("aria-label"));
    }
    expect(within(topBar()).getByRole("heading", { level: 1, name: "Responsable logistique, Ledger, Paris" })).toBeTruthy();
  });

  it("lists the other actions under « … » with their words; « Activité » opens the Fiche on its Activity, the focus back on « … » when it closes", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    const menu = await openMore(user);
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Activité"]);
    await user.click(within(menu).getByRole("menuitem", { name: "Activité" }));

    const fiche = await screen.findByRole("complementary", { name: "Fiche" });
    expect(within(fiche).getByRole("button", { name: "Activité" }).getAttribute("aria-expanded")).toBe("true");
    await user.click(within(fiche).getByRole("button", { name: "Fermer" }));

    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(more()));
  });

  it("gives the focus back to « … » when Activity, opened from its « Activité », closes with Escape (#809)", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    const menu = await openMore(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Activité" }));
    const fiche = await screen.findByRole("complementary", { name: "Fiche" });
    expect(within(fiche).getByRole("button", { name: "Activité" }).getAttribute("aria-expanded")).toBe("true");
    within(fiche).getByRole("button", { name: "Fermer" }).focus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(more()));
  });

  it("shows « Activité » on the home page, « Effacer la conversation » under « … » opening its confirming Dialog", async () => {
    pathname.current = "/";
    const user = userEvent.setup();
    renderInFrench(<HomePage />);

    // « Activité » is named and has its tooltip as AI Activity's button has them: « Activité IA », then its words (#809).
    expect(names(within(topBar()).getAllByRole("button"))).toEqual(["Menu", "Activité IA", "Autres actions"]);
    expect(within(topBar()).getByRole("button", { name: "Activité IA" }).getAttribute("title")).toBe("Activité IA");
    const menu = await openMore(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Effacer la conversation" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Effacer cette conversation ?" });
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(more()));
  });

  it("shows « Activité » while an action runs, with its stop icon and the step in its name, then gives the place back without moving the focus", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    const shown = within(topBar()).getByRole("button", { name: "Fiche" });
    shown.focus();

    await user.click(screen.getByRole("button", { name: "Lancer" }));
    shown.focus();

    expect(names(within(topBar()).getAllByRole("button"))).toEqual(["Menu", "Arrêter la réponse du coach", "Activité IA Démarrage", "Autres actions"]);
    const menu = await openMore(user);
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Fiche"]);
    await user.keyboard("{Escape}");
    shown.focus();

    act(() => running.action!.end("done"));

    expect(names(within(topBar()).getAllByRole("button"))).toEqual(["Menu", "Fiche", "Autres actions"]);
    expect(document.activeElement).toBe(shown);
  });

  it("while an action runs, « Activité » shows and hides Activity as AI Activity's button does, the focus back on it when Activity closes (#809)", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);
    await user.click(screen.getByRole("button", { name: "Lancer" }));
    const activity = within(topBar()).getByRole("button", { name: "Activité IA Démarrage" });
    expect(activity.getAttribute("aria-expanded")).toBe("false");

    await user.click(activity);

    const fiche = await screen.findByRole("complementary", { name: "Fiche" });
    expect(within(fiche).getByRole("button", { name: "Activité" }).getAttribute("aria-expanded")).toBe("true");
    expect(activity.getAttribute("aria-expanded")).toBe("true");
    expect(activity.getAttribute("aria-controls")).toBe(fiche.id);
    // Shown, Activity has the step and its stop icon (« En ce moment »): the button says « Activité IA » alone, as on a computer.
    expect(within(topBar()).getByRole("button", { name: "Activité IA" })).toBe(activity);
    expect(within(topBar()).queryByRole("button", { name: "Arrêter la réponse du coach" })).toBeNull();
    await user.click(within(fiche).getByRole("button", { name: "Fermer" }));

    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(activity));
    expect(within(topBar()).getByRole("button", { name: "Activité IA Démarrage" })).toBe(activity);
  });

  it("gives the focus to « … », where « Activité » goes back, when the action ends with the focus on its stop icon", async () => {
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    await user.click(screen.getByRole("button", { name: "Lancer" }));
    within(topBar()).getByRole("button", { name: "Arrêter la réponse du coach" }).focus();

    act(() => running.action!.end("done"));

    expect(within(topBar()).queryByRole("button", { name: "Arrêter la réponse du coach" })).toBeNull();
    expect(document.activeElement).toBe(more());
  });
});

describe("the Top Bar on a computer (#897)", () => {
  beforeEach(() => {
    pathname.current = "/candidatures/a1";
    screenWidth(80);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is as before: its buttons with their words, no « … »", () => {
    renderInFrench(<ApplicationPage />);

    expect(within(topBar()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Menu", "Fiche", "Activité"]);
    expect(within(topBar()).queryByRole("button", { name: "Autres actions" })).toBeNull();
  });
});

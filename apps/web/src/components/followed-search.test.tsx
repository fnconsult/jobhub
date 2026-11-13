// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchCriteria } from "@jobhub/shared";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { draftFromQuestionnaire, startQuestionnaire } from "@/questionnaire";
import { AiActivityContent, AiActivityProvider } from "./AiActivity";
import { AiActivityLiveProvider, useAiActivityLive } from "./AiActivityLive";
import { ActivityColumnControl, type ActivityColumn } from "./activity-column";
import { useFollowedSearch } from "./followed-search";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/profils/nouveau", useRouter: () => ({ push, refresh: vi.fn() }) }));

type Live = NonNullable<ReturnType<typeof useAiActivityLive>>;
const id = "3f1c2a4e-0000-4000-8000-000000000001";
const cv = { ...draftFromQuestionnaire(startQuestionnaire()).masterCv, fullName: "Marie Dupont", headline: "Directrice financière", location: "Lyon" };
const criteria = (more: Partial<SearchCriteria> = {}): SearchCriteria => ({
  targetRole: "Directrice financière",
  locations: ["Lyon"],
  contractTypes: [],
  remoteWorkOptions: [],
  sectors: [],
  subsectors: [],
  domains: [],
  ...more,
});
const measured = (offersAnalysed: number) => ({ step: "search" as const, sources: [], pagesRead: 5, offersAnalysed, matched: null });
const running = (offersAnalysed: number) => [{ jobSearchId: id, profile: { id: "p1", name: "Directrice financière" }, startedAt: new Date().toISOString(), steps: [], live: measured(offersAnalysed) }];

/** The page that follows the search, its criteria given; and AI Activity, its history included. */
function Page({ given, onLive }: { given: SearchCriteria; onLive: (live: Live) => void }) {
  useFollowedSearch({ jobSearchId: id, profileId: "p1", href: "/profils/nouveau", criteria: given, cv });
  const live = useAiActivityLive();
  useEffect(() => {
    if (live) onLive(live);
  }, [live, onLive]);
  return (
    <aside aria-label="Activité">
      <AiActivityContent />
    </aside>
  );
}

function show() {
  let live: Live | null = null;
  const onLive = (given: Live) => (live = given);
  const tree = (given: SearchCriteria) => (
    <AiActivityLiveProvider>
      <AiActivityProvider>
        <Page given={given} onLive={onLive} />
      </AiActivityProvider>
    </AiActivityLiveProvider>
  );
  const view = renderInFrench(tree(criteria()));
  return { live: () => live!, rerender: (given: SearchCriteria) => view.rerender(<I18nProvider locale="fr">{tree(given)}</I18nProvider>) };
}

describe("the onboarding's page follows its offered Job Search (#1001)", () => {
  let asked: string[];

  beforeEach(() => {
    asked = [];
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      const done = !url.includes("known=") && asked.length > 2;
      return Response.json({
        id,
        status: done ? "done" : "searching",
        failure: null,
        live: { ...measured(3), jobOfferIds: ["o1", "o2", "o3"] },
        jobOffers: [
          { id: "o1", title: "DAF", employer: "Acme", content: "Directrice financière à Lyon.", location: "Lyon", contractType: "cdi" },
          { id: "o2", title: "DAF adjointe", content: "Directrice financière à Lyon.", location: "Lyon", contractType: "cdd" },
          { id: "o3", title: "RAF", content: "Directrice financière à Lyon.", location: "Lyon", contractType: "cdi" },
        ].filter((offer) => !url.includes(offer.id)),
      });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the Job Offers once the run analysed some, and counts again those matching when a criterion is added, without asking again", async () => {
    const page = show();
    expect(page.live().followed).toMatchObject({ jobSearchId: id, href: "/profils/nouveau", matching: 0 });
    expect(asked).toEqual([]);

    act(() => page.live().jobSearches(running(3), []));
    await waitFor(() => expect(page.live().followed?.matching).toBe(3));
    expect(asked).toEqual([`/api/job-searches/${id}/live`]);
    expect(page.live().followed?.refining.map((item) => item.text)).toEqual(["Directrice financière", "Lyon"]);

    page.rerender(criteria({ contractTypes: ["cdi"] }));
    await waitFor(() => expect(page.live().followed?.refining.map((item) => item.text)).toEqual(["Directrice financière", "Lyon", "CDI"]));
    const scoredWithCdi = page.live().followed!.best.find((offer) => offer.title === "DAF adjointe")!.score;
    expect(scoredWithCdi).toBeLessThan(page.live().followed!.best.find((offer) => offer.title === "DAF")!.score);
    expect(asked).toHaveLength(1);

    // Criteria without a target role (a questionnaire started over): counted as before.
    const before = page.live().followed;
    page.rerender(criteria({ targetRole: "", locations: [] }));
    expect(page.live().followed).toEqual(before);
  });

  it("once over, keeps an entry in the page's history with its best Job Offers and « Voir toutes les offres », even once the poll lets it go", async () => {
    const user = userEvent.setup();
    const page = show();
    act(() => page.live().jobSearches(running(3), []));
    await waitFor(() => expect(page.live().followed?.best).toHaveLength(3));
    act(() => page.live().jobSearches([], [{ jobSearchId: id, outcome: { status: "done", at: new Date().toISOString(), found: 3, steps: [] } }]));
    await waitFor(() => expect(asked).toHaveLength(2));
    // Its notification dismissed: the poll no longer brings it.
    act(() => page.live().jobSearches([], []));

    const activity = screen.getByRole("complementary", { name: "Activité" });
    const row = await within(activity).findByRole("button", { name: /Recherche d'offres · Directrice financière/ });
    expect(row.textContent).toMatch(/Offerte, hors forfait/);
    await user.click(row);
    const detail = document.getElementById(row.getAttribute("aria-controls")!)!;
    const offers = within(detail).getAllByRole("listitem");
    expect(offers).toHaveLength(3);
    expect(offers[0]!.textContent).toMatch(/· Acme · Match Score \d+\/100$/);
    expect(within(offers[0]!).getByRole("link").getAttribute("href")).toBe(`/recherches/${id}/offres/o1`);
    expect(within(detail).getByRole("link", { name: "Voir toutes les offres" }).getAttribute("href")).toBe(`/recherches/${id}`);
    expect(detail.textContent).not.toMatch(/consommation/);
  });

  /** Its history entry, once it ended and the poll let it go, unfolded. */
  async function endedEntry(user: ReturnType<typeof userEvent.setup>) {
    const activity = screen.getByRole("complementary", { name: "Activité" });
    const row = await within(activity).findByRole("button", { name: /Recherche d'offres · Directrice financière/ });
    await user.click(row);
    return document.getElementById(row.getAttribute("aria-controls")!)!;
  }

  it("ended with no Job Offer that matches (#1006): says so, with « Voir mon profil » and « Relancer une recherche », counted in the Plan Quota", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      asked.push(`${init.method ?? "GET"} ${url}`);
      if (url === "/api/job-searches") return Response.json({ id: "s2" }, { status: 201 });
      return Response.json({ id, status: "done", failure: null, live: { ...measured(0), jobOfferIds: [] }, jobOffers: [] });
    });
    const user = userEvent.setup();
    const page = show();
    act(() => page.live().jobSearches(running(0), []));
    act(() => page.live().jobSearches([], [{ jobSearchId: id, outcome: { status: "done", at: new Date().toISOString(), found: 0, steps: [] } }]));

    const detail = await endedEntry(user);
    expect(detail.textContent).toMatch(/Aucune offre trouvée ne correspond à vos critères pour l'instant/);
    expect(within(detail).queryByText("Vos meilleures offres :")).toBeNull();
    expect(within(detail).getByRole("link", { name: "Voir mon profil" }).getAttribute("href")).toBe("/profils/p1");
    // Unlike the offered one, a new search counts in the Plan Quota, and says so before its button.
    expect(detail.textContent).toMatch(/Contrairement à la première, une nouvelle recherche compte dans les recherches d'offres de votre forfait/);
    await user.click(within(detail).getByRole("button", { name: "Relancer une recherche" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/recherches/s2"));
    expect(asked).toContain("POST /api/job-searches");
  });

  it("ended with Job Offers that match: no « Relancer une recherche », its best Job Offers instead", async () => {
    const user = userEvent.setup();
    const page = show();
    act(() => page.live().jobSearches(running(3), []));
    await waitFor(() => expect(page.live().followed?.best).toHaveLength(3));
    act(() => page.live().jobSearches([], [{ jobSearchId: id, outcome: { status: "done", at: new Date().toISOString(), found: 3, steps: [] } }]));
    await waitFor(() => expect(page.live().followed?.settled).toBe(true));
    const detail = await endedEntry(user);
    expect(within(detail).getByText("Vos meilleures offres :")).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "Relancer une recherche" })).toBeNull();
  });

  it("failed: says it failed and why, with no « Relancer une recherche » offered as if it found nothing", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ id, status: "failed", failure: "timeout", live: { ...measured(0), jobOfferIds: [] }, jobOffers: [] }));
    const user = userEvent.setup();
    const page = show();
    act(() => page.live().jobSearches(running(0), []));
    act(() => page.live().jobSearches([], [{ jobSearchId: id, outcome: { status: "failed", at: new Date().toISOString(), found: 0, failure: "timeout", step: null } }]));
    const activity = screen.getByRole("complementary", { name: "Activité" });
    const row = await within(activity).findByRole("button", { name: /Recherche d'offres · Directrice financière/ });
    expect(row.textContent).toMatch(/Échec à \d{2}:\d{2}/);
    const detail = await endedEntry(user);
    expect(within(detail).queryByRole("button", { name: "Relancer une recherche" })).toBeNull();
  });

  it.each([
    [true, 1],
    [false, 0],
  ])("opens the side panel on Activité as the search starts on a wide screen (%s), never on a phone (ADR-0106)", (wide, opened) => {
    const open = vi.fn();
    const column: ActivityColumn = { shown: false, toggle: vi.fn(), controls: undefined, open, closeOverConversation: vi.fn(), wide };
    const view = renderInFrench(
      <AiActivityLiveProvider>
        <ActivityColumnControl.Provider value={column}>
          <Page given={criteria()} onLive={() => {}} />
        </ActivityColumnControl.Provider>
      </AiActivityLiveProvider>,
    );
    expect(open).toHaveBeenCalledTimes(opened);
    // Its criteria change: not opened again.
    view.rerender(
      <I18nProvider locale="fr">
        <AiActivityLiveProvider>
          <ActivityColumnControl.Provider value={{ ...column }}>
            <Page given={criteria({ contractTypes: ["cdi"] })} onLive={() => {}} />
          </ActivityColumnControl.Provider>
        </AiActivityLiveProvider>
      </I18nProvider>,
    );
    expect(open).toHaveBeenCalledTimes(opened);
  });
});

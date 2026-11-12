// @vitest-environment jsdom
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AiActivityLiveProvider, useAiActivityLive, type RequestActionLive } from "./AiActivityLive";
import { EnCeMoment } from "./EnCeMoment";

let pathname = "/recherches/s1";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

type Live = NonNullable<ReturnType<typeof useAiActivityLive>>;

function Grab({ onLive }: { onLive: (live: Live) => void }) {
  const live = useAiActivityLive();
  useEffect(() => {
    if (live) onLive(live);
  }, [live, onLive]);
  return null;
}

/** « En ce moment » under AI Activity's live actions, and those actions' API, as the pages feed them. */
function show(): () => Live {
  let live: Live | null = null;
  renderInFrench(
    <AiActivityLiveProvider>
      <Grab onLive={(given) => (live = given)} />
      <EnCeMoment />
    </AiActivityLiveProvider>,
  );
  return () => live!;
}

const at = new Date().toISOString();

/** A Coach reply asked from the page, as the page's conversation tells AI Activity. */
function askCoach(live: Live): RequestActionLive {
  let reply: RequestActionLive | null = null;
  act(() => {
    reply = live.requestAction("coach_reply", "/recherches/s1", () => {});
  });
  return reply!;
}
const block = () => screen.getByRole("region", { name: "En ce moment" });
const searching = { jobSearchId: "s1", profile: { id: "p1", name: "Contrôle de gestion" }, startedAt: at, live: null, steps: [{ type: "step_started" as const, id: 1, step: { kind: "ai" as const, activity: "web_search" as const, task: "web_search" as const, at } }] };

describe("« En ce moment » (ADR-0086, #806)", () => {
  beforeEach(() => {
    pathname = "/recherches/s1";
    // Under reduced motion: the glyph holds still.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("says « Rien ne tourne sur cette page. » with nothing running", () => {
    show();
    expect(within(block()).getByRole("heading", { name: "En ce moment" })).toBeTruthy();
    expect(within(block()).getByText("Rien ne tourne sur cette page.")).toBeTruthy();
  });

  it("shows a Job Search and a Coach reply asked meanwhile, each with its step; the Coach reply with its tool steps; the search stopped from the block", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const live = show();
    act(() => live().jobSearches([searching], []));
    const reply = askCoach(live());
    act(() => {
      reply.event({ type: "step_started", id: 1, step: { kind: "tool", activity: "act", tool: "job-site", at } });
      reply.event({ type: "step_ended", id: 1, step: { kind: "tool", activity: "act", tool: "job-site", ms: 40, at, outcome: "ok", count: 1 } });
      reply.event({ type: "step_started", id: 2, step: { kind: "ai", activity: "think_write", task: "coaching", at } });
    });

    expect(within(block()).queryByText("Rien ne tourne sur cette page.")).toBeNull();
    const [search, coach] = within(block()).getAllByRole("article");
    expect(search!.textContent).toContain("Recherche d'offres · Contrôle de gestion");
    expect(search!.textContent).toContain("Recherche web");
    expect(search!.querySelector("svg.activity-glyph")?.getAttribute("data-live")).toBe("true");
    expect(coach!.textContent).toContain("Réponse du coach");
    expect(coach!.textContent).toContain("Réflexion puis rédaction");
    expect(coach!.textContent).toContain("1 étape finie");
    // Its tool step, ticked once done, with its Tool.
    const steps = within(coach!).getByRole("list", { name: "Étapes" });
    expect(within(steps).getByRole("listitem").textContent).toBe("Consulte vos données · Sites d'emploi");

    await userEvent.click(within(search!).getByRole("button", { name: "Arrêter la recherche d'offres" }));
    expect(fetch).toHaveBeenCalledWith("/api/job-searches/s1/stop", expect.objectContaining({ method: "POST" }));
    expect(search!.textContent).toContain("Arrêt en cours…");
  });

  it("lists an action of another page under « En cours ailleurs », with a link to its page", () => {
    pathname = "/candidatures";
    const live = show();
    act(() => live().jobSearches([searching], []));

    expect(within(block()).getByText("Rien ne tourne sur cette page.")).toBeTruthy();
    const elsewhere = within(block()).getByRole("region", { name: "En cours ailleurs" });
    expect(within(elsewhere).getByRole("link", { name: "Ouvrir la recherche" }).getAttribute("href")).toBe("/recherches/s1");
  });

  it("keeps a failed action in light red with its reason; a finished one leaves", () => {
    const live = show();
    const failed = askCoach(live());
    act(() => failed.end("failed", "failureReasons.provider_unavailable"));
    const [item] = within(block()).getAllByRole("article");
    expect(item!.getAttribute("data-status")).toBe("failed");
    expect(item!.textContent).toMatch(/Échec à \d{2}:\d{2}/);
    expect(item!.textContent).toContain("Fournisseur indisponible");
    expect(within(item!).queryByRole("button")).toBeNull();

    const given = askCoach(live());
    act(() => given.end("done"));
    expect(within(block()).queryAllByRole("article")).toEqual([]);
    expect(within(block()).getByText("Rien ne tourne sur cette page.")).toBeTruthy();
  });

  it("shows the Job Search the page follows (#1001) « ici », with its steps, measures, sources and criteria; other Job Searches as before", () => {
    pathname = "/profils/nouveau";
    const live = show();
    const measured = {
      step: "search" as const,
      sources: [
        { source: "france_travail" as const, state: "searched" as const },
        { source: "fantastic_jobs" as const, state: "refused" as const },
        { source: "web_search" as const, state: "waiting" as const },
      ],
      pagesRead: 27,
      offersAnalysed: 6,
      matched: null,
    };
    const other = { ...searching, jobSearchId: "s2", profile: { id: "p2", name: "Autre profil" } };
    act(() => live().jobSearches([{ ...searching, live: measured }, other], []));
    act(() =>
      live().follow({
        jobSearchId: "s1",
        href: "/profils/nouveau",
        matching: 4,
        refining: [
          { key: "targetRole", text: "Contrôleur de gestion", assumed: false },
          { key: "locations", text: "Lyon", assumed: true },
        ],
        best: [],
      }),
    );

    const followed = within(block()).getByRole("article", { name: "Recherche d'offres · Contrôle de gestion" });
    expect(followed.closest(".ai-activity-elsewhere")).toBeNull();
    const stats = followed.querySelector(".ds-stats")!;
    expect([...stats.querySelectorAll(".ds-stat")].map((stat) => [stat.querySelector("dt")!.textContent, stat.querySelector("dd")!.textContent])).toEqual([
      ["sources consultées", "2 sur 3"],
      ["pages lues", "27"],
      ["offres analysées", "6"],
      ["offres qui vous correspondent", "4"],
    ]);
    const sources = within(followed).getByRole("list", { name: "Sources de la recherche" });
    expect([...sources.querySelectorAll(".ds-status")].map((status) => [status.getAttribute("data-tone"), status.textContent])).toEqual([
      ["success", "France Travail · consultée"],
      ["warn", "Sites carrières des employeurs · refusée"],
      ["neutral", "Recherche web · à venir"],
    ]);
    const steps = within(followed).getByRole("list", { name: "Étapes de la recherche" });
    expect(steps.querySelector("[aria-current='step']")!.textContent).toMatch(/Recherche sur France Travail/);
    // « (supposé) » in words, never by a style alone.
    expect(within(followed).getByText(/Affinée avec :/).textContent).toBe("Affinée avec : Contrôleur de gestion · Lyon (supposé)");

    // The other Job Search: elsewhere, without what the page counts.
    const elsewhere = within(block()).getByRole("article", { name: "Recherche d'offres · Autre profil" });
    expect(elsewhere.closest(".ai-activity-elsewhere")).toBeTruthy();
    expect(elsewhere.querySelector(".ds-stats, .ds-stepper")).toBeNull();
  });

  it("leaves a followed Job Search elsewhere on any other page", () => {
    pathname = "/candidatures";
    const live = show();
    act(() => live().jobSearches([searching], []));
    act(() => live().follow({ jobSearchId: "s1", href: "/profils/nouveau", matching: 0, refining: [], best: [] }));
    expect(within(block()).getByText("Rien ne tourne sur cette page.")).toBeTruthy();
    expect(block().querySelector(".ds-stats")).toBeNull();
  });
});

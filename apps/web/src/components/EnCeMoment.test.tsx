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
const searching = { jobSearchId: "s1", profile: { id: "p1", name: "Contrôle de gestion" }, startedAt: at, steps: [{ type: "step_started" as const, id: 1, step: { kind: "ai" as const, activity: "web_search" as const, task: "web_search" as const, at } }] };

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
});

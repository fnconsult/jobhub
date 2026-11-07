// @vitest-environment jsdom
import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { OfferBox } from "./OfferBox";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/recherches" }));

const TODAY = "2026-11-05";

function entry(id: string, overrides: Partial<OfferBoxEntryRead> = {}): OfferBoxEntryRead {
  return {
    id,
    jobOffer: { id: `offer-${id}`, title: `Offre ${id}`, employer: "Acme Industrie", location: "Lyon", url: null, postedAt: "2026-11-03T08:00:00.000Z", expiredAt: null, contractType: "cdi" },
    profile: { id: "p1", name: "DAF" },
    scoredWith: { id: "p1", name: "DAF" },
    matchScore: 70,
    firstArrivalAt: "2026-11-05T08:00:00.000Z",
    arrivalDay: TODAY,
    sources: [{ source: "job_search", at: "2026-11-05T08:00:00.000Z" }],
    state: "to_handle",
    applicationId: null,
    followedAt: null,
    dismissalReason: null,
    dismissedAt: null,
    laterUntil: null,
    ...overrides,
  };
}

const box = (entries: OfferBoxEntryRead[]): OfferBoxResponse => ({ today: TODAY, toHandle: entries.filter((one) => one.state === "to_handle").length, entries });

const offerBox = () => screen.getByRole("region", { name: /^Offres à traiter/ });
const day = (name: string) => within(offerBox()).getByRole("region", { name });

describe("the Offer box (« Offres à traiter », ADR-0090)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    refresh.mockReset();
  });

  it("heads with « N à traiter », « k traitées » and a progress bar, then the source chips each with its count", () => {
    renderInFrench(
      <OfferBox
        box={box([
          entry("a", { sources: [{ source: "email", at: "2026-11-05T08:00:00.000Z" }, { source: "job_search", at: "2026-11-05T09:00:00.000Z" }] }),
          entry("b"),
          entry("c", { state: "followed", applicationId: "app-c", followedAt: "2026-11-05T10:00:00.000Z" }),
        ])}
      />,
    );

    expect(within(offerBox()).getByRole("heading", { level: 2 }).textContent).toContain("Offres à traiter");
    expect(within(offerBox()).getByText("2", { selector: ".offer-box-count b" })).toBeTruthy();
    expect(within(offerBox()).getByText("1 traitée")).toBeTruthy();
    expect(within(offerBox()).getByRole("progressbar", { name: "Traitées : 1 sur 3" }).getAttribute("aria-valuenow")).toBe("1");
    const chips = within(offerBox()).getByRole("group", { name: "Filtrer par source" });
    expect(within(chips).getAllByRole("button").map((chip) => chip.textContent)).toEqual(["Toutes2", "Recherche2", "Job Digest0", "Email1", "Lien du coach0", "Extension0"]);
    expect(within(chips).getByRole("button", { name: "Toutes, 2 à traiter" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("reads « Aujourd'hui » then « Précédemment », each by Importance tier, the arrival day on earlier entries, today's suivies folded", () => {
    renderInFrench(
      <OfferBox
        box={box([
          entry("top", { matchScore: 88 }),
          entry("mid", { matchScore: 65 }),
          entry("none", { matchScore: null, profile: null }),
          entry("done", { state: "followed", applicationId: "app-done", followedAt: "2026-11-05T10:00:00.000Z" }),
          entry("old", { matchScore: 82, arrivalDay: "2026-11-03", firstArrivalAt: "2026-11-03T08:00:00.000Z" }),
        ])}
      />,
    );

    const today = day("Aujourd'hui");
    expect(within(today).getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual(["À ne pas manquer · 80 et plus", "À regarder · 60 à 79", "Peu adaptées · moins de 60 ou non calculable"]);
    expect(within(within(today).getByRole("region", { name: /À ne pas manquer/ })).getByRole("listitem").textContent).toContain("Offre top");
    expect(within(today).getByRole("listitem", { name: "Offre none" }).textContent).toContain("Non classée");
    expect(within(today).getByText("Suivies aujourd'hui (1)")).toBeTruthy();
    expect(within(today).getByRole("group").hasAttribute("open")).toBe(false);
    const earlier = day("Précédemment");
    expect(within(earlier).getByRole("listitem", { name: "Offre old" }).textContent).toContain("arrivée le 3 nov.");
    expect(within(today).getByRole("listitem", { name: "Offre top" }).textContent).not.toContain("arrivée le");
  });

  it("shows on each line the Match Score, title, employer, place, contract, source chips, posting age and Profile, with « Suivre » and « Lire l'offre »", () => {
    renderInFrench(<OfferBox box={box([entry("a", { matchScore: 88, jobOffer: { ...entry("a").jobOffer, postedAt: "2026-10-12T08:00:00.000Z" } })])} />);

    const line = within(offerBox()).getByRole("listitem", { name: "Offre a" });
    expect(line.getAttribute("data-tier")).toBe("not_to_miss");
    expect(within(line).getByText("88")).toBeTruthy();
    expect(within(line).getByLabelText("Match Score 88")).toBeTruthy();
    expect(line.textContent).toContain("Acme Industrie · Lyon · CDI");
    expect(within(line).getByText("Recherche")).toBeTruthy();
    expect(line.textContent).toContain("publiée il y a 24 j · sort dans 6 j");
    expect(line.textContent).toContain("DAF");
    expect(within(line).getByRole("button", { name: "Suivre" })).toBeTruthy();
    expect(within(line).getByRole("link", { name: "Lire l'offre" }).getAttribute("href")).toBe("/recherches?offre=offer-a");
  });

  it("« Suivre » saves the Job Offer as an Application with the entry's Profile, then the page refreshes into « Suivie »", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "app-a" }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    renderInFrench(<OfferBox box={box([entry("a", { profile: null, scoredWith: { id: "p2", name: "Contrôleuse" } })])} />);

    await userEvent.click(within(offerBox()).getByRole("button", { name: "Suivre" }));

    expect(fetch).toHaveBeenCalledWith("/api/applications", expect.objectContaining({ method: "POST", body: JSON.stringify({ jobOfferId: "offer-a", profileId: "p2" }) }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("an entry « Suivie » says so and leads to its Application", () => {
    renderInFrench(<OfferBox box={box([entry("a", { state: "followed", applicationId: "app-a", followedAt: "2026-11-05T10:00:00.000Z" })])} />);

    const line = within(offerBox()).getByRole("listitem", { name: "Offre a" });
    expect(line.textContent).toContain("Suivie");
    expect(within(line).getByRole("link", { name: "Voir la candidature" }).getAttribute("href")).toBe("/candidatures/app-a");
    expect(within(line).queryByRole("button", { name: "Suivre" })).toBeNull();
  });

  it("a source chip shows only the entries that arrived by it", async () => {
    renderInFrench(<OfferBox box={box([entry("a", { sources: [{ source: "job_digest", at: "2026-11-05T08:00:00.000Z" }] }), entry("b")])} />);

    await userEvent.click(within(offerBox()).getByRole("button", { name: "Job Digest, 1 à traiter" }));

    expect(within(offerBox()).getByRole("button", { name: "Job Digest, 1 à traiter" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(offerBox()).getAllByRole("listitem").map((line) => line.getAttribute("aria-label"))).toEqual(["Offre a"]);
  });

  it("« Écarter » opens the Dismissal reasons and « Écarter sans motif »; a reason écarte the entry, then a toast offers « Annuler » (#816)", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    renderInFrench(<OfferBox box={box([entry("a")])} />);
    const line = within(offerBox()).getByRole("listitem", { name: "Offre a" });

    await userEvent.click(within(line).getByRole("button", { name: "Écarter" }));

    const reasons = within(line).getByRole("group", { name: "Pourquoi ? (facultatif)" });
    expect(within(reasons).getAllByRole("button").map((button) => button.textContent)).toEqual(["Pas pour moi", "Salaire", "Lieu", "Contrat", "Déjà postulé ailleurs", "Écarter sans motif"]);
    expect(within(line).getByRole("button", { name: "Écarter" }).getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(within(reasons).getByRole("button", { name: "Salaire" }));

    expect(fetch).toHaveBeenCalledWith("/api/offer-box/a/dismissal", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "salary" }) }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toContain("« Offre a » écartée.");
    // The line's buttons are going: the keyboard focus is on « Annuler ».
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Annuler" })));

    refresh.mockReset();
    await userEvent.keyboard("{Enter}");
    expect(fetch).toHaveBeenLastCalledWith("/api/offer-box/a/dismissal", expect.objectContaining({ method: "DELETE" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an « Annuler » that fails tells the Candidate the offer is still écartée", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => new Response(null, { status: init?.method === "DELETE" ? 500 : 204 }));
    vi.stubGlobal("fetch", fetch);
    renderInFrench(<OfferBox box={box([entry("a")])} />);
    const line = within(offerBox()).getByRole("listitem", { name: "Offre a" });
    await userEvent.click(within(line).getByRole("button", { name: "Écarter" }));
    await userEvent.click(within(line).getByRole("button", { name: "Lieu" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    refresh.mockReset();
    await userEvent.click(screen.getByRole("button", { name: "Annuler" }));

    expect((await within(offerBox()).findByRole("alert")).textContent).toBe(
      "« Annuler » n'a pas abouti : l'offre reste écartée. Réessayez avec « Revenir sur ce choix », dans « Écartées ».",
    );
    expect(refresh).not.toHaveBeenCalled();
    // The toast gone, the focus is on the box's heading, not lost with the line's buttons.
    expect(document.activeElement).toBe(within(offerBox()).getByRole("heading", { name: "Offres à traiter" }));
  });

  it("« Écarter sans motif » écarte the entry with no reason; a refusal says so", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    renderInFrench(<OfferBox box={box([entry("a")])} />);
    const line = within(offerBox()).getByRole("listitem", { name: "Offre a" });

    await userEvent.click(within(line).getByRole("button", { name: "Écarter" }));
    await userEvent.click(within(line).getByRole("button", { name: "Écarter sans motif" }));
    expect(fetch).toHaveBeenCalledWith("/api/offer-box/a/dismissal", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: null }) }));

    fetch.mockImplementation(async () => Response.json({ error: "followed" }, { status: 409 }));
    await userEvent.click(within(line).getByRole("button", { name: "Écarter" }));
    await userEvent.click(within(line).getByRole("button", { name: "Pas pour moi" }));
    expect(within(line).getByRole("alert").textContent).toBe("L'offre n'a pas pu être écartée. Réessayez.");
  });

  it("an entry « Suivie » cannot be écartée", () => {
    renderInFrench(<OfferBox box={box([entry("a", { state: "followed", applicationId: "app-a", followedAt: "2026-11-05T10:00:00.000Z" })])} />);

    expect(within(offerBox()).queryByRole("button", { name: "Écarter" })).toBeNull();
  });

  it("folds « Écartées » at its foot: each with its reason and « Revenir sur ce choix », which makes it à traiter again", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const dismissed = { state: "dismissed" as const, dismissedAt: "2026-11-05T09:00:00.000Z" };
    renderInFrench(<OfferBox box={box([entry("a"), entry("b", { ...dismissed, dismissalReason: "location" }), entry("c", { ...dismissed, dismissalReason: null, dismissedAt: "2026-11-05T10:00:00.000Z" })])} />);

    const block = within(offerBox()).getByText("Écartées (2)").closest("details")!;
    expect(block.hasAttribute("open")).toBe(false);
    expect(within(block).getAllByRole("listitem").map((line) => line.getAttribute("aria-label"))).toEqual(["Offre c", "Offre b"]);
    expect(within(block).getByRole("listitem", { name: "Offre b" }).textContent).toContain("Écartée · Lieu");
    expect(within(block).getByRole("listitem", { name: "Offre c" }).textContent).toContain("Écartée");
    expect(within(day("Aujourd'hui")).getAllByRole("listitem").map((line) => line.getAttribute("aria-label"))).toEqual(["Offre a"]);
    expect(within(offerBox()).getByText("2 traitées")).toBeTruthy();

    await userEvent.click(within(block).getByRole("button", { name: "Revenir sur ce choix : Offre b" }));

    expect(fetch).toHaveBeenCalledWith("/api/offer-box/b/dismissal", expect.objectContaining({ method: "DELETE" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("opens « Recherches par Profil » and « Reçues par email » from its foot, in the Work Pane at their own addresses", () => {
    renderInFrench(<OfferBox box={box([])} />);

    expect(within(offerBox()).getByRole("link", { name: "Recherches par Profil" }).getAttribute("href")).toBe("/recherches?profils=1");
    expect(within(offerBox()).getByRole("link", { name: "Reçues par email" }).getAttribute("href")).toBe("/recherches?recues=1");
    expect(within(offerBox()).getByText("Aucune offre pour l'instant")).toBeTruthy();
  });
});

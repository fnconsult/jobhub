// @vitest-environment jsdom
import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { OfferBox, OfferBoxFilterProvider, OfferBoxTopBarTitle } from "./OfferBox";
import { CompactTopBarActions, TopBarActionsProvider, useTopBarState } from "./top-bar";

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

/** An entry of « Précédemment »: arrived two days ago. */
const earlier = (id: string, matchScore: number, overrides: Partial<OfferBoxEntryRead> = {}) =>
  entry(id, { matchScore, arrivalDay: "2026-11-03", firstArrivalAt: "2026-11-03T08:00:00.000Z", ...overrides });

const box = (entries: OfferBoxEntryRead[]): OfferBoxResponse => ({ today: TODAY, toHandle: entries.filter((one) => one.state === "to_handle" || one.state === "later").length, entries });

const offerBox = () => screen.getByRole("region", { name: /^Offres à traiter/ });

/** Recherches d'offres as SidebarShell lays it out: its title and the compact Top Bar's actions, then the page (#898). */
function JobSearchesPage({ box: read }: { box: OfferBoxResponse }) {
  const state = useTopBarState(true);
  return (
    <OfferBoxFilterProvider toHandle={read.toHandle}>
      <TopBarActionsProvider state={state}>
        <header>
          <OfferBoxTopBarTitle title="Recherches d'offres" />
          {state.mode !== "wide" ? <CompactTopBarActions /> : null}
        </header>
        <main>
          <OfferBox box={read} />
        </main>
      </TopBarActionsProvider>
    </OfferBoxFilterProvider>
  );
}

/** A phone's width: below 40rem, the Top Bar is compact. */
function onAPhone() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(width < 40rem)", addEventListener: () => {}, removeEventListener: () => {} }));
}

const filterIcon = (name: string | RegExp = /^Filtrer les offres à traiter/) => within(screen.getByRole("banner")).getByRole("button", { name });
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
    expect(within(chips).getAllByRole("button").map((chip) => chip.textContent)).toEqual(["Toutes2", "Recherche2", "Job Digest0", "Email1", "Lien du coach0", "Extension0", "Partage0"]);
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
    const before = day("Précédemment");
    expect(within(before).getByRole("listitem", { name: "Offre old" }).textContent).toContain("arrivée le 3 nov.");
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

  it("the « Extension » chip shows the Captures followed, and « Partage » the Share captures followed, each « Suivie » with its chip (#819)", async () => {
    const followed = { state: "followed", applicationId: "app", followedAt: "2026-11-05T10:00:00.000Z" } as const;
    renderInFrench(
      <OfferBox
        box={box([
          entry("capturée", { sources: [{ source: "extension", at: "2026-11-05T10:00:00.000Z" }], ...followed }),
          entry("partagée", { sources: [{ source: "share", at: "2026-11-05T11:00:00.000Z" }], ...followed }),
          entry("trouvée"),
        ])}
      />,
    );

    await userEvent.click(within(offerBox()).getByRole("button", { name: "Extension, 0 à traiter" }));
    const today = day("Aujourd'hui");
    expect(within(today).getAllByRole("listitem").map((line) => line.getAttribute("aria-label"))).toEqual(["Offre capturée"]);
    const captured = within(today).getByRole("listitem", { name: "Offre capturée" });
    expect(captured.textContent).toContain("Suivie");
    expect(captured.textContent).toContain("Extension");

    await userEvent.click(within(offerBox()).getByRole("button", { name: "Partage, 0 à traiter" }));
    expect(within(day("Aujourd'hui")).getAllByRole("listitem").map((line) => line.getAttribute("aria-label"))).toEqual(["Offre partagée"]);
    expect(within(day("Aujourd'hui")).getByRole("listitem", { name: "Offre partagée" }).textContent).toContain("Partage");
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

  describe("« Plus tard », « Expirées sans décision » and « Tout écarter » (#817)", () => {
    const later = { state: "later" as const, laterUntil: "2026-11-08T23:00:00.000Z" };

    it("« Plus tard » puts the entry away until Monday, with no date to pick; the toast says it stays counted and offers « Annuler »", async () => {
      const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ laterUntil: "2026-11-08T23:00:00.000Z" }),
      );
      vi.stubGlobal("fetch", fetch);
      renderInFrench(<OfferBox box={box([entry("a")])} />);

      await userEvent.click(within(offerBox()).getByRole("button", { name: "Plus tard : Offre a" }));

      expect(fetch).toHaveBeenCalledWith("/api/offer-box/a/later", expect.objectContaining({ method: "POST" }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(screen.getByRole("status").textContent).toContain("« Offre a » revient lundi 9 nov. : elle reste dans le compteur.");
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Annuler" })));

      refresh.mockReset();
      await userEvent.keyboard("{Enter}");
      expect(fetch).toHaveBeenLastCalledWith("/api/offer-box/a/later", expect.objectContaining({ method: "DELETE" }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it("folds the entries « Plus tard » apart, each saying when it comes back, still counted, with « Suivre » and « Écarter »", () => {
      renderInFrench(<OfferBox box={box([entry("a"), entry("b", later)])} />);

      expect(within(offerBox()).getByText("2", { selector: ".offer-box-count b" })).toBeTruthy();
      expect(within(day("Aujourd'hui")).getAllByRole("listitem").map((line) => line.getAttribute("aria-label"))).toEqual(["Offre a"]);
      const block = within(offerBox()).getByText("Plus tard (1)").closest("details")!;
      expect(block.hasAttribute("open")).toBe(false);
      const line = within(block).getByRole("listitem", { name: "Offre b" });
      expect(line.textContent).toContain("Plus tard · revient lundi 9 nov.");
      expect(within(line).getByRole("button", { name: "Suivre" })).toBeTruthy();
      expect(within(line).getByRole("button", { name: "Écarter" })).toBeTruthy();
      expect(within(line).queryByRole("button", { name: /^Plus tard/ })).toBeNull();
    });

    it("on its Monday, an entry back from « Plus tard » is under « Aujourd'hui », still counted; those still away stay folded with their count", () => {
      const monday = {
        ...box([
          entry("back", { arrivalDay: "2026-11-04", firstArrivalAt: "2026-11-04T08:00:00.000Z", laterUntil: "2026-11-08T23:00:00.000Z" }),
          entry("away", { state: "later", laterUntil: "2026-11-15T23:00:00.000Z", arrivalDay: "2026-11-09", firstArrivalAt: "2026-11-09T08:00:00.000Z" }),
        ]),
        today: "2026-11-09",
      };
      renderInFrench(<OfferBox box={monday} />);

      expect(within(offerBox()).getByText("2", { selector: ".offer-box-count b" })).toBeTruthy();
      expect(within(day("Aujourd'hui")).getAllByRole("listitem").map((line) => line.getAttribute("aria-label"))).toEqual(["Offre back"]);
      expect(within(day("Précédemment")).queryByRole("listitem")).toBeNull();
      const block = within(offerBox()).getByText("Plus tard (1)").closest("details")!;
      expect(within(block).getByRole("listitem", { name: "Offre away" }).textContent).toContain("Plus tard · revient lundi 16 nov.");
    });

    it("folds « Expirées sans décision » apart, out of the count, where « Écarter » is still offered", () => {
      renderInFrench(<OfferBox box={box([entry("a"), earlier("old", 85, { state: "expired" })])} />);

      expect(within(offerBox()).getByText("1", { selector: ".offer-box-count b" })).toBeTruthy();
      const block = within(offerBox()).getByText("Expirées sans décision (1)").closest("details")!;
      expect(block.hasAttribute("open")).toBe(false);
      const line = within(block).getByRole("listitem", { name: "Offre old" });
      expect(within(line).getByRole("button", { name: "Écarter" })).toBeTruthy();
      expect(within(line).queryByRole("button", { name: "Suivre" })).toBeNull();
      expect(within(line).queryByRole("button", { name: /^Plus tard/ })).toBeNull();
      expect(within(day("Précédemment")).queryByRole("listitem")).toBeNull();
    });

    it("« Tout écarter (n) » in « Précédemment » écarte that tier's entries within the source chip, without a reason, with « Annuler »", async () => {
      const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ dismissed: ["m1", "m3"] }),
      );
      vi.stubGlobal("fetch", fetch);
      const email = [{ source: "email" as const, at: "2026-11-03T08:00:00.000Z" }];
      renderInFrench(
        <OfferBox box={box([entry("today1", { matchScore: 70 }), entry("today2", { matchScore: 72 }), earlier("top", 90), earlier("m1", 70), earlier("m2", 65, { sources: email }), earlier("m3", 62)])} />,
      );

      expect(within(day("Aujourd'hui")).queryByRole("button", { name: /Tout écarter/ })).toBeNull();
      // One entry is not worth a « Tout écarter ».
      expect(within(day("Précédemment")).getAllByRole("button", { name: /Tout écarter/ }).map((button) => button.textContent)).toEqual(["Tout écarter (3)"]);
      await userEvent.click(within(offerBox()).getByRole("button", { name: "Recherche, 5 à traiter" }));
      await userEvent.click(within(day("Précédemment")).getByRole("button", { name: "Tout écarter dans « À regarder » (2)" }));

      expect(fetch).toHaveBeenCalledWith("/api/offer-box/dismissals", expect.objectContaining({ method: "POST", body: JSON.stringify({ entryIds: ["m1", "m3"] }) }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(screen.getByRole("status").textContent).toContain("2 offres écartées.");

      refresh.mockReset();
      await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
      expect(fetch).toHaveBeenLastCalledWith("/api/offer-box/dismissals", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ entryIds: ["m1", "m3"] }) }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it("a « Tout écarter » refused says so", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
      renderInFrench(<OfferBox box={box([earlier("m1", 70), earlier("m2", 65)])} />);

      await userEvent.click(within(day("Précédemment")).getByRole("button", { name: "Tout écarter dans « À regarder » (2)" }));

      expect((await within(day("Précédemment")).findByRole("alert")).textContent).toBe("Les offres n'ont pas pu être écartées. Réessayez.");
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  it("says under « Aujourd'hui » how many arrived today and how many are à traiter, for a phone, where the header is behind the filter (#898)", () => {
    renderInFrench(<OfferBox box={box([entry("a"), entry("b"), entry("c", { state: "followed", applicationId: "app-c", followedAt: "2026-11-05T10:00:00.000Z" }), earlier("old", 70)])} />);

    expect(within(day("Aujourd'hui")).getByText("3 arrivées aujourd'hui · 3 à traiter")).toBeTruthy();
    expect(within(day("Précédemment")).queryByText(/arrivées? aujourd'hui/)).toBeNull();
  });

  it("names the day in each tier's heading, for a phone, where only the tier stays pinned; its heading is the tier's alone (#898)", () => {
    renderInFrench(<OfferBox box={box([earlier("m1", 70), earlier("m2", 65)])} />);

    const tier = within(day("Précédemment")).getByRole("region", { name: /À regarder/ });
    const heading = tier.querySelector(".offer-box-tier-heading")!;
    expect(heading.querySelector(".offer-box-tier-day")!.textContent).toBe("Précédemment · ");
    expect(heading.querySelector(".offer-box-tier-day")!.getAttribute("aria-hidden")).toBe("true");
    expect(within(tier).getByRole("heading", { level: 4 }).textContent).toBe("À regarder · 60 à 79");
    expect(within(tier).getByRole("button", { name: "Tout écarter dans « À regarder » (2)" })).toBeTruthy();
  });

  describe("on a phone, behind the filter icon of the compact Top Bar (#898)", () => {
    const read = () => box([entry("a", { sources: [{ source: "email", at: "2026-11-05T08:00:00.000Z" }] }), entry("b"), earlier("old", 70)]);

    it("the icon, named by the count and the source, opens the header as a panel, the focus on the source chosen", async () => {
      onAPhone();
      renderInFrench(<JobSearchesPage box={read()} />);

      const icon = filterIcon("Filtrer les offres à traiter : 3 à traiter, toutes les sources");
      expect(icon.getAttribute("title")).toBe("Filtrer les offres à traiter");
      expect(icon.getAttribute("aria-expanded")).toBe("false");
      const panel = document.getElementById(icon.getAttribute("aria-controls")!)!;
      expect(panel.className).toContain("offer-box-head");
      expect(panel.hasAttribute("data-open")).toBe(false);

      await userEvent.click(icon);

      expect(icon.getAttribute("aria-expanded")).toBe("true");
      expect(panel.hasAttribute("data-open")).toBe(true);
      expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Toutes, 3 à traiter" }));
      expect(within(panel).getByRole("progressbar")).toBeTruthy();
    });

    it("a source chosen filters the box, closes the panel and gives the focus back to the icon, which shows a filter is on", async () => {
      onAPhone();
      renderInFrench(<JobSearchesPage box={read()} />);
      await userEvent.click(filterIcon());

      await userEvent.click(within(offerBox()).getByRole("button", { name: "Email, 1 à traiter" }));

      const icon = filterIcon("Filtrer les offres à traiter : 3 à traiter, source Email");
      expect(icon.getAttribute("aria-expanded")).toBe("false");
      expect(document.getElementById(icon.getAttribute("aria-controls")!)!.hasAttribute("data-open")).toBe(false);
      expect(document.activeElement).toBe(icon);
      expect(icon.querySelector(".offer-box-filter-dot")).not.toBeNull();
      expect(within(offerBox()).getAllByRole("listitem").map((line) => line.getAttribute("aria-label"))).toEqual(["Offre a"]);

      // « Toutes » again: no filter, no dot.
      await userEvent.click(icon);
      await userEvent.click(within(offerBox()).getByRole("button", { name: "Toutes, 3 à traiter" }));
      expect(filterIcon("Filtrer les offres à traiter : 3 à traiter, toutes les sources").querySelector(".offer-box-filter-dot")).toBeNull();
    });

    it("Escape closes the panel, the focus back on the icon; the icon closes it too", async () => {
      onAPhone();
      renderInFrench(<JobSearchesPage box={read()} />);
      const icon = filterIcon();

      await userEvent.click(icon);
      await userEvent.keyboard("{Escape}");
      expect(icon.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(icon);

      await userEvent.click(icon);
      await userEvent.click(icon);
      expect(icon.getAttribute("aria-expanded")).toBe("false");
    });

    /** Écarte `title` without a reason, the keyboard focus then on the toast's « Annuler ». */
    async function dismiss(title: string) {
      await userEvent.click(within(within(offerBox()).getByRole("listitem", { name: title })).getByRole("button", { name: "Écarter" }));
      await userEvent.click(within(offerBox()).getByRole("button", { name: "Écarter sans motif" }));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Annuler" })));
    }

    it("the toast closed, by « Annuler » or Escape, gives the focus to the icon, not to the box's heading, hidden at the top of the box", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
      onAPhone();
      renderInFrench(<JobSearchesPage box={read()} />);

      await dismiss("Offre old");
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
      expect(document.activeElement).toBe(filterIcon());

      await dismiss("Offre a");
      await userEvent.keyboard("{Escape}");
      expect(document.activeElement).toBe(filterIcon());
    });

    it("its panel open, the toast closed gives the focus to the box's heading, in view in the panel", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
      onAPhone();
      renderInFrench(<JobSearchesPage box={read()} />);

      await dismiss("Offre old");
      await userEvent.click(filterIcon());
      screen.getByRole("button", { name: "Annuler" }).focus();
      await userEvent.keyboard("{Escape}");

      expect(document.activeElement).toBe(within(offerBox()).getByRole("heading", { name: "Offres à traiter" }));
    });

    it("is drawn in the Top Bar from the server's HTML, before the page knows its width, so the bar does not change when it hydrates", () => {
      const container = document.createElement("div");
      container.innerHTML = renderToString(
        <I18nProvider locale="fr">
          <JobSearchesPage box={read()} />
        </I18nProvider>,
      );

      const icon = container.querySelector<HTMLButtonElement>("header .topbar-first-paint")!;
      expect(icon.getAttribute("aria-disabled")).toBe("true");
      const byId = (id: string) => container.querySelector(`[id="${id}"]`)!;
      expect(byId(icon.getAttribute("aria-labelledby")!).textContent).toBe("Filtrer les offres à traiter : 3 à traiter, toutes les sources");
      expect(byId(icon.getAttribute("aria-controls")!).className).toContain("offer-box-head");
    });
  });

  it("opens « Recherches par Profil » and « Reçues par email » from its foot, in the Work Pane at their own addresses", () => {
    renderInFrench(<OfferBox box={box([])} />);

    expect(within(offerBox()).getByRole("link", { name: "Recherches par Profil" }).getAttribute("href")).toBe("/recherches?profils=1");
    expect(within(offerBox()).getByRole("link", { name: "Reçues par email" }).getAttribute("href")).toBe("/recherches?recues=1");
    expect(within(offerBox()).getByText("Aucune offre pour l'instant")).toBeTruthy();
  });
});

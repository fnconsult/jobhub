import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { renderInApp } from "../testing";
import { OfferBox } from "./OfferBox";

const TODAY = "2026-11-05";

function entry(id: string, overrides: Partial<OfferBoxEntryRead> = {}): OfferBoxEntryRead {
  return {
    id,
    jobOffer: { id: `offer-${id}`, title: `Offre ${id}`, employer: "Acme Industrie", location: "Lyon", url: `https://www.example.com/${id}`, postedAt: null, expiredAt: null, contractType: "cdi" },
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
    ...overrides,
  };
}

/**
 * The web app's `GET /api/offer-box`, `POST /api/applications` and `POST` / `DELETE /api/offer-box/:id/dismissal`, at
 * the network: « Suivre » makes the entry's Application, so the box read again has it « Suivie »; « Écarter » makes it
 * « Écartée », « Revenir sur ce choix » à traiter again.
 */
function serve(entries: OfferBoxEntryRead[]) {
  const box: OfferBoxResponse = { today: TODAY, toHandle: 0, entries };
  const writes: { path: string; method?: string; body: unknown }[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/offer-box") {
      return Response.json({ ...box, toHandle: box.entries.filter((one) => one.state === "to_handle").length });
    }
    if (url.pathname === "/api/applications" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { jobOfferId: string; profileId: string };
      writes.push({ path: url.pathname, body });
      box.entries = box.entries.map((one) => (one.jobOffer.id === body.jobOfferId ? { ...one, state: "followed", applicationId: "app-1", followedAt: "2026-11-05T10:00:00.000Z" } : one));
      return Response.json({ id: "app-1" }, { status: 201 });
    }
    const dismissal = /^\/api\/offer-box\/([^/]+)\/dismissal$/.exec(url.pathname);
    if (dismissal) {
      const id = decodeURIComponent(dismissal[1]!);
      const body = init?.body ? (JSON.parse(String(init.body)) as { reason: OfferBoxEntryRead["dismissalReason"] }) : undefined;
      writes.push({ path: url.pathname, method: init?.method, body });
      box.entries = box.entries.map((one) =>
        one.id !== id
          ? one
          : init?.method === "POST"
            ? { ...one, state: "dismissed", dismissalReason: body?.reason ?? null, dismissedAt: "2026-11-05T11:00:00.000Z" }
            : { ...one, state: "to_handle", dismissalReason: null, dismissedAt: null },
      );
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  return { writes };
}

describe("Recherches d'offres in the app: the Offer box (ADR-0090), on the web's read", () => {
  beforeEach(() => jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("heads with « N à traiter » and « k traitées », then « Aujourd'hui » and « Précédemment » by Importance tier", async () => {
    serve([
      entry("top", { matchScore: 88 }),
      entry("low", { matchScore: null, profile: null }),
      entry("old", { matchScore: 65, arrivalDay: "2026-11-02", firstArrivalAt: "2026-11-02T08:00:00.000Z" }),
      entry("done", { state: "followed", applicationId: "app-done", followedAt: "2026-11-05T09:00:00.000Z" }),
    ]);
    await renderInApp(<OfferBox />);

    expect(await screen.findByRole("heading", { name: "Offres à traiter" })).toBeOnTheScreen();
    expect(screen.getByText("3 à traiter · 1 traitée")).toBeOnTheScreen();
    expect(screen.getAllByRole("heading").map((heading) => heading.props.children)).toEqual(["Offres à traiter", "Aujourd'hui", "À ne pas manquer", "Peu adaptées", "Précédemment", "À regarder"]);
    expect(screen.getByText(/· Non classée$/)).toBeOnTheScreen();
    expect(screen.getByText(/arrivée le 2 nov\./)).toBeOnTheScreen();
    expect(screen.getByText("Suivies aujourd'hui (1)")).toBeOnTheScreen();
  });

  it("filters by a source chip, each with how many of its entries are à traiter", async () => {
    serve([entry("a", { sources: [{ source: "email", at: "2026-11-05T08:00:00.000Z" }] }), entry("b")]);
    await renderInApp(<OfferBox />);
    await screen.findByRole("heading", { name: "Offres à traiter" });

    await userEvent.setup().press(screen.getByRole("button", { name: "Email, 1 à traiter" }));

    expect(screen.getByRole("button", { name: "Email, 1 à traiter" }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole("link", { name: "Offre a · Acme Industrie" })).toBeOnTheScreen();
    expect(screen.queryByRole("link", { name: "Offre b · Acme Industrie" })).toBeNull();
  });

  it("« Suivre » saves the Job Offer as an Application with the entry's Profile, and the box read again shows it « Suivie »", async () => {
    const { writes } = serve([entry("a", { profile: null, scoredWith: { id: "p2", name: "Contrôleuse" } })]);
    await renderInApp(<OfferBox />);
    const line = await screen.findByLabelText("Offre a");

    await userEvent.setup().press(within(line).getByRole("button", { name: "Suivre : Offre a" }));

    expect(writes).toEqual([{ path: "/api/applications", body: { jobOfferId: "offer-a", profileId: "p2" } }]);
    await waitFor(() => expect(screen.getByText("0 à traiter · 1 traitée")).toBeOnTheScreen());
    expect(screen.getByText("Suivies aujourd'hui (1)")).toBeOnTheScreen();
  });

  it("« Écarter » opens the Dismissal reasons and « Écarter sans motif »; a reason écarte the entry, out of the count, with « Annuler » (#816)", async () => {
    const { writes } = serve([entry("a"), entry("b")]);
    const user = userEvent.setup();
    await renderInApp(<OfferBox />);
    const line = await screen.findByLabelText("Offre a");

    await user.press(within(line).getByRole("button", { name: "Écarter : Offre a" }));
    expect(within(line).getByText("Pourquoi ? (facultatif)")).toBeOnTheScreen();
    for (const reason of ["Pas pour moi", "Salaire", "Lieu", "Contrat", "Déjà postulé ailleurs", "Écarter sans motif"]) expect(within(line).getByRole("button", { name: reason })).toBeOnTheScreen();
    await user.press(within(line).getByRole("button", { name: "Contrat" }));

    expect(writes).toEqual([{ path: "/api/offer-box/a/dismissal", method: "POST", body: { reason: "contract" } }]);
    await waitFor(() => expect(screen.getByText("1 à traiter · 1 traitée")).toBeOnTheScreen());
    expect(screen.getByText("« Offre a » écartée.")).toBeOnTheScreen();
    // aria-live says nothing on iOS: VoiceOver is told.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("« Offre a » écartée.");

    await user.press(screen.getByRole("button", { name: "Annuler" }));
    expect(writes.at(-1)).toEqual({ path: "/api/offer-box/a/dismissal", method: "DELETE", body: undefined });
    await waitFor(() => expect(screen.getByText("2 à traiter · 0 traitée")).toBeOnTheScreen());
    expect(screen.queryByText(/n'a pas abouti/)).toBeNull();
  });

  it("an « Annuler » that fails tells the Candidate the offer is still écartée", async () => {
    serve([entry("a")]);
    const user = userEvent.setup();
    await renderInApp(<OfferBox />);
    const line = await screen.findByLabelText("Offre a");
    await user.press(within(line).getByRole("button", { name: "Écarter : Offre a" }));
    await user.press(within(line).getByRole("button", { name: "Lieu" }));
    await screen.findByText("« Offre a » écartée.");
    const fetch = jest.mocked(globalThis.fetch);
    const served = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input, init) => (init?.method === "DELETE" ? Response.json({ error: "unavailable" }, { status: 503 }) : served(input, init)));

    await user.press(screen.getByRole("button", { name: "Annuler" }));

    const said = "« Annuler » n'a pas abouti : l'offre reste écartée. Réessayez avec « Revenir sur ce choix », dans « Écartées ».";
    expect(await screen.findByText(said)).toBeOnTheScreen();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(said);
    expect(screen.getByText("0 à traiter · 1 traitée")).toBeOnTheScreen();
  });

  it("« Écarter sans motif » écarte with no reason; « Écartées » folds them, each with its reason and « Revenir sur ce choix »", async () => {
    const { writes } = serve([entry("a"), entry("b", { state: "dismissed", dismissalReason: "salary", dismissedAt: "2026-11-05T09:00:00.000Z" })]);
    const user = userEvent.setup();
    await renderInApp(<OfferBox />);
    const line = await screen.findByLabelText("Offre a");

    await user.press(within(line).getByRole("button", { name: "Écarter : Offre a" }));
    await user.press(within(line).getByRole("button", { name: "Écarter sans motif" }));
    expect(writes).toEqual([{ path: "/api/offer-box/a/dismissal", method: "POST", body: { reason: null } }]);

    const fold = await screen.findByRole("button", { name: "Écartées (2)" });
    expect(screen.queryByText("Écartée · Salaire")).toBeNull();
    await user.press(fold);
    expect(screen.getByText("Écartée · Salaire")).toBeOnTheScreen();
    expect(screen.getByText("Écartée")).toBeOnTheScreen();

    await user.press(screen.getByRole("button", { name: "Revenir sur ce choix : Offre b" }));
    expect(writes.at(-1)).toEqual({ path: "/api/offer-box/b/dismissal", method: "DELETE", body: undefined });
    await waitFor(() => expect(screen.getByRole("button", { name: "Écartées (1)" })).toBeOnTheScreen());
  });

  it("says when nothing has arrived yet", async () => {
    serve([]);
    await renderInApp(<OfferBox />);

    expect(await screen.findByText("Aucune offre pour l'instant")).toBeOnTheScreen();
  });
});

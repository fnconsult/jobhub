import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { renderInApp } from "../testing";
import { OfferBox } from "./OfferBox";

const TODAY = "2026-11-05";
/** Monday 9 November 2026, 00:00 in Paris: when « Plus tard » brings an entry of Thursday 5 November back. */
const MONDAY = "2026-11-08T23:00:00.000Z";

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
    laterUntil: null,
    ...overrides,
  };
}

/**
 * The web app's `GET /api/offer-box`, `POST /api/applications`, `POST` / `DELETE /api/offer-box/:id/dismissal`,
 * `/api/offer-box/:id/later` and `/api/offer-box/dismissals`, at the network: « Suivre » makes the entry's Application,
 * so the box read again has it « Suivie »; « Écarter » makes it « Écartée », « Revenir sur ce choix » à traiter again;
 * « Plus tard » puts it away until Monday 9 November; « Tout écarter » écarte the entries it names.
 */
function serve(entries: OfferBoxEntryRead[]) {
  const box: OfferBoxResponse = { today: TODAY, toHandle: 0, entries };
  const writes: { path: string; method?: string; body: unknown }[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/offer-box") {
      return Response.json({ ...box, toHandle: box.entries.filter((one) => one.state === "to_handle" || one.state === "later").length });
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
    const later = /^\/api\/offer-box\/([^/]+)\/later$/.exec(url.pathname);
    if (later) {
      const id = decodeURIComponent(later[1]!);
      writes.push({ path: url.pathname, method: init?.method, body: undefined });
      const laterUntil = init?.method === "POST" ? MONDAY : null;
      box.entries = box.entries.map((one) => (one.id === id ? { ...one, state: laterUntil ? "later" : "to_handle", laterUntil } : one));
      return laterUntil ? Response.json({ laterUntil }) : new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/offer-box/dismissals") {
      const { entryIds } = JSON.parse(String(init?.body)) as { entryIds: string[] };
      writes.push({ path: url.pathname, method: init?.method, body: { entryIds } });
      const dismissing = init?.method === "POST";
      box.entries = box.entries.map((one) =>
        entryIds.includes(one.id) ? { ...one, state: dismissing ? "dismissed" : "to_handle", dismissedAt: dismissing ? "2026-11-05T11:00:00.000Z" : null } : one,
      );
      return dismissing ? Response.json({ dismissed: entryIds }) : new Response(null, { status: 204 });
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

  describe("« Plus tard », « Expirées sans décision » and « Tout écarter » (#817)", () => {
    const earlier = (id: string, matchScore: number, overrides: Partial<OfferBoxEntryRead> = {}) =>
      entry(id, { matchScore, arrivalDay: "2026-11-03", firstArrivalAt: "2026-11-03T08:00:00.000Z", ...overrides });

    it("« Plus tard » puts the entry away until Monday, still counted, folded under « Plus tard » with when it comes back; « Annuler » brings it back", async () => {
      const { writes } = serve([entry("a"), entry("b")]);
      const user = userEvent.setup();
      await renderInApp(<OfferBox />);
      const line = await screen.findByLabelText("Offre a");

      await user.press(within(line).getByRole("button", { name: "Plus tard : Offre a" }));

      expect(writes).toEqual([{ path: "/api/offer-box/a/later", method: "POST", body: undefined }]);
      const said = "« Offre a » revient lundi 9 nov. : elle reste dans le compteur.";
      expect(await screen.findByText(said)).toBeOnTheScreen();
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(said);
      expect(screen.getByText("2 à traiter · 0 traitée")).toBeOnTheScreen();
      await user.press(screen.getByRole("button", { name: "Plus tard (1)" }));
      const away = screen.getByLabelText("Offre a");
      expect(within(away).getByText("Plus tard · revient lundi 9 nov.")).toBeOnTheScreen();
      expect(within(away).queryByRole("button", { name: "Plus tard : Offre a" })).toBeNull();
      expect(within(away).getByRole("button", { name: "Écarter : Offre a" })).toBeOnTheScreen();

      await user.press(screen.getByRole("button", { name: "Annuler" }));
      expect(writes.at(-1)).toEqual({ path: "/api/offer-box/a/later", method: "DELETE", body: undefined });
      await waitFor(() => expect(screen.queryByRole("button", { name: "Plus tard (1)" })).toBeNull());
    });

    it("folds « Expirées sans décision », out of the count, where « Écarter » is still offered", async () => {
      serve([entry("a"), earlier("old", 85, { state: "expired" })]);
      const user = userEvent.setup();
      await renderInApp(<OfferBox />);

      expect(await screen.findByText("1 à traiter · 0 traitée")).toBeOnTheScreen();
      expect(screen.queryByLabelText("Offre old")).toBeNull();
      await user.press(screen.getByRole("button", { name: "Expirées sans décision (1)" }));
      const line = screen.getByLabelText("Offre old");
      expect(within(line).getByRole("button", { name: "Écarter : Offre old" })).toBeOnTheScreen();
      expect(within(line).queryByRole("button", { name: "Suivre : Offre old" })).toBeNull();
      expect(within(line).queryByRole("button", { name: "Plus tard : Offre old" })).toBeNull();
    });

    it("« Tout écarter (n) » in « Précédemment » écarte that tier's entries within the source chip, with « Annuler »", async () => {
      const email = [{ source: "email" as const, at: "2026-11-03T08:00:00.000Z" }];
      const { writes } = serve([entry("today1", { matchScore: 70 }), entry("today2", { matchScore: 72 }), earlier("m1", 70), earlier("m2", 65, { sources: email }), earlier("m3", 62)]);
      const user = userEvent.setup();
      await renderInApp(<OfferBox />);
      await screen.findByRole("heading", { name: "Offres à traiter" });

      // « Aujourd'hui » offers none; « Précédemment »'s « À regarder » does.
      expect(screen.getAllByRole("button", { name: /^Tout écarter/ })).toHaveLength(1);
      await user.press(screen.getByRole("button", { name: "Recherche, 4 à traiter" }));
      await user.press(screen.getByRole("button", { name: "Tout écarter dans « À regarder » (2)" }));

      expect(writes).toEqual([{ path: "/api/offer-box/dismissals", method: "POST", body: { entryIds: ["m1", "m3"] } }]);
      expect(await screen.findByText("2 offres écartées.")).toBeOnTheScreen();
      expect(screen.getByText("3 à traiter · 2 traitées")).toBeOnTheScreen();

      await user.press(screen.getByRole("button", { name: "Annuler" }));
      expect(writes.at(-1)).toEqual({ path: "/api/offer-box/dismissals", method: "DELETE", body: { entryIds: ["m1", "m3"] } });
      await waitFor(() => expect(screen.getByText("5 à traiter · 0 traitée")).toBeOnTheScreen());
    });
  });

  it("says when nothing has arrived yet", async () => {
    serve([]);
    await renderInApp(<OfferBox />);

    expect(await screen.findByText("Aucune offre pour l'instant")).toBeOnTheScreen();
  });
});

import type { OfferBoxEntryRead } from "@jobhub/shared/reads";
import { screen, userEvent, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { renderInApp } from "../testing";
import { FoundJobOfferPane } from "./FoundJobOffer";
import { found } from "./testing";

const DAF = { id: "p1", name: "DAF" };

/** The Offer box entry the Job Search's Job Offer « a » arrived as: its own id, « e-a », not the Job Offer's. */
const ENTRY: OfferBoxEntryRead = {
  id: "e-a",
  jobOffer: { id: "a", title: "Offre a", employer: "Acme Industrie", location: "Lyon", url: null, postedAt: null, expiredAt: null, contractType: "cdi" },
  profile: DAF,
  scoredWith: DAF,
  matchScore: 86,
  firstArrivalAt: "2026-11-05T08:00:00.000Z",
  arrivalDay: "2026-11-05",
  sources: [{ source: "job_search", at: "2026-11-05T08:00:00.000Z" }],
  state: "to_handle",
  applicationId: null,
  followedAt: null,
  dismissalReason: null,
  dismissedAt: null,
  laterUntil: null,
};

/** The web app's « Écartées » window: `GET /api/offer-box` leaves out an entry écartée longer ago (OFFER_BOX_DISMISSED_DAYS). */
const DISMISSED_DAYS = 30;
const TODAY = "2026-11-05T12:00:00.000Z";
const inTheBox = (one: OfferBoxEntryRead) => one.state !== "dismissed" || !one.dismissedAt || Date.parse(TODAY) - Date.parse(one.dismissedAt) <= DISMISSED_DAYS * 24 * 60 * 60 * 1000;

/** The entry écartée 31 days ago: the Offer box no longer gives it, its Job Offer's own read does (#895). */
const longAgo = (dismissalReason: OfferBoxEntryRead["dismissalReason"]): OfferBoxEntryRead => ({ ...ENTRY, state: "dismissed", dismissalReason, dismissedAt: "2026-10-05T09:00:00.000Z" });

/**
 * The web app at the network: `POST /api/applications` answering `status`, and the Offer box (`GET /api/offer-box`,
 * holding `entries` but those écartées more than 30 days ago; `GET /api/offer-box/job-offers/:id`, a Job Offer's entry
 * whatever its age) with its `POST` / `DELETE /api/offer-box/:id/dismissal`, which écarte an entry or brings it back.
 */
function serve(status = 201, entries: OfferBoxEntryRead[] = [ENTRY]) {
  const writes: unknown[] = [];
  const dismissals: { method?: string; path: string; body: unknown }[] = [];
  let box = entries;
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/offer-box") {
      const shown = box.filter(inTheBox);
      return Response.json({ today: "2026-11-05", toHandle: shown.filter((one) => one.state === "to_handle").length, entries: shown });
    }
    const ofJobOffer = /^\/api\/offer-box\/job-offers\/([^/]+)$/.exec(url.pathname);
    if (ofJobOffer) {
      const entry = box.find((one) => one.jobOffer.id === decodeURIComponent(ofJobOffer[1]!));
      return entry ? Response.json(entry) : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (url.pathname === "/api/applications" && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return Response.json({ id: "app-1" }, { status });
    }
    const dismissal = /^\/api\/offer-box\/([^/]+)\/dismissal$/.exec(url.pathname);
    if (dismissal) {
      const body = init?.body ? (JSON.parse(String(init.body)) as { reason: OfferBoxEntryRead["dismissalReason"] }) : undefined;
      dismissals.push({ method: init?.method, path: url.pathname, body });
      box = box.map((one) =>
        one.id !== decodeURIComponent(dismissal[1]!)
          ? one
          : init?.method === "POST"
            ? { ...one, state: "dismissed", dismissalReason: body?.reason ?? null, dismissedAt: "2026-11-05T11:00:00.000Z" }
            : { ...one, state: "to_handle", dismissalReason: null, dismissedAt: null },
      );
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  return { writes, dismissals };
}

/** The pane of the Job Offer « a », once the Offer box read has found its entry (its « Écarter » shown). */
async function openPane() {
  await renderInApp(<FoundJobOfferPane found={found("a")} profile={DAF} />);
  await screen.findByRole("button", { name: "Écarter : Offre a" });
}

describe("a Job Offer a Job Search found, in the Work Pane (#692)", () => {
  beforeEach(() => jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("shows its Match Score against the Profile with why, its summary and its text", async () => {
    serve();
    await renderInApp(<FoundJobOfferPane found={found("a")} profile={DAF} />);

    expect(screen.getByText("86 / 100")).toBeOnTheScreen();
    expect(screen.getByText("Score de correspondance avec le profil « DAF » :")).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("button", { name: "Pourquoi 86 ?" }));
    expect(screen.getByText("Compétences : 1 sur 2 sur votre CV ; absentes : SAP")).toBeOnTheScreen();
    expect(screen.getByText("Lieu : Lyon, recherché : Lyon")).toBeOnTheScreen();
    expect(screen.getByText("Piloter la consolidation IFRS d'un groupe industriel.")).toBeOnTheScreen();
    expect(screen.getByText("Vous pilotez la consolidation IFRS sous SAP.")).toBeOnTheScreen();
  });

  it("« Suivre » creates its Application with the Job Search's Profile, then leads to it", async () => {
    const { writes } = serve();
    await openPane();

    await userEvent.setup().press(screen.getByRole("button", { name: "Suivre : Offre a" }));

    expect(writes).toEqual([{ jobOfferId: "a", profileId: "p1" }]);
    await waitFor(() => expect(screen.getByText("Suivie")).toBeOnTheScreen());
    expect(screen.getByRole("button", { name: "Voir la candidature" })).toBeOnTheScreen();
  });

  it("says so when « Suivre » failed, and still offers it", async () => {
    serve(500);
    await openPane();

    await userEvent.setup().press(screen.getByRole("button", { name: "Suivre : Offre a" }));

    expect(await screen.findByText("L'offre n'a pas pu être suivie. Réessayez.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Suivre : Offre a" })).toBeOnTheScreen();
  });

  it("an offer already followed leads to its Application, with no « Suivre »", async () => {
    serve();
    await renderInApp(<FoundJobOfferPane found={found("a", { decision: "kept", applicationId: "app-9" })} profile={DAF} />);

    expect(screen.getByText("Suivie")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Suivre : Offre a" })).toBeNull();
  });

  it("« Écarter » écarte it from the Offer box with a Dismissal reason, says so with « Annuler », which brings it back (#816)", async () => {
    const { dismissals } = serve();
    const user = userEvent.setup();
    await renderInApp(<FoundJobOfferPane found={found("a")} profile={DAF} />);

    await user.press(await screen.findByRole("button", { name: "Écarter : Offre a" }));
    for (const reason of ["Pas pour moi", "Lieu", "Contrat", "Déjà postulé ailleurs", "Écarter sans motif"]) expect(screen.getByRole("button", { name: reason })).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Salaire" }));

    expect(dismissals).toEqual([{ method: "POST", path: "/api/offer-box/e-a/dismissal", body: { reason: "salary" } }]);
    expect(await screen.findByText("« Offre a » écartée.")).toBeOnTheScreen();
    // aria-live says nothing on iOS: VoiceOver is told.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("« Offre a » écartée.");
    expect(await screen.findByText("Écartée · Salaire")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Suivre : Offre a" })).toBeNull();

    await user.press(screen.getByRole("button", { name: "Annuler" }));
    expect(dismissals.at(-1)).toEqual({ method: "DELETE", path: "/api/offer-box/e-a/dismissal", body: undefined });
    expect(await screen.findByRole("button", { name: "Suivre : Offre a" })).toBeOnTheScreen();
  });

  it("an offer écartée says so with its reason, and « Revenir sur ce choix » puts it back to handle", async () => {
    const { dismissals } = serve(201, [{ ...ENTRY, state: "dismissed", dismissalReason: "location", dismissedAt: "2026-11-05T09:00:00.000Z" }]);
    const user = userEvent.setup();
    await renderInApp(<FoundJobOfferPane found={found("a", { decision: "dismissed" })} profile={DAF} />);

    expect(await screen.findByText("Écartée · Lieu")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Revenir sur ce choix : Offre a" }));

    expect(dismissals).toEqual([{ method: "DELETE", path: "/api/offer-box/e-a/dismissal", body: undefined }]);
    expect(await screen.findByRole("button", { name: "Écarter : Offre a" })).toBeOnTheScreen();
  });

  it.each([
    ["with its Dismissal reason", "location", "Écartée · Lieu"],
    ["without a Dismissal reason", null, "Écartée"],
  ] as const)("an offer écartée 31 days ago, %s, still says so, with no « Suivre » (#895)", async (_case, reason, said) => {
    const { writes } = serve(201, [longAgo(reason)]);
    await renderInApp(<FoundJobOfferPane found={found("a", { decision: "dismissed" })} profile={DAF} />);

    expect(await screen.findByRole("button", { name: "Revenir sur ce choix : Offre a" })).toBeOnTheScreen();
    expect(screen.getByText(said)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Suivre : Offre a" })).toBeNull();
    expect(writes).toEqual([]);
  });

  it("« Revenir sur ce choix » puts an offer écartée 31 days ago back to handle (#895)", async () => {
    const { dismissals } = serve(201, [longAgo("location")]);
    const user = userEvent.setup();
    await renderInApp(<FoundJobOfferPane found={found("a", { decision: "dismissed" })} profile={DAF} />);

    await user.press(await screen.findByRole("button", { name: "Revenir sur ce choix : Offre a" }));

    expect(dismissals).toEqual([{ method: "DELETE", path: "/api/offer-box/e-a/dismissal", body: undefined }]);
    expect(await screen.findByRole("button", { name: "Écarter : Offre a" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Suivre : Offre a" })).toBeOnTheScreen();
  });

  it("an offer écartée whose entry cannot be read says « Écartée », and nothing follows it (ADR-0090)", async () => {
    serve();
    jest.mocked(globalThis.fetch).mockImplementation(async () => Response.json({ error: "unavailable" }, { status: 503 }));
    await renderInApp(<FoundJobOfferPane found={found("a", { decision: "dismissed" })} profile={DAF} />);

    expect(screen.getByText("Écartée")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Suivre : Offre a" })).toBeNull();
  });

  it("says so when « Écarter » failed, and the offer stays to handle", async () => {
    serve();
    const fetch = jest.mocked(globalThis.fetch);
    const served = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input, init) => (init?.method === "POST" && String(input).includes("/dismissal") ? Response.json({ error: "unavailable" }, { status: 503 }) : served(input, init)));
    const user = userEvent.setup();
    await renderInApp(<FoundJobOfferPane found={found("a")} profile={DAF} />);

    await user.press(await screen.findByRole("button", { name: "Écarter : Offre a" }));
    await user.press(screen.getByRole("button", { name: "Écarter sans motif" }));

    expect(await screen.findByText(/n'a pas pu être écartée/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Suivre : Offre a" })).toBeOnTheScreen();
  });

  it("an offer not in the Offer box still offers « Suivre », with no « Écarter »", async () => {
    const { writes } = serve(201, []);
    await renderInApp(<FoundJobOfferPane found={found("a")} profile={DAF} />);

    await userEvent.setup().press(screen.getByRole("button", { name: "Suivre : Offre a" }));

    expect(writes).toEqual([{ jobOfferId: "a", profileId: "p1" }]);
    expect(await screen.findByRole("button", { name: "Voir la candidature" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Écarter : Offre a" })).toBeNull();
  });
});

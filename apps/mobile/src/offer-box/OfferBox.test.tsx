import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { screen, userEvent, waitFor, within } from "@testing-library/react-native";
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
    ...overrides,
  };
}

/**
 * The web app's `GET /api/offer-box` and `POST /api/applications`, at the network: « Suivre » makes the entry's
 * Application, so the box read again has it « Suivie ».
 */
function serve(entries: OfferBoxEntryRead[]) {
  const box: OfferBoxResponse = { today: TODAY, toHandle: 0, entries };
  const writes: { path: string; body: unknown }[] = [];
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
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  return { writes };
}

describe("Recherches d'offres in the app: the Offer box (ADR-0090), on the web's read", () => {
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

  it("says when nothing has arrived yet", async () => {
    serve([]);
    await renderInApp(<OfferBox />);

    expect(await screen.findByText("Aucune offre pour l'instant")).toBeOnTheScreen();
  });
});

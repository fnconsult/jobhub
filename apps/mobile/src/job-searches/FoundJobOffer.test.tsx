import type { FoundJobOffer } from "@jobhub/shared/reads";
import { screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderInApp } from "../testing";
import { FoundJobOfferPane } from "./FoundJobOffer";

const DAF = { id: "p1", name: "DAF" };

export function found(id: string, overrides: Partial<FoundJobOffer> = {}): FoundJobOffer {
  return {
    jobOffer: {
      id,
      title: `Offre ${id}`,
      employer: "Acme Industrie",
      location: "Lyon",
      url: `https://www.example.com/${id}`,
      postedAt: null,
      expiredAt: null,
      contractType: "cdi",
      summary: "Piloter la consolidation IFRS d'un groupe industriel.",
      content: "Vous pilotez la consolidation IFRS sous SAP.",
    },
    matchScore: 86,
    matchScoreDetail: {
      skills: { status: "partial", covered: ["IFRS"], missing: ["SAP"] },
      seniority: { status: "unknown", cvYears: null, requiredYears: null },
      location: { status: "match", offer: "Lyon", wanted: ["Lyon"] },
      salary: { status: "unknown", offerMin: null, offerMax: null, wanted: null },
      contractType: { status: "match", offer: "cdi", wanted: ["cdi"] },
    },
    decision: null,
    applicationId: null,
    ...overrides,
  };
}

/** The web app's `POST /api/applications`, at the network. */
function serve(status = 201) {
  const writes: unknown[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/applications" && init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)));
      return Response.json({ id: "app-1" }, { status });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  return { writes };
}

describe("a Job Offer a Job Search found, in the Work Pane (#692)", () => {
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
    await renderInApp(<FoundJobOfferPane found={found("a")} profile={DAF} />);

    await userEvent.setup().press(screen.getByRole("button", { name: "Suivre : Offre a" }));

    expect(writes).toEqual([{ jobOfferId: "a", profileId: "p1" }]);
    await waitFor(() => expect(screen.getByText("Suivie")).toBeOnTheScreen());
    expect(screen.getByRole("button", { name: "Voir la candidature" })).toBeOnTheScreen();
  });

  it("says so when « Suivre » failed, and still offers it", async () => {
    serve(500);
    await renderInApp(<FoundJobOfferPane found={found("a")} profile={DAF} />);

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
});

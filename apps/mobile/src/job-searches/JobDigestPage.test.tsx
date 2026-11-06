import type { JobDigestResponse } from "@jobhub/shared/reads";
import { screen } from "@testing-library/react-native";
import { renderInApp } from "../testing";
import { JobDigestPage } from "./JobDigestPage";
import { found } from "./testing";

const DIGEST: JobDigestResponse = { id: "d1", profile: { id: "p1", name: "DAF" }, sentAt: "2026-11-02T06:00:00.000Z", jobOffers: [found("a"), found("b", { matchScore: 61 })] };

describe("a Job Digest sent, in the app (#692)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("opens on its Job Offers, each with its Match Score", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      new URL(String(input)).pathname === "/api/job-digests/d1" ? Response.json(DIGEST) : Response.json({ error: "not_found" }, { status: 404 }),
    );
    await renderInApp(<JobDigestPage id="d1" />);

    expect(await screen.findByText("Job Digest « DAF »")).toBeOnTheScreen();
    expect(screen.getByText("Envoyé le lundi 2 novembre 2026")).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: "Offre a · Acme Industrie" })).toBeOnTheScreen();
    expect(screen.getByText("Match Score 61 · Lyon")).toBeOnTheScreen();
  });

  it("says so for a Job Digest that is not the Candidate's", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ error: "not_found" }, { status: 404 }));
    await renderInApp(<JobDigestPage id="d9" />);

    expect(await screen.findByText("Ce Job Digest est introuvable : il n'existe pas ou n'est pas le vôtre.")).toBeOnTheScreen();
  });
});

import { screen } from "@testing-library/react-native";
import { renderInApp } from "../testing";
import { Sidebar } from "./Sidebar";

jest.mock("expo-router", () => ({ ...jest.requireActual("expo-router"), useRouter: () => ({ navigate: jest.fn(), push: jest.fn() }), usePathname: () => "/" }));

/** The web app's reads the Sidebar makes: its Free conversations, and the Offer box's offers à traiter (#818). */
function serve(toHandle: number) {
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/offer-box/count") return Response.json({ toHandle });
    if (url.pathname === "/api/coach/conversations") return Response.json({ conversations: [] });
    return new Response(null, { status: 404 });
  });
}

afterEach(() => jest.restoreAllMocks());

describe("the app's Sidebar: « Recherches d'offres » carries « N », the offers à traiter (#818, ADR-0090)", () => {
  it("shows N beside it, said in words to a screen reader", async () => {
    serve(12);
    await renderInApp(<Sidebar onNavigate={() => {}} />);
    expect(await screen.findByRole("link", { name: "Recherches d'offres, 12 offres à traiter" })).toBeOnTheScreen();
    expect(screen.getByText("12")).toBeOnTheScreen();
  });

  it("in the singular for one", async () => {
    serve(1);
    await renderInApp(<Sidebar onNavigate={() => {}} />);
    expect(await screen.findByRole("link", { name: "Recherches d'offres, 1 offre à traiter" })).toBeOnTheScreen();
  });

  it("shows « 99+ » over 99, the exact number said in words (#939)", async () => {
    serve(128);
    await renderInApp(<Sidebar onNavigate={() => {}} />);
    expect(await screen.findByRole("link", { name: "Recherches d'offres, 128 offres à traiter" })).toBeOnTheScreen();
    expect(screen.getByText("99+")).toBeOnTheScreen();
  });

  it("shows nothing at zero", async () => {
    serve(0);
    await renderInApp(<Sidebar onNavigate={() => {}} />);
    expect(await screen.findByRole("link", { name: "Recherches d'offres" })).toBeOnTheScreen();
    expect(screen.queryByText("0")).toBeNull();
  });
});

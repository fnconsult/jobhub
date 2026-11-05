// End-to-end for Mes candidatures in the app (#691) through the app's real entry: Expo Router mounts the list and an
// Application's page, its conversation and its Fiche. The web app is faked at the network: its Mes candidatures routes
// (./applications-web), which answer only to the signed-in Candidate's session and take a write only from the app's
// origin, the Coach Conversation's routes (src/coach/testing.ts) and the session's endpoints (src/session/testing.ts).
// Only the device's native modules are faked besides: the system's Dialog (Alert) and browser (Linking).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApplicationResponse } from "@jobhub/shared/reads";
import { act, screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Alert, Dimensions, Linking, type AlertButton } from "react-native";
import { fakeCoachWeb, withCoach } from "../src/coach/testing";
import { serveApplications, type ApplicationsRoute, type HeldApplication } from "./applications-web";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
/** The device's network as expo-network reports it, connected unless a test turns it off. */
const mockNetwork = { connected: true, listeners: new Set<(state: { isConnected: boolean }) => void>() };
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: mockNetwork.connected }),
  addNetworkStateListener: (listener: (state: { isConnected: boolean }) => void) => {
    mockNetwork.listeners.add(listener);
    return { remove: () => mockNetwork.listeners.delete(listener) };
  },
}));

// The web app the app signs in to (#685), as documents.e2e.test.tsx fakes it.
const mockWeb = {} as { app: ReturnType<typeof import("../src/session/testing").fakeWebApp>; session: import("../src/session/app-session").AppSession };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch, webViewCookies: memoryWebViewCookies() });
  return { appSession: mockWeb.session };
});
// Not hoisted: it replaces Expo Router's own mock, whose scheme is not the app's (as in app.e2e.test.tsx).
jest.doMock("expo-linking", () => ({ ...jest.requireActual("expo-linking"), useLinkingURL: () => null }));
const EMAIL = "marie.dupont@example.fr";
async function signedIn() {
  jest.requireMock("../src/session/instance");
  if ((await mockWeb.session.current()).kind === "signedIn") return;
  await mockWeb.session.askLink(EMAIL);
  await mockWeb.session.openLink(mockWeb.app.linkFor(EMAIL));
}

const PHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };
const setWindow = ({ width, height }: { width: number; height: number }) => {
  const size = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
};
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const link = (name: string | RegExp) => screen.getByRole("link", { name, hidden: true });

const jobOffer = (id: string, title: string, employer: string, location: string) => ({ id, title, employer, location, url: null, postedAt: null, expiredAt: null });

/** Marie's Application to Aéroline, « Postulée », no Interview yet. */
const AEROLINE: ApplicationResponse = {
  id: "app_aeroline",
  status: "applied",
  statusChangedAt: "2026-10-30T09:00:00.000Z",
  createdAt: "2026-10-28T09:00:00.000Z",
  jobOffer: { ...jobOffer("offer_aeroline", "Responsable qualité", "Aéroline", "Toulouse"), url: "https://www.welcometothejungle.com/fr/companies/aeroline/jobs/responsable-qualite", postedAt: "2026-10-20T08:00:00.000Z" },
  profile: { id: "prof_qualite", name: "Qualité aéronautique" },
  matchScore: 82,
  reportedUnavailableAt: null,
  interviews: [],
};
/** Her Application to Rhône Distribution, at « Entretien »: one Interview Rescheduled, one Cancelled. */
const RHONE: ApplicationResponse = {
  id: "app_rhone",
  status: "interview",
  statusChangedAt: "2026-11-02T09:00:00.000Z",
  createdAt: "2026-10-20T09:00:00.000Z",
  jobOffer: jobOffer("offer_rhone", "Responsable logistique", "Rhône Distribution", "Lyon"),
  profile: { id: "prof_lyon", name: "Supply chain à Lyon" },
  matchScore: null,
  reportedUnavailableAt: null,
  interviews: [
    {
      id: "interview-rh",
      scheduledAt: "2026-11-12T13:30:00.000Z",
      durationMinutes: 45,
      format: "video",
      place: "https://teams.microsoft.com/l/meetup-join/rhone",
      note: "Avec la DRH",
      cancelledAt: null,
      reschedules: [{ previousAt: "2026-11-10T09:00:00.000Z", newAt: "2026-11-12T13:30:00.000Z", by: "candidate", at: "2026-11-03T08:00:00.000Z" }],
    },
    { id: "interview-site", scheduledAt: "2026-11-20T09:00:00.000Z", durationMinutes: null, format: "on_site", place: "12 quai Perrache, Lyon", note: "", cancelledAt: "2026-11-04T10:00:00.000Z", reschedules: [] },
  ],
};
/** An Archived Application: « Refusée », its past Interview kept. */
const ARCHIVED: ApplicationResponse = {
  ...RHONE,
  id: "app_ancienne",
  status: "rejected",
  jobOffer: jobOffer("offer_ancienne", "Cheffe de quai", "Transports Martin", "Vénissieux"),
  interviews: [{ ...RHONE.interviews[1]!, id: "interview-ancien", scheduledAt: "2026-09-15T08:00:00.000Z", cancelledAt: null }],
};
const HELD: HeldApplication[] = [{ application: AEROLINE, toHandle: "follow_up" }, { application: RHONE }, { application: ARCHIVED }];

let web: ApplicationsRoute;
/** Signed in, the web app serving Mes candidatures (`held`), the app opened at `url`, past the legal steps (#689). */
async function launch(url: string, held = HELD) {
  await signedIn();
  web = serveApplications(mockWeb.app, EMAIL, held, withCoach(fakeCoachWeb(), mockWeb.app.fetch));
  await renderRouter("./src/app", { initialUrl: url });
  await waitFor(() => expect(screen.queryByLabelText("Ouverture de votre compte…")).toBeNull());
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockNetwork.connected = true;
  setWindow(PHONE);
  jest.requireMock("../src/session/instance");
  mockWeb.app.has(EMAIL, { applications: HELD.map(({ application }) => ({ application, documents: { documentLanguage: "fr", documents: [] } })) });
});
afterEach(() => jest.restoreAllMocks());

describe("Mes candidatures, the list", () => {
  it("lists the Applications with their status, Match Score and what is à traiter, and a row opens its Application", async () => {
    await launch("/candidatures");
    expect(await screen.findByText("2 candidatures")).toBeOnTheScreen();
    expect(screen.getByText("1 à traiter")).toBeOnTheScreen();
    expect(screen.getByText("Postulée · Score de correspondance 82 · Relance prête")).toBeOnTheScreen();
    expect(screen.getByText("Entretien · Score de correspondance non calculable")).toBeOnTheScreen();
    await userEvent.setup().press(link("Responsable logistique · Rhône Distribution"));
    expect(screen).toHavePathname("/candidatures/app_rhone");
  });

  it("titles an Application's page with its Job Offer, and the title, an arrow before it, leads back to the list", async () => {
    await launch("/candidatures/app_rhone");
    const title = await screen.findByRole("link", { name: "Responsable logistique" });
    await userEvent.setup().press(title);
    expect(screen).toHavePathname("/candidatures");
  });
});

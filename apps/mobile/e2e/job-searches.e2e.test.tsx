// End-to-end for Recherches d'offres and Job Digests (#692) through the app's real entry: Expo Router mounts the screens,
// which read the Candidate's Job Searches and Job Digests from the web app (`GET /api/job-searches[/:id]`,
// `GET /api/job-digests[/:id]`, #684), faked at its fetch as it answers them, as are « Suivre » (`POST /api/applications`)
// and « Relancer une recherche » (`POST /api/job-searches`, 402 once the Plan Quota is spent, ADR-0032). Only the WebView
// (a native view) is faked besides.
import type { JobDigestResponse, JobDigestsResponse, JobSearchResponse, JobSearchesResponse, ProfileResponse } from "@jobhub/shared/reads";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { fakeCoachWeb, withCoach } from "../src/coach/testing";
import { found } from "../src/job-searches/testing";
import { fakeWebView } from "../src/testing-device";
import { Dimensions } from "react-native";

jest.setTimeout(60_000);

/** The app opened at `initialUrl`, past the legal steps it reads first once signed in (#689). */
async function openApp(initialUrl: string) {
  await renderRouter("./src/app", { initialUrl });
  await waitFor(() => expect(screen.queryByLabelText("Ouverture de votre compte…")).toBeNull());
}

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
const setNetwork = (connected: boolean) => {
  mockNetwork.connected = connected;
  for (const listener of mockNetwork.listeners) listener({ isConnected: connected });
};

// Signed in, as the app is once its magic link opened it (#685): the web app's endpoints faked at the session's fetch.
const mockWeb = {} as { app: ReturnType<typeof import("../src/session/testing").fakeWebApp>; session: import("../src/session/app-session").AppSession; webViews: { cookies: () => unknown[] } };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.webViews = memoryWebViewCookies();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch, passkeys: mockWeb.app.deviceWithoutPasskey(), webViewCookies: mockWeb.webViews });
  return { appSession: mockWeb.session };
});
const mockLink = { current: null as string | null, listeners: new Set<() => void>() };
// Not hoisted: it replaces Expo Router's own mock (expo-router/testing-library), whose scheme is not the app's.
jest.doMock("expo-linking", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const subscribe = (listener: () => void) => (mockLink.listeners.add(listener), () => mockLink.listeners.delete(listener));
  return { ...jest.requireActual("expo-linking"), useLinkingURL: () => useSyncExternalStore(subscribe, () => mockLink.current) };
});
const EMAIL = "marie.dupont@example.fr";
async function signedIn() {
  jest.requireMock("../src/session/instance");
  if ((await mockWeb.session.current()).kind === "signedIn") return;
  await mockWeb.session.askLink(EMAIL);
  await mockWeb.session.openLink(mockWeb.app.linkFor(EMAIL));
}



const setWindow = ({ width, height }: { width: number; height: number }) => {
  const size = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
};
const button = (name: string | RegExp) => screen.getByRole("button", { name });

const PROFILE: ProfileResponse = {
  id: "p1",
  name: "DAF",
  archived: false,
  searchCriteria: { targetRole: "Directeur financier", locations: ["Lyon", "Bordeaux"], contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
  masterCv: { version: 1, content: { fullName: "Marie Dupont", headline: "DAF", email: EMAIL, phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: [], languages: [] } },
  atsScore: null,
};
const SEARCH: JobSearchResponse = {
  id: "s1",
  profile: { id: "p1", name: "DAF" },
  status: "done",
  failure: null,
  startedAt: "2026-11-02T08:00:00.000Z",
  jobOffers: [found("a"), found("b", { matchScore: 64, decision: "kept", applicationId: "app-b" })],
};
const SEARCHES: JobSearchesResponse = {
  profiles: [{ profile: { id: "p1", name: "DAF" }, searches: [{ id: "s1", status: "done", startedAt: SEARCH.startedAt, found: 2, unseen: true }] }],
  unseen: 1,
};
const DIGESTS: JobDigestsResponse = {
  profiles: [{ profile: { id: "p1", name: "DAF" }, frequency: "weekly", chosenFrequency: "weekly", planFrequency: "weekly", digests: [{ id: "d1", sentAt: "2026-11-03T07:00:00.000Z", count: 1 }] }],
};
const DIGEST: JobDigestResponse = { id: "d1", profile: { id: "p1", name: "DAF" }, sentAt: "2026-11-03T07:00:00.000Z", jobOffers: [found("c")] };
const QUOTA_PROMPT = {
  title: "Limite atteinte",
  message: "Vous avez utilisé votre recherche d'offres de la semaine avec l'offre Gratuit. Passez à Standard pour en lancer davantage.",
};

const calls = { follows: [] as unknown[], starts: [] as unknown[] };
let quotaSpent = false;
/** The web app's job routes, the rest (sign-in, coach) answered as the other end-to-end tests do. */
function jobWeb(rest: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method === "GET") {
      if (url.pathname === "/api/job-searches") return Response.json(SEARCHES);
      if (url.pathname === "/api/job-searches/s1") return Response.json(SEARCH);
      if (url.pathname === "/api/job-digests") return Response.json(DIGESTS);
      if (url.pathname === "/api/job-digests/d1") return Response.json(DIGEST);
    }
    if (method === "POST" && url.pathname === "/api/applications") {
      calls.follows.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "app-new" }, { status: 201 });
    }
    if (method === "POST" && url.pathname === "/api/job-searches") {
      calls.starts.push(JSON.parse(String(init?.body)));
      return quotaSpent
        ? Response.json({ error: "quota_exceeded", quota: "jobSearches", plan: "free", limit: 1, upgradeTo: "standard", prompt: { ...QUOTA_PROMPT, upgradeTo: "standard", action: "Passer à Standard", href: "/abonnement" } }, { status: 402 })
        : Response.json({ id: "s2" }, { status: 201 });
    }
    return rest(input, init);
  };
}

beforeEach(() => {
  fakeWebView.reset();
  setWindow({ width: 390, height: 844 });
  quotaSpent = false;
  calls.follows.length = 0;
  calls.starts.length = 0;
  jest.requireMock("../src/session/instance");
  jest.spyOn(globalThis, "fetch").mockImplementation(jobWeb(withCoach(fakeCoachWeb(), mockWeb.app.fetch)));
  mockWeb.app.has(EMAIL, { profiles: [PROFILE] });
  mockWeb.app.reads.length = 0;
});
afterEach(async () => {
  await act(() => setNetwork(true));
  jest.restoreAllMocks();
});

describe("Recherches d'offres (#692)", () => {
  it("shows each active Profile's Job Searches with their status and Job Offer count, « Nouveaux résultats » included, and opens one", async () => {
    await signedIn();
    await openApp("/recherches");

    expect(await screen.findByText("DAF")).toBeOnTheScreen();
    expect(await screen.findByText(/Offres trouvées : 2/)).toBeOnTheScreen();
    expect(screen.getByText(/Nouveaux résultats/)).toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole("link", { name: /Dernière recherche|recherche/i }));
    expect(screen).toHavePathname("/recherches/s1");
    expect(await screen.findByText("Offres trouvées pour « DAF »")).toBeOnTheScreen();
    expect(screen.getByText("Terminée")).toBeOnTheScreen();
  });

  it("reads the Search Criteria and sends their edition to the web (WebView)", async () => {
    await signedIn();
    await openApp("/recherches/s1");
    expect(await screen.findByText("Lieux : Lyon, Bordeaux")).toBeOnTheScreen();
    await userEvent.setup().press(button("Modifier les critères"));
    expect(await screen.findByTestId("web-view")).toBeOnTheScreen();
  });

  it("opens a Job Offer in the Work Pane with its Match Score and why, and « Suivre » saves it as an Application", async () => {
    await signedIn();
    await openApp("/recherches/s1");
    const user = userEvent.setup();
    await user.press(await screen.findByRole("link", { name: "Offre a · Acme Industrie" }));

    expect(await screen.findByText("Vous pilotez la consolidation IFRS sous SAP.")).toBeOnTheScreen();
    expect(screen.getByText("Piloter la consolidation IFRS d'un groupe industriel.")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: /^Pourquoi/ }));
    expect(screen.getAllByText(/IFRS/).length).toBeGreaterThan(1);

    await user.press(screen.getByRole("button", { name: "Suivre : Offre a" }));
    expect(await screen.findByText("Voir la candidature")).toBeOnTheScreen();
    expect(calls.follows).toEqual([{ jobOfferId: "a", profileId: "p1" }]);
  });

  it("a relaunch is refused for lack of Plan Quota, as the web says it, with nothing to buy", async () => {
    quotaSpent = true;
    await signedIn();
    await openApp("/recherches/s1");
    await userEvent.setup().press(await screen.findByRole("button", { name: "Relancer une recherche" }));

    expect(await screen.findByText("Limite atteinte")).toBeOnTheScreen();
    expect(screen.getByText(QUOTA_PROMPT.message)).toBeOnTheScreen();
    expect(screen.queryByText("Passer à Standard")).toBeNull();
    expect(calls.starts).toEqual([{ profileId: "p1" }]);
    expect(screen).toHavePathname("/recherches/s1");
  });

  it("a relaunch within the Plan Quota opens the new Job Search", async () => {
    await signedIn();
    await openApp("/recherches/s1");
    await userEvent.setup().press(await screen.findByRole("button", { name: "Relancer une recherche" }));
    await waitFor(() => expect(screen).toHavePathname("/recherches/s2"));
    expect(calls.starts).toEqual([{ profileId: "p1" }]);
  });
});

describe("Job Digests (#692)", () => {
  it("shows each active Profile's frequency and Job Digests sent, and a Job Digest opens its Job Offers", async () => {
    await signedIn();
    await openApp("/job-digests");

    expect(await screen.findByText("DAF")).toBeOnTheScreen();
    expect(await screen.findByText(/Offres : 1/)).toBeOnTheScreen();
    expect(screen.getByText(/hebdomadaire|chaque semaine|Hebdomadaire/i)).toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole("link", { name: /Envoyé le/ }));
    expect(screen).toHavePathname("/job-digests/d1");
    expect(await screen.findByRole("link", { name: "Offre c · Acme Industrie" })).toBeOnTheScreen();
  });
});

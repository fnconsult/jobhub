// End-to-end for the Push notifications' permission (#699) through the app's real entry: Expo Router mounts the Job
// Searches' page, the web app's, in the WebView. The permission is asked in context, after an explanation screen, never
// at first launch: when the Candidate launches a Job Search, which lands on the new Job Search's page, or adds an Interview.
// Only the WebView, a native view, is faked: the page it shows, and the navigation it is told of.
import type { ProfileResponse } from "@jobhub/shared/reads";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { renderRouter } from "expo-router/testing-library";
import { fakeWebView } from "../src/testing-device";
import { Dimensions } from "react-native";

jest.setTimeout(60_000);

/** The app opened at `initialUrl`, past the legal steps it reads first once signed in (#689). */
async function openApp(initialUrl: string) {
  const app = await renderRouter("./src/app", { initialUrl });
  await waitFor(() => expect(screen.queryByLabelText("Ouverture de votre compte…")).toBeNull());
  return app;
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
const PHONE = { width: 390, height: 844 };

beforeEach(() => {
  fakeWebView.reset();
  setWindow(PHONE);
  // Every call of the app's useApi() goes to the web app, faked at its fetch as the session's are.
  jest.requireMock("../src/session/instance");
  jest.spyOn(globalThis, "fetch").mockImplementation(mockWeb.app.fetch);
  mockWeb.app.has(EMAIL, { profiles: [SUPPLY_CHAIN] });
  mockWeb.app.reads.length = 0;
  mockWeb.app.recorded.length = 0;
  mockWeb.app.setOffline(false);
});
afterEach(async () => {
  await act(() => setNetwork(true));
  jest.restoreAllMocks();
});

/** The Candidate's one active Profile, the one « Lancer une recherche » searches for. */
const SUPPLY_CHAIN: ProfileResponse = {
  id: "prof_lyon",
  name: "Supply chain à Lyon",
  archived: false,
  searchCriteria: { targetRole: "Responsable logistique", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
  masterCv: { version: 1, content: { fullName: "Marie Dupont", email: EMAIL, phone: "", location: "Lyon", headline: "", summary: "", experience: [], education: [], skills: [], languages: [] } },
  atsScore: null,
};
const PURCHASING: ProfileResponse = { ...SUPPLY_CHAIN, id: "prof_achats", name: "Achats industriels" };

const EXPLANATION = "Être prévenu des nouveaux résultats ?";
const button = (name: string | RegExp) => screen.getByRole("button", { name });
/** The Job Searches the app asked the web app to start, with the Profile each was for. */
const started = () => mockWeb.app.recorded.filter(({ method, path }) => method === "POST" && path === "/api/job-searches").map(({ body }) => body);

describe("Push notifications' permission, asked in context", () => {
  it("asks nothing when the app opens, on the Job Searches' page", async () => {
    await signedIn();
    await openApp("/recherches");
    expect(screen.queryByText(EXPLANATION)).toBeNull();
  });

  it("explains first, in words of its own, once a Job Search is launched; the system is asked only after the Candidate accepts", async () => {
    const systemPrompt = jest.spyOn(Notifications, "requestPermissionsAsync");
    await signedIn();
    const app = await openApp("/recherches");

    await userEvent.setup().press(await screen.findByRole("button", { name: "Lancer une recherche" }));

    // The Job Search is started on the web app, for the Profile, and its page opens with the explanation over it.
    expect(await screen.findByText(EXPLANATION)).toBeOnTheScreen();
    expect(started()).toEqual([{ profileId: SUPPLY_CHAIN.id }]);
    expect(screen.getByText(/Votre recherche continue sans vous/)).toBeOnTheScreen();
    expect(app.getPathname()).toMatch(/^\/recherches\/[^/]+$/);
    expect(systemPrompt).not.toHaveBeenCalled();

    await userEvent.setup().press(button("Activer les notifications"));

    await waitFor(() => expect(systemPrompt).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(EXPLANATION)).toBeNull();
  });

  it("names each active Profile on its own « Lancer une recherche » when the Candidate has several", async () => {
    mockWeb.app.has(EMAIL, { profiles: [SUPPLY_CHAIN, PURCHASING] });
    await signedIn();
    await openApp("/recherches");

    await userEvent.setup().press(await screen.findByRole("button", { name: "Lancer une recherche · Achats industriels" }));

    expect(await screen.findByText(EXPLANATION)).toBeOnTheScreen();
    expect(started()).toEqual([{ profileId: PURCHASING.id }]);
  });

  it("remembers « Pas maintenant »: the next Job Search launched asks nothing, and the system was never asked", async () => {
    const systemPrompt = jest.spyOn(Notifications, "requestPermissionsAsync");
    await signedIn();
    await openApp("/recherches");
    const user = userEvent.setup();
    await user.press(await screen.findByRole("button", { name: "Lancer une recherche" }));
    await user.press(await screen.findByRole("button", { name: "Pas maintenant" }));
    await waitFor(() => expect(screen.queryByText(EXPLANATION)).toBeNull());

    await openApp("/recherches");
    await user.press(await screen.findByRole("button", { name: "Lancer une recherche" }));

    await waitFor(() => expect(started()).toHaveLength(2));
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    expect(systemPrompt).not.toHaveBeenCalled();
  });

  it("asks nothing when the Job Search could not be launched, and says so", async () => {
    await signedIn();
    await openApp("/recherches");
    const launch = await screen.findByRole("button", { name: "Lancer une recherche" });
    mockWeb.app.setOffline(true);

    await userEvent.setup().press(launch);

    expect(await screen.findByText("La recherche n'a pas pu être lancée. Vérifiez votre connexion et réessayez.")).toBeOnTheScreen();
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    expect(screen).toHavePathname("/recherches");
  });
});

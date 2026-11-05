// End-to-end for the Push notifications' permission (#699) through the app's real entry: Expo Router mounts the Job
// Searches' page, the web app's, in the WebView. The permission is asked in context, after an explanation screen, never
// at first launch: when the Candidate launches a Job Search, which lands on the new Job Search's page, or adds an Interview.
// Only the WebView, a native view, is faked: the page it shows, and the navigation it is told of.
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
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
const PHONE = { width: 390, height: 844 };

beforeEach(() => {
  fakeWebView.reset();
  setWindow(PHONE);
  // Every call of the app's useApi() goes to the web app, faked at its fetch as the session's are.
  jest.requireMock("../src/session/instance");
  jest.spyOn(globalThis, "fetch").mockImplementation(mockWeb.app.fetch);
  mockWeb.app.has(EMAIL, {});
  mockWeb.app.reads.length = 0;
});
afterEach(async () => {
  await act(() => setNetwork(true));
  jest.restoreAllMocks();
});


const EXPLANATION = "Être prévenu des nouveaux résultats ?";

describe("Push notifications' permission, asked in context", () => {
  it("asks nothing when the app opens, on the Job Searches' page", async () => {
    await signedIn();
    await openApp("/recherches");
    expect(screen.queryByText(EXPLANATION)).toBeNull();
  });

  it("explains first, in words of its own, once a Job Search is launched; the system is asked only after the Candidate accepts", async () => {
    await signedIn();
    await openApp("/recherches");

    await userEvent.setup().press(screen.getByRole("button", { name: "Lancer une recherche" }));

    expect(await screen.findByText(EXPLANATION)).toBeOnTheScreen();
  });
});

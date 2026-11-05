// End-to-end for the end of a session (#695, ADR-0076): however it ends (« Se déconnecter », revoked from Mon compte on
// the web, expired, a read answered 401), the app forgets what it read for it, in memory and on the device, and the
// Tailored Documents downloaded, so the next Candidate to sign in on the device never sees the previous one's. Through
// the app's real entry, the web app faked at its fetch (src/session/testing.ts), the device's storage AsyncStorage's
// own mock.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApplicationResponse, ProfileResponse } from "@jobhub/shared/reads";
import { act, cleanup, screen, userEvent } from "@testing-library/react-native";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { AppState } from "react-native";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
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

const mockWeb = {} as { app: ReturnType<typeof import("../src/session/testing").fakeWebApp>; session: import("../src/session/app-session").AppSession };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch, passkeys: mockWeb.app.deviceWithoutPasskey() });
  return { appSession: mockWeb.session };
});
const mockLink = { current: null as string | null, listeners: new Set<() => void>() };
jest.doMock("expo-linking", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const subscribe = (listener: () => void) => (mockLink.listeners.add(listener), () => mockLink.listeners.delete(listener));
  return { ...jest.requireActual("expo-linking"), useLinkingURL: () => useSyncExternalStore(subscribe, () => mockLink.current) };
});
/** The Tailored Documents downloaded, as the app's cache folder holds them. */
const mockForgotten = { documents: 0 };
jest.mock("../src/documents/system-documents", () => ({
  ...jest.requireActual("../src/documents/system-documents"),
  forgetDocuments: async () => void mockForgotten.documents++,
}));

const MARIE = "marie.dupont@example.fr";
const PAUL = "paul.martin@example.fr";
const CV = { fullName: "", email: "", phone: "", location: "", headline: "", summary: "", experience: [], education: [], skills: [], languages: [] };
const criteria = (targetRole: string) => ({ targetRole, locations: [], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] });
const MARIES_PROFILE: ProfileResponse = { id: "prof_marie", name: "Supply chain à Lyon", archived: false, searchCriteria: criteria("Responsable logistique"), masterCv: { version: 1, content: CV }, atsScore: null };
const PAULS_PROFILE: ProfileResponse = { id: "prof_paul", name: "Comptabilité à Nantes", archived: false, searchCriteria: criteria("Comptable"), masterCv: { version: 1, content: CV }, atsScore: null };
/** One of Marie's Applications: a read the device keeps for offline (READS). */
const MARIES_APPLICATION: ApplicationResponse = {
  id: "app_marie",
  status: "applied",
  statusChangedAt: "2026-11-02T09:00:00.000Z",
  createdAt: "2026-10-28T09:00:00.000Z",
  jobOffer: { id: "offer_marie", title: "Responsable logistique", employer: "Rhône Distribution", location: "Lyon", url: null, postedAt: null, expiredAt: null },
  profile: { id: "prof_marie", name: "Supply chain à Lyon" },
  matchScore: null,
  reportedUnavailableAt: null,
  interviews: [],
};

/** The app's calls to the API (useApi()) wait for `release` while `held`, and fail without network, as a phone's do. */
let held: Promise<void> | null = null;
let release = () => {};
const hold = () => (held = new Promise<void>((resolve) => (release = () => ((held = null), resolve()))));

async function signedInAs(email: string) {
  jest.requireMock("../src/session/instance");
  await mockWeb.session.signOut();
  await mockWeb.session.askLink(email);
  await mockWeb.session.openLink(mockWeb.app.linkFor(email));
}
/** The system opens the running app with the magic link last emailed to `email`, as tapping it in Mail does. */
async function signInInApp(email: string) {
  await mockWeb.session.askLink(email);
  await act(async () => ((mockLink.current = mockWeb.app.linkFor(email)), mockLink.listeners.forEach((listener) => listener())));
}
/** The app comes back to the foreground, where it asks the web app for its session again. */
async function backToForeground() {
  const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter(([event]) => event === "change").map(([, listener]) => listener);
  await act(async () => listeners.forEach((listener) => listener("active")));
}
/** Past the read cache's save (once a second at most), on renderRouter's fake timers. */
const saved = () => act(() => jest.advanceTimersByTimeAsync(1_200));
const keptOnDevice = async () => (await AsyncStorage.getItem("jobbbox.reads")) ?? "";

beforeEach(async () => {
  jest.requireMock("../src/session/instance");
  await AsyncStorage.clear();
  mockForgotten.documents = 0;
  mockLink.current = null;
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!mockNetwork.connected) throw new TypeError("Network request failed");
    await held;
    return mockWeb.app.fetch(input, init);
  });
  mockWeb.app.has(MARIE, { profiles: [MARIES_PROFILE], applications: [{ application: MARIES_APPLICATION, documents: { documentLanguage: "fr", documents: [] } }] });
  mockWeb.app.has(PAUL, { profiles: [PAULS_PROFILE] });
  await signedInAs(MARIE);
});
afterEach(async () => {
  release();
  await act(() => setNetwork(true));
  jest.restoreAllMocks();
});

describe("« Se déconnecter »", () => {
  it("empties the read cache, in memory and on the device, and the documents, before the session is dropped (ADR-0076)", async () => {
    await renderRouter("./src/app", { initialUrl: "/candidatures/app_marie" });
    await userEvent.setup().press(await screen.findByRole("button", { name: "Fiche" }));
    await act(async () => router.navigate("/compte"));
    expect(await screen.findByRole("link", { name: "Supply chain à Lyon" })).toBeOnTheScreen();
    await saved();
    expect(await keptOnDevice()).toContain("Rhône Distribution");
    mockForgotten.documents = 0;

    // What the device still holds the moment the session is dropped: were the app killed then, it would stay.
    const dropSession = mockWeb.session.signOut;
    const atSignOut: { kept?: string; documents?: number } = {};
    jest.spyOn(mockWeb.session, "signOut").mockImplementation(async () => {
      atSignOut.kept ??= await keptOnDevice();
      atSignOut.documents ??= mockForgotten.documents;
      return dropSession();
    });
    await userEvent.setup().press(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();

    expect(atSignOut.kept).toBe("");
    expect(atSignOut.documents).toBeGreaterThan(0);
    // Nothing was left in memory to be saved again afterwards.
    await saved();
    expect(await keptOnDevice()).toBe("");
  });
});

describe("a session revoked on the web, then another Candidate signing in on the device", () => {
  it("never shows the next Candidate the previous one's Profiles", async () => {
    await renderRouter("./src/app", { initialUrl: "/compte" });
    expect(await screen.findByRole("link", { name: "Supply chain à Lyon" })).toBeOnTheScreen();

    mockWeb.app.revokeAll(MARIE);
    await backToForeground();
    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();

    // Paul's Profiles are on their way: until they come, nothing of Marie's stands in for them.
    hold();
    await signInInApp(PAUL);
    await act(async () => router.navigate("/compte"));
    expect(await screen.findByText("Chargement…")).toBeOnTheScreen();
    expect(screen.queryByText("Supply chain à Lyon", { includeHiddenElements: true })).toBeNull();

    await act(async () => release());
    expect(await screen.findByRole("link", { name: "Comptabilité à Nantes" })).toBeOnTheScreen();
    expect(screen.queryByText("Supply chain à Lyon", { includeHiddenElements: true })).toBeNull();
    expect(mockForgotten.documents).toBeGreaterThan(0);
  });

  it("offline, shows the next Candidate nothing of the previous one's, in memory or kept on the device", async () => {
    await renderRouter("./src/app", { initialUrl: "/candidatures/app_marie" });
    await userEvent.setup().press(await screen.findByRole("button", { name: "Fiche" }));
    await act(async () => router.navigate("/compte"));
    expect(await screen.findByRole("link", { name: "Supply chain à Lyon" })).toBeOnTheScreen();
    await saved();
    expect(await keptOnDevice()).toContain("Rhône Distribution");

    mockWeb.app.revokeAll(MARIE);
    await backToForeground();
    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    await saved();
    expect(await keptOnDevice()).not.toContain("Rhône Distribution");

    await act(() => setNetwork(false));
    await signInInApp(PAUL);
    await act(async () => router.navigate("/compte"));
    expect(await screen.findByText(/se chargera dès le retour du réseau/)).toBeOnTheScreen();
    expect(screen.queryByText("Supply chain à Lyon", { includeHiddenElements: true })).toBeNull();
    await act(async () => router.navigate("/candidatures/app_marie"));
    expect(screen.queryByText(/Rhône Distribution/, { includeHiddenElements: true })).toBeNull();
  });
});

describe("a session found ended", () => {
  it("by a read answered 401, goes back to sign-in and forgets the reads, rather than offer « Réessayer »", async () => {
    await renderRouter("./src/app", { initialUrl: "/compte" });
    expect(await screen.findByRole("link", { name: "Supply chain à Lyon" })).toBeOnTheScreen();

    mockWeb.app.revokeAll(MARIE);
    await act(async () => router.navigate("/profils/prof_marie"));

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Réessayer" })).toBeNull();
    expect(mockForgotten.documents).toBeGreaterThan(0);
    hold();
    await signInInApp(PAUL);
    await act(async () => router.navigate("/compte"));
    expect(screen.queryByText("Supply chain à Lyon", { includeHiddenElements: true })).toBeNull();
  });

  it("at launch, forgets what the device kept of the previous session", async () => {
    await renderRouter("./src/app", { initialUrl: "/candidatures/app_marie" });
    await userEvent.setup().press(await screen.findByRole("button", { name: "Fiche" }));
    await saved();
    expect(await keptOnDevice()).toContain("Rhône Distribution");
    // The app closed, then launched again.
    await act(async () => cleanup());

    mockWeb.app.revokeAll(MARIE);
    await renderRouter("./src/app", { initialUrl: "/compte" });
    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    await saved();
    expect(await keptOnDevice()).not.toContain("Rhône Distribution");
  });

  it("without network at launch, keeps what the device kept: the session may still be valid", async () => {
    await renderRouter("./src/app", { initialUrl: "/candidatures/app_marie" });
    await userEvent.setup().press(await screen.findByRole("button", { name: "Fiche" }));
    await saved();
    // The app closed, then launched again.
    await act(async () => cleanup());

    mockWeb.app.setOffline(true);
    await renderRouter("./src/app", { initialUrl: "/compte" });
    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    await saved();
    mockWeb.app.setOffline(false);
    expect(await keptOnDevice()).toContain("Rhône Distribution");
  });
});

describe("a session pending its second step (#688)", () => {
  it("leaving the second step for the app shows the Candidate nothing of the previous one's", async () => {
    await renderRouter("./src/app", { initialUrl: "/compte" });
    expect(await screen.findByRole("link", { name: "Supply chain à Lyon" })).toBeOnTheScreen();
    mockWeb.app.revokeAll(MARIE);
    await backToForeground();
    await screen.findByLabelText("Votre adresse e-mail");

    mockWeb.app.withSecondStep(PAUL);
    await signInInApp(PAUL);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Code de l'application"), mockWeb.app.appCode());
    expect(screen.queryByText("Supply chain à Lyon", { includeHiddenElements: true })).toBeNull();
    hold();
    await user.press(screen.getByRole("button", { name: "Vérifier" }));
    await act(async () => router.navigate("/compte"));

    expect(await screen.findByText("Chargement…")).toBeOnTheScreen();
    expect(screen.queryByText("Supply chain à Lyon", { includeHiddenElements: true })).toBeNull();
    await act(async () => release());
    expect(await screen.findByRole("link", { name: "Comptabilité à Nantes" })).toBeOnTheScreen();
    expect(screen.queryByText("Supply chain à Lyon", { includeHiddenElements: true })).toBeNull();
  });

  it("signing out from the second step, the session staying pending, forgets what the device kept", async () => {
    await renderRouter("./src/app", { initialUrl: "/candidatures/app_marie" });
    await userEvent.setup().press(await screen.findByRole("button", { name: "Fiche" }));
    await saved();
    expect(await keptOnDevice()).toContain("Rhône Distribution");
    mockForgotten.documents = 0;

    // Another account's link opened in the running app: its session is pending its second step.
    mockWeb.app.withSecondStep(PAUL);
    await signInInApp(PAUL);
    expect(await screen.findByLabelText("Code de l'application")).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("button", { name: "Se déconnecter" }));

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    await saved();
    expect(await keptOnDevice()).not.toContain("Rhône Distribution");
    expect(mockForgotten.documents).toBeGreaterThan(0);
  });
});

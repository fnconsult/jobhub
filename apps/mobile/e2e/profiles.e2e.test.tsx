// End-to-end for the Profiles (#695) through the app's real entry: Expo Router mounts Mon compte and a Profile's page
// with its Fiche, which read the Candidate's own Profiles from the web app (`GET /api/profiles`, `GET /api/profiles/:id`,
// #684), faked at its fetch as it answers them. Only the WebView, a native view, is faked besides: what it would load,
// and what it is told to let through, is asserted.
import type { ProfileResponse } from "@jobhub/shared/reads";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import type { ReactNode } from "react";
import { Dimensions, Linking } from "react-native";

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
const mockWeb = {} as { app: ReturnType<typeof import("../src/session/testing").fakeWebApp>; session: import("../src/session/app-session").AppSession };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch, passkeys: mockWeb.app.deviceWithoutPasskey() });
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

type WebViewProps = { source: { uri: string; headers?: Record<string, string> }; onShouldStartLoadWithRequest: (request: { url: string }) => boolean; children?: ReactNode };
const mockWebViews: WebViewProps[] = [];
jest.mock("react-native-webview", () => ({
  WebView: (props: WebViewProps) => {
    mockWebViews.push(props);
    const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
    return <MockView testID="webview" />;
  },
}));

const setWindow = ({ width, height }: { width: number; height: number }) => {
  const size = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
};
const PHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const lastWebView = () => mockWebViews.at(-1)!;
/** The page's title, in its Top Bar (under the Fiche, when it covers the page on a phone): nowhere else on a Profile's page. */
const title = (name: string) => screen.getByText(name, { includeHiddenElements: true });

const CV = {
  fullName: "Marie Dupont",
  email: EMAIL,
  phone: "",
  location: "Lyon",
  summary: "Dix ans de logistique en grande distribution.",
  experience: [{ title: "Responsable d'entrepôt", employer: "Rhône Distribution", location: "Lyon", period: "2016 – 2026", description: "Trois sites, 80 personnes." }],
  education: [],
  skills: ["WMS", "Lean"],
  languages: [],
};
/** Marie's own Profiles on the web app, as `GET /api/profiles/:id` answers them: two active, one archived. */
const SUPPLY_CHAIN: ProfileResponse = {
  id: "prof_lyon",
  name: "Supply chain à Lyon",
  archived: false,
  searchCriteria: {
    targetRole: "Responsable logistique",
    locations: ["Lyon", "Villeurbanne"],
    minSalary: 48000,
    contractTypes: ["cdi"],
    remoteWorkOptions: ["on_site", "hybrid"],
    sectors: ["Grande distribution"],
    subsectors: [],
    domains: [],
  },
  masterCv: { version: 4, content: { ...CV, headline: "Responsable logistique, WMS et Lean" } },
  atsScore: 74,
};
const PURCHASING: ProfileResponse = {
  id: "prof_achats",
  name: "Achats industriels",
  archived: false,
  searchCriteria: { targetRole: "Acheteuse industrielle", locations: [], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
  masterCv: { version: 1, content: { ...CV, headline: "", summary: "" } },
  atsScore: null,
};
const ARCHIVED: ProfileResponse = { ...PURCHASING, id: "prof_ancien", name: "Ancien profil commerce", archived: true };

async function openProfileFiche(id = SUPPLY_CHAIN.id) {
  await signedIn();
  await openApp(`/profils/${id}`);
  await userEvent.setup().press(button("Fiche"));
}

beforeEach(() => {
  mockWebViews.length = 0;
  setWindow(PHONE);
  // Every call of the app's useApi() goes to the web app, faked at its fetch as the session's are.
  jest.requireMock("../src/session/instance");
  jest.spyOn(globalThis, "fetch").mockImplementation(mockWeb.app.fetch);
  mockWeb.app.has(EMAIL, { profiles: [SUPPLY_CHAIN, PURCHASING, ARCHIVED] });
  mockWeb.app.reads.length = 0;
});
afterEach(async () => {
  await act(() => setNetwork(true));
  jest.restoreAllMocks();
});

describe("Profiles, to read", () => {
  it("lists the Candidate's own Profiles in Mon compte, read from the web app with their session", async () => {
    await signedIn();
    await openApp("/compte");

    expect(screen.getByText("Profils")).toBeOnTheScreen();
    expect(await screen.findByRole("link", { name: "Supply chain à Lyon" })).toBeOnTheScreen();
    expect(screen.getByRole("link", { name: "Achats industriels" })).toBeOnTheScreen();
    expect(mockWeb.app.reads).toContainEqual({ path: "/api/profiles", as: EMAIL });
  });

  it("leaves the Archived Profiles out of Mon compte, as the web app's read does", async () => {
    await signedIn();
    await openApp("/compte");
    await screen.findByRole("link", { name: "Supply chain à Lyon" });
    expect(screen.queryByText("Ancien profil commerce")).toBeNull();
  });

  it("leads from Mon compte to the Profile's page", async () => {
    await signedIn();
    await openApp("/compte");
    await userEvent.setup().press(await screen.findByRole("link", { name: "Supply chain à Lyon" }));
    expect(screen).toHavePathname("/profils/prof_lyon");
  });

  it("says so when the Candidate has no Profile yet", async () => {
    mockWeb.app.has(EMAIL, { profiles: [ARCHIVED] });
    await signedIn();
    await openApp("/compte");
    expect(await screen.findByText(/Pas encore de profil/)).toBeOnTheScreen();
  });

  it("sums the Profile up on its Fiche from its read: positioning, Search Criteria, current Master CV, ATS Score", async () => {
    await openProfileFiche();

    expect(await screen.findByText("Positionnement")).toBeOnTheScreen();
    expect(screen.getByText("Responsable logistique, WMS et Lean")).toBeOnTheScreen();
    expect(screen.getByText("Critères de recherche")).toBeOnTheScreen();
    expect(screen.getByText("Poste recherché : Responsable logistique")).toBeOnTheScreen();
    expect(screen.getByText("Lieux : Lyon, Villeurbanne")).toBeOnTheScreen();
    expect(screen.getByText("Contrats : CDI")).toBeOnTheScreen();
    expect(screen.getByText("Télétravail : Sur site, Hybride")).toBeOnTheScreen();
    expect(screen.getByText(/^Salaire : 48\s000 € brut par an minimum$/)).toBeOnTheScreen();
    expect(screen.getByText("CV de référence")).toBeOnTheScreen();
    expect(screen.getByText("Version 4 · Marie Dupont")).toBeOnTheScreen();
    expect(screen.getByText("ATS Score")).toBeOnTheScreen();
    expect(screen.getByText("74/100")).toBeOnTheScreen();
    expect(mockWeb.app.reads).toContainEqual({ path: "/api/profiles/prof_lyon", as: EMAIL });
  });

  it("says a Search Criterion left empty is not specified, and an ATS Score not yet computed", async () => {
    await openProfileFiche(PURCHASING.id);
    expect(await screen.findByText("Lieux : Non précisé")).toBeOnTheScreen();
    expect(screen.getByText(/^Pas encore calculé/)).toBeOnTheScreen();
  });

  it("titles a Profile's page with its name, an Archived Profile's too, as the web app's read gives it", async () => {
    await openProfileFiche(ARCHIVED.id);
    await waitFor(() => expect(title("Ancien profil commerce")).toBeOnTheScreen());
    expect(screen.getByText("Poste recherché : Acheteuse industrielle")).toBeOnTheScreen();
  });
});

describe("Profiles, while they load or cannot be read", () => {
  it("titles the page neutrally until the Profile is read, never with another Profile's name", async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    // The Profile's read waits; the legal steps the app reads first once signed in (#689) do not.
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (new Request(input, init).url.includes("/api/profiles/")) await answered;
      return mockWeb.app.fetch(input, init);
    });
    await signedIn();
    await openApp("/profils/prof_lyon");

    expect(title("Profil")).toBeOnTheScreen();
    await userEvent.setup().press(button("Fiche"));
    expect(screen.getByText("Chargement…")).toBeOnTheScreen();
    await act(async () => answer());
    await waitFor(() => expect(title("Supply chain à Lyon")).toBeOnTheScreen());
    expect(screen.queryByText("Chargement…")).toBeNull();
  });

  it("says a Profile that is not the Candidate's cannot be found", async () => {
    await openProfileFiche("prof_de_quelquun_d_autre");
    expect(await screen.findByText(/Ce profil est introuvable/)).toBeOnTheScreen();
    expect(title("Profil")).toBeOnTheScreen();
  });

  it("says when the Profiles could not be read, and « Réessayer » reads them again", async () => {
    // Failing twice in a row (the read is tried again once, by itself): the person is told, and tries again.
    mockWeb.app.failNext("/api/profiles", 500, 2);
    await signedIn();
    await openApp("/compte");
    expect(await screen.findByText(/n'a pas pu être chargé/, {}, { timeout: 10_000 })).toBeOnTheScreen();
    await userEvent.setup().press(button("Réessayer"));
    expect(await screen.findByRole("link", { name: "Supply chain à Lyon" })).toBeOnTheScreen();
  });

  it("without network, says the Profile reads once the network returns, and reads it then", async () => {
    mockNetwork.connected = false;
    await openProfileFiche();
    expect(await screen.findByText(/se chargera dès le retour du réseau/)).toBeOnTheScreen();
    expect(mockWeb.app.reads).toEqual([]);

    await act(() => setNetwork(true));
    expect(await screen.findByText("Responsable logistique, WMS et Lean")).toBeOnTheScreen();
  });
});

describe("Profiles, read only", () => {
  it("offers nothing to change in the app but « Modifier », which opens the web page", async () => {
    await openProfileFiche();
    await screen.findByText("Positionnement");
    const actions = screen.getAllByRole("button").map((control) => control.props.accessibilityLabel as string);
    expect(actions.filter((label) => /modifier|enregistrer|supprimer|archiver/i.test(label))).toEqual(["Modifier le profil"]);
  });
});

describe("Profiles, « Modifier » on the web", () => {
  it("opens the Profile's web page in a WebView, full page over the Fiche on a phone", async () => {
    await openProfileFiche();
    await userEvent.setup().press(await screen.findByRole("button", { name: "Modifier le profil" }));

    expect(lastWebView().source.uri).toBe("https://jobbbox.ai/profils/prof_lyon");
    expect(screen.getByTestId("webview")).toBeOnTheScreen();
    expect(screen.queryByText("Positionnement")).toBeNull();
    await userEvent.setup().press(button("Fermer"));
    expect(screen.getByText("Positionnement")).toBeOnTheScreen();
  });

  it("opens it in the Work Pane column on a tablet, beside the conversation", async () => {
    setWindow(IPAD_LANDSCAPE);
    await signedIn();
    await openApp("/profils/prof_lyon");
    await userEvent.setup().press(await screen.findByRole("button", { name: "Modifier le profil" }));

    expect(screen.getByTestId("webview")).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
  });

  it("keeps the WebView on jobbbox.ai: any other address opens in the system browser", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await openProfileFiche();
    await userEvent.setup().press(await screen.findByRole("button", { name: "Modifier le profil" }));

    expect(lastWebView().onShouldStartLoadWithRequest({ url: "https://jobbbox.ai/profils/prof_lyon/cv" })).toBe(true);
    expect(openURL).not.toHaveBeenCalled();
    expect(lastWebView().onShouldStartLoadWithRequest({ url: "https://www.linkedin.com/in/marie" })).toBe(false);
    expect(openURL).toHaveBeenCalledWith("https://www.linkedin.com/in/marie");
  });
});

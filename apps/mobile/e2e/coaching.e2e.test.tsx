// End-to-end for Mes coachs humains in the app (#694) through the app's real entry: Expo Router mounts src/app/coachs.
// The web app is faked at the network: its session endpoints (src/session/testing) and its coaching routes
// (./coaching-web), which answer only to a request carrying the signed-in Candidate's session cookie. Only the device's
// native modules are faked: the in-app browser (expo-web-browser), the WebViews, the system's browser (Linking).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, screen, userEvent, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Dimensions, Linking, Platform } from "react-native";
import { fakeWebView } from "../src/testing-device";
import { CGV_VERSION, CHECKOUT_URL, serveCoaching } from "./coaching-web";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));

/**
 * The in-app browser (SFSafariViewController, Chrome Custom Tabs): `opened` is what it was opened on; it stays open until
 * the person closes it (`close()`) or the app dismisses it, as on iOS, where `openBrowserAsync` resolves then.
 */
const mockBrowser = {
  opened: [] as string[],
  dismissed: 0,
  close: () => {},
};
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (url: string) =>
    new Promise((resolve) => {
      mockBrowser.opened.push(url);
      mockBrowser.close = () => resolve({ type: "cancel" });
    }),
  dismissBrowser: async () => {
    mockBrowser.dismissed++;
    mockBrowser.close();
    return { type: "dismiss" };
  },
}));

// The web app the app signs in to (#685), as agenda.e2e.test.tsx fakes it.
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

const button = (name: string | RegExp) => screen.getByRole("button", { name });

let web: ReturnType<typeof serveCoaching>;
/** Signed in, the web app serving Mes coachs humains (`changed` before the page reads it), the page opened at `url`. */
async function launch(url = "/coachs", changed: (route: typeof web) => void = () => {}) {
  await signedIn();
  web = serveCoaching(mockWeb.app, EMAIL);
  changed(web);
  await renderRouter("./src/app", { initialUrl: url });
}
/** Mes coachs humains, once its Coaching Sessions and Human Coaches are read from the web app. */
async function openCoaches() {
  await launch();
  await screen.findByRole("heading", { name: "Mes séances payées" });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockBrowser.opened = [];
  mockBrowser.dismissed = 0;
  fakeWebView.reset();
  await AsyncStorage.clear();
  const size = { width: 390, height: 844, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
  Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Mes coachs humains, read from the web app", () => {
  it("lists the Coaching Sessions with their status, then the Human Coaches to book, as the menu's card on the web", async () => {
    await openCoaches();

    const dated = screen.getByLabelText(/^Séance avec Claire Martin, le/);
    expect(within(dated).getByText("Durée : 60 minutes")).toBeOnTheScreen();
    expect(within(dated).getByText("Date modifiée par Claire Martin")).toBeOnTheScreen();
    expect(within(dated).getByText("Préparer l'entretien Aéroline")).toBeOnTheScreen();
    const toSchedule = screen.getByLabelText("Séance avec Paul Durand, payée le 18 octobre 2026");
    expect(within(toSchedule).getByText("Pas encore de date : réservez votre créneau sur Cal.com, puis saisissez la date.")).toBeOnTheScreen();

    expect(screen.getByRole("heading", { name: "Choisir un coach" })).toBeOnTheScreen();
    expect(screen.getByText("Coach carrière, 15 ans de RH.")).toBeOnTheScreen();
    expect(screen.getByText("Claire Martin a accès à vos profils et candidatures.")).toBeOnTheScreen();
    expect(screen.getByText("Paul Durand n'a pas accès à vos profils et candidatures.")).toBeOnTheScreen();
    expect(button("Réserver une séance avec Paul Durand")).toBeOnTheScreen();
  });

  it("shows the price of a Coaching Session the Candidate pays, and no Plan's price, name or upgrade (App Store 3.1.1)", async () => {
    await openCoaches();

    expect(screen.getByText("Prix d'une séance : 72,00 €")).toBeOnTheScreen();
    expect(screen.queryByText(/offre|abonnement|Premium|90,00/i)).toBeNull();
  });

  it("opens a Human Coach's Cal.com page for a Coaching Session to schedule", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await openCoaches();

    await userEvent.setup().press(button("Choisir mon créneau avec Paul Durand sur Cal.com"));

    expect(open).toHaveBeenCalledWith("https://cal.com/paul-durand");
  });

  it("books nothing while the price cannot be read, and says so", async () => {
    await launch("/coachs", (route) => (route.coaching = { ...route.coaching, price: null }));

    expect(await screen.findByText("Le paiement des séances n'est pas encore disponible.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Réserver/ })).toBeNull();
  });
});

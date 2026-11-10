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
  it("uses the Candidate’s Montréal clock beside Paris in the future join hint",async()=>{
    await launch("/coachs",route=>{route.coaching.timeZone="America/Montreal";route.coaching.sessions[0]={...route.coaching.sessions[0]!,scheduledAt:"2030-11-12T14:30:00Z",meeting:{kind:"video",target:"https://meet.google.com/test",confirmed:false}};});
    const hint=await screen.findByText(/Le lien apparaît/);
    expect(hint.props.children).toContain("09:20");expect(hint.props.children).toContain("America/Montreal");expect(hint.props.children).toContain("15:20");expect(hint.props.children).toContain("Europe/Paris");
  });
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

const CGV_BOX = "J'accepte les CGV (version du 01/10/2026)";
const IMMEDIATE_BOX = /^Je demande que le service commence immédiatement/;

/** Mes coachs humains, then « Réserver une séance avec Paul Durand »: the Order page, read from the web app. */
async function openOrder() {
  await openCoaches();
  await userEvent.setup().press(button("Réserver une séance avec Paul Durand"));
  await screen.findByText("Séance de coaching avec Paul Durand");
}

/** The Order confirmed, both boxes ticked: Stripe Checkout opens in the in-app browser, which stays open. */
async function pay() {
  await openOrder();
  const user = userEvent.setup();
  await user.press(screen.getByRole("checkbox", { name: CGV_BOX }));
  await user.press(screen.getByRole("checkbox", { name: IMMEDIATE_BOX }));
  await user.press(button("Passer au paiement"));
  await act(async () => {});
}

describe("« Réserver »: the Order, then Stripe Checkout in the in-app browser (ADR-0074, App Store 3.1.3(d))", () => {
  it("shows the Order as the web's Order page: the Human Coach, the price all taxes included, the two boxes, neither ticked", async () => {
    await openOrder();

    expect(screen).toHavePathname("/coachs/commande");
    expect(screen.getByText("72,00 € TTC")).toBeOnTheScreen();
    expect(screen.getByText("Vendu par")).toBeOnTheScreen();
    expect(screen.getByText("Jobbbox")).toBeOnTheScreen();
    expect(screen.getByText("Paiement unique, sans reconduction")).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: CGV_BOX })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: IMMEDIATE_BOX })).not.toBeChecked();
    expect(screen.getByText(/^Facultatif : sans cette demande/)).toBeOnTheScreen();
    expect(screen.getByText(/^Vous pourrez vous rétracter pendant 14 jours/)).toBeOnTheScreen();
    // The CGV box first: nothing is sent to the web app before it is ticked.
    expect(button("Passer au paiement")).toBeDisabled();
  });

  it("opens the CGV version to accept in the app", async () => {
    await openOrder();

    await userEvent.setup().press(screen.getByRole("link", { name: "Lire les CGV (version du 01/10/2026)" }));

    expect(screen).toHavePathname(`/legal/cgv/${CGV_VERSION}`);
  });

  it("creates the Checkout Session on the server with the boxes as ticked, and opens it in the in-app browser", async () => {
    await pay();

    expect(web.orders).toEqual([{ coachId: "coach-2", cgv: CGV_VERSION, immediateExecution: "yes" }]);
    expect(mockBrowser.opened).toEqual([CHECKOUT_URL]);
  });

  it("goes on without the Immediate Performance Request, which is never ticked for the Candidate", async () => {
    await openOrder();
    const user = userEvent.setup();
    await user.press(screen.getByRole("checkbox", { name: CGV_BOX }));
    await user.press(button("Passer au paiement"));

    expect(web.orders).toEqual([{ coachId: "coach-2", cgv: CGV_VERSION, immediateExecution: null }]);
    expect(mockBrowser.opened).toEqual([CHECKOUT_URL]);
  });

  it("opens nothing when the server creates no Checkout Session, and says why", async () => {
    await openOrder();
    web.checkout.status = 502;
    const user = userEvent.setup();
    await user.press(screen.getByRole("checkbox", { name: CGV_BOX }));
    await user.press(button("Passer au paiement"));

    expect(await screen.findByText("Le paiement n'a pas pu démarrer. Vérifiez votre connexion et réessayez.")).toBeOnTheScreen();
    expect(mockBrowser.opened).toEqual([]);
  });

  it("asks for the CGV box again when the version in effect changed while the Order was open", async () => {
    await openOrder();
    web.cgv = { version: "2026-11-01", url: "/legal/cgv/2026-11-01" };
    const user = userEvent.setup();
    await user.press(screen.getByRole("checkbox", { name: CGV_BOX }));
    await user.press(button("Passer au paiement"));

    expect(await screen.findByText("Cochez la case « J'accepte les CGV » pour passer au paiement.")).toBeOnTheScreen();
    expect(mockBrowser.opened).toEqual([]);
  });
});

describe("back from Stripe Checkout: the Coaching Session is recorded by Stripe's webhook alone (ADR-0016)", () => {
  /** The system opens the app at Checkout's return address, a universal link, as Expo Router routes it. */
  const universalLink = (path: string) => act(() => router.navigate(path));

  it("comes back by the universal link after paying: closes the in-app browser and waits for the webhook, then shows the Human Coach's booking link", async () => {
    await pay();
    const readsBefore = web.reads;

    await universalLink("/coachs/paiement");

    expect(mockBrowser.dismissed).toBe(1);
    expect(screen).toHavePathname("/coachs");
    expect(await screen.findByText("Paiement reçu. Nous attendons sa confirmation par Stripe : votre séance apparaît ici dans un instant.")).toBeOnTheScreen();
    // Nothing is recorded from the return: the page waits, reading the web app again, until the webhook has come.
    expect(screen.getAllByRole("button", { name: "Choisir mon créneau avec Paul Durand sur Cal.com" })).toHaveLength(1);
    web.paid("coach-2", "s3");

    expect(await screen.findByText(/^Votre séance avec Paul Durand est payée/, {}, { timeout: 10_000 })).toBeOnTheScreen();
    expect(web.reads).toBeGreaterThan(readsBefore);
    expect(screen.queryByText(/^Paiement reçu/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Choisir mon créneau avec Paul Durand sur Cal.com" })).toHaveLength(2);
  });

  it("shows the wait while Stripe's webhook has not come, and says so when it is slow, with « Actualiser »", async () => {
    await pay();
    await universalLink("/coachs/paiement");
    expect(await screen.findByText(/^Paiement reçu. Nous attendons sa confirmation/)).toBeOnTheScreen();

    // A minute later, still no webhook: the page stops asking on its own (Expo Router's renderRouter fakes the clock).
    jest.setSystemTime(Date.now() + 61_000);
    expect(await screen.findByText(/^La confirmation tarde/, {}, { timeout: 10_000 })).toBeOnTheScreen();

    web.paid("coach-2", "s3");
    await userEvent.setup().press(button("Actualiser"));
    expect(await screen.findByText(/^Votre séance avec Paul Durand est payée/)).toBeOnTheScreen();
  });

  it("waits all the same when the in-app browser is closed without the universal link: the payment may have gone through", async () => {
    await pay();

    await act(async () => mockBrowser.close());

    expect(screen).toHavePathname("/coachs");
    expect(await screen.findByText("Si vous avez payé, votre séance apparaît ici dès que Stripe a confirmé le paiement.")).toBeOnTheScreen();
    web.paid("coach-2", "s3");
    expect(await screen.findByText(/^Votre séance avec Paul Durand est payée/, {}, { timeout: 10_000 })).toBeOnTheScreen();
  });

  it("waits for nothing when the Candidate left Checkout without paying", async () => {
    await pay();

    await universalLink("/coachs/paiement?annule=1");

    expect(mockBrowser.dismissed).toBe(1);
    expect(await screen.findByText("Paiement annulé : aucune séance n'a été réservée.")).toBeOnTheScreen();
    expect(screen.queryByText(/^Paiement reçu|^Si vous avez payé/)).toBeNull();
    // Read once on coming back to the page, then no more on its own.
    const reads = web.reads;
    await act(async () => void jest.advanceTimersByTime(5_000));
    expect(web.reads).toBe(reads);
  });
});

describe("a Coaching Session's date, entered or corrected in the app (ADR-0027, as on the web)", () => {
  const field = (label: string) => screen.getByLabelText(label);
  const DATE = "Date de la séance (jj/mm/aaaa)";
  const TIME = "Heure, à Paris (hh:mm)";
  const DURATION = "Durée en minutes (facultatif)";
  const VIDEO = "Lien de la visio (facultatif)";
  const NOTE = "Note (facultatif)";

  it("enters the date booked on Cal.com, in French time, with its duration, video link and note", async () => {
    await openCoaches();
    const user = userEvent.setup();

    await user.press(button("J'ai réservé : saisir la date de la séance avec Paul Durand"));
    await user.type(field(DATE), "12/11/2026");
    await user.type(field(TIME), "14:30");
    await user.type(field(DURATION), "45");
    await user.type(field(VIDEO), "https://meet.google.com/abc");
    await user.type(field(NOTE), "Relire mon CV avant");
    await user.press(button("Enregistrer"));

    expect(web.edits).toEqual([{ id: "s2", body: { scheduledAt: "2026-11-12T14:30", durationMinutes: 45, videoLink: "https://meet.google.com/abc", note: "Relire mon CV avant" } }]);
    const dated = await screen.findByLabelText("Séance avec Paul Durand, le jeudi 12 novembre 2026 à 14:30 (Europe/Paris)");
    expect(within(dated).getByText("Durée : 45 minutes")).toBeOnTheScreen();
    expect(within(dated).getByText("Relire mon CV avant")).toBeOnTheScreen();
    expect(screen.queryByLabelText(DATE)).toBeNull();
  });

  it("corrects a dated Coaching Session, its fields filled in as last read, the hour in French time", async () => {
    await openCoaches();
    const user = userEvent.setup();

    await user.press(button("Modifier la date de la séance avec Claire Martin"));
    expect(field(DATE).props.value).toBe("23/10/2026");
    expect(field(TIME).props.value).toBe("11:00");
    expect(field(DURATION).props.value).toBe("60");
    expect(field(VIDEO).props.value).toBe("https://meet.google.com/exemple");
    expect(field(NOTE).props.value).toBe("Préparer l'entretien Aéroline");
    await user.clear(field(TIME));
    await user.type(field(TIME), "15:00");
    await user.press(button("Enregistrer"));

    expect(web.edits).toEqual([{ id: "s1", body: { scheduledAt: "2026-10-23T15:00" } }]);
    expect(await screen.findByLabelText("Séance avec Claire Martin, le vendredi 23 octobre 2026 à 15:00 (Europe/Paris)")).toBeOnTheScreen();
  });

  it("says under each field what the web app refused, and changes nothing", async () => {
    await openCoaches();
    const user = userEvent.setup();

    await user.press(button("J'ai réservé : saisir la date de la séance avec Paul Durand"));
    await user.type(field(DURATION), "2");
    await user.type(field(VIDEO), "meet.google.com/abc");
    await user.press(button("Enregistrer"));

    expect(await screen.findByText("Saisissez la date et l'heure de la séance.")).toBeOnTheScreen();
    expect(screen.getByText("Saisissez une durée entre 5 et 600 minutes, ou laissez vide.")).toBeOnTheScreen();
    expect(screen.getByText("Saisissez un lien qui commence par http:// ou https://, ou laissez vide.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Séance avec Paul Durand, payée le 18 octobre 2026")).toBeOnTheScreen();

    await user.type(field(DATE), "31/02/2026");
    await user.type(field(TIME), "25:00");
    await user.press(button("Enregistrer"));
    expect(await screen.findByText("Cette date n'est pas valide. Saisissez la date et l'heure de la séance.")).toBeOnTheScreen();
  });

  it("closes the form with « Annuler », sending nothing", async () => {
    await openCoaches();
    const user = userEvent.setup();

    await user.press(button("J'ai réservé : saisir la date de la séance avec Paul Durand"));
    await user.press(button("Annuler"));

    expect(screen.queryByLabelText(DATE)).toBeNull();
    expect(web.edits).toEqual([]);
  });
});

describe("« Renoncer au contrat ici » (#511, ADR-0071)", () => {
  it("opens the web's Withdrawal page of a Coaching Session still in its Withdrawal period, in a WebView", async () => {
    await openCoaches();

    expect(screen.queryByRole("button", { name: "Renoncer au contrat ici : séance avec Claire Martin" })).toBeNull();
    await userEvent.setup().press(button("Renoncer au contrat ici : séance avec Paul Durand"));

    expect(screen).toHavePathname("/abonnement/retractation");
    await screen.findByTestId("web-view");
    expect(fakeWebView.shown!.source).toEqual({ uri: "https://staging.jobbbox.ai/abonnement/retractation?contrat=coaching-session%3As2" });
  });
});

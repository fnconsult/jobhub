// End-to-end through the app's real entry: Expo Router mounts src/app (the root layout, the shell, the Sidebar and the
// screens), and a person drives it by what they see and press.
import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { AppState, Dimensions, Linking, Share, type AppStateStatus } from "react-native";
import { designTokens } from "@jobhub/shared/design/tokens";
import type { AppSession } from "../src/session/app-session";
import type { fakeWebApp } from "../src/session/testing";
import { fakeDevice } from "../src/testing-device";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
// The hardware keyboard at the native module's seam (modules/key-commands), as an iPad's would be.
const mockKeyboard = { current: null as null | ReturnType<typeof import("../src/keyboard/fake-hardware-keyboard").fakeHardwareKeyboard> };
jest.mock("../modules/key-commands", () => {
  mockKeyboard.current = jest.requireActual("../src/keyboard/fake-hardware-keyboard").fakeHardwareKeyboard();
  return { nativeHardwareKeyboard: mockKeyboard.current!.keyboard };
});
const keyboard = () => mockKeyboard.current!;

// The web app the app signs in to (#685), as its endpoints answer, and the address the system opens the app with.
// Built when the app first asks for its session, once Expo Linking is the app's (below).
const mockWeb = {} as { app: ReturnType<typeof fakeWebApp>; session: AppSession };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch });
  return { appSession: mockWeb.session };
});
const mockLink = { current: null as string | null, listeners: new Set<() => void>() };
// Not hoisted: it replaces Expo Router's own mock (expo-router/testing-library), whose scheme is not the app's.
jest.doMock("expo-linking", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const subscribe = (listener: () => void) => (mockLink.listeners.add(listener), () => mockLink.listeners.delete(listener));
  return { ...jest.requireActual("expo-linking"), useLinkingURL: () => useSyncExternalStore(subscribe, () => mockLink.current) };
});
/** The system opens the app with `url`, as a universal link or an App Link does. */
const openWith = (url: string) => act(() => ((mockLink.current = url), mockLink.listeners.forEach((listener) => listener())));
const EMAIL = "marie.dupont@example.fr";
/** Signed in, as the app is once its magic link opened it. */
async function signedIn() {
  jest.requireMock("../src/session/instance");
  if ((await mockWeb.session.current()).kind === "signedIn") return;
  await mockWeb.session.askLink(EMAIL);
  await mockWeb.session.openLink(mockWeb.app.linkFor(EMAIL));
}

const window = (width: number, height: number, fontScale = 1) => {
  const size = { width, height, scale: 2, fontScale };
  Dimensions.set({ window: size, screen: size });
};
const PHONE = [390, 844] as const;
const darkMode = { current: "light" as "light" | "dark" };
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => darkMode.current }));
const IPAD_LANDSCAPE = [1366, 1024] as const;

async function launch(initialUrl = "/", { signIn = true } = {}) {
  if (signIn) await signedIn();
  await renderRouter("./src/app", { initialUrl });
}
const button = (name: string) => screen.getByRole("button", { name });
/** The Sidebar, wherever it is: a column, or a drawer (its page behind it hidden from assistive technology). */
const sidebar = () => screen.queryByLabelText("Navigation principale", { hidden: true });
const link = (name: string) => screen.getByRole("link", { name, hidden: true });

describe("Jobbbox app, on a phone", () => {
  beforeEach(() => window(...PHONE));

  it("starts on the conversation, in French, with the coach's AI disclosure", async () => {
    await launch();
    expect(screen.getByText(/Je suis un coach IA, pas une personne/)).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
    expect(button("Joindre un lien ou un document")).toBeOnTheScreen();
  });

  it("writes a message and sends it, « Arrêter » replacing « Envoyer » while the reply streams", async () => {
    await launch();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Votre message"), "Bonjour");
    await user.press(button("Envoyer"));
    expect(screen.getByText("Bonjour")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Envoyer" })).toBeNull();
    await user.press(button("Arrêter"));
    expect(button("Envoyer")).toBeOnTheScreen();
  });

  it("keeps the Sidebar in a drawer: menus, Coach with its Free conversations, then Mon compte at the foot", async () => {
    await launch();
    expect(sidebar()).toBeNull();
    const user = userEvent.setup();
    await user.press(button("Menu"));
    expect(sidebar()).not.toBeNull();
    for (const name of ["Nouvelle conversation", "Mon compte"]) expect(link(name)).toBeOnTheScreen();
    expect(screen.getByText("Coach")).toBeOnTheScreen();
    // « Espace coach » is for a Human Coach only, and nobody is one yet.
    expect(screen.queryByRole("link", { name: "Espace coach" })).toBeNull();
    await user.press(button("Fermer le menu"));
    expect(sidebar()).toBeNull();
  });

  it("opens each menu's empty screen from the drawer and closes the drawer", async () => {
    await launch();
    const user = userEvent.setup();
    await user.press(button("Menu"));
    await user.press(link("Mon compte"));
    expect(sidebar()).toBeNull();
    expect(screen).toHavePathname("/compte");
  });

  it("opens « Réglages de l'app » from the drawer's foot, below Mon compte, « Verrouiller l'app » off", async () => {
    await launch();
    const user = userEvent.setup();
    await user.press(button("Menu"));
    await user.press(link("Réglages de l'app"));
    expect(screen).toHavePathname("/reglages");
    expect(screen.getByText("Réglages de l'app")).toBeOnTheScreen(); // the Top Bar's title, the drawer closed
    expect(screen.getByRole("switch", { name: "Verrouiller l'app" })).not.toBeChecked();
  });

  it("has a « Nouvelle conversation » pencil in the Top Bar", async () => {
    await launch("/compte");
    await userEvent.setup().press(button("Nouvelle conversation"));
    expect(screen).toHavePathname("/conversations/nouvelle");
  });

  it("opens the Work Pane over an Application's Fiche, and « Fermer » returns to the Fiche", async () => {
    await launch("/candidatures/a1");
    const user = userEvent.setup();
    await user.press(button("Fiche"));
    await user.press(button("Ouvrir une Section d'exemple"));
    expect(screen.getByText("Section d'exemple")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Ouvrir une Section d'exemple" })).toBeNull();
    await user.press(button("Fermer"));
    expect(button("Ouvrir une Section d'exemple")).toBeOnTheScreen();
    await user.press(button("Fermer"));
    expect(button("Menu")).toBeOnTheScreen();
  });

  it("has no setting for the text size, and its controls are at least 44 pt", async () => {
    await launch();
    expect(screen.queryByText(/Taille du texte/)).toBeNull();
    expect(button("Menu")).toHaveStyle({ minHeight: 44, minWidth: 44 });
  });

  it("follows the system's theme, light then dark", async () => {
    darkMode.current = "light";
    await launch();
    expect(JSON.stringify(screen.toJSON())).toContain(designTokens.color.background.light);
    await screen.unmount();
    darkMode.current = "dark";
    await launch();
    expect(JSON.stringify(screen.toJSON())).toContain(designTokens.color.background.dark);
    darkMode.current = "light";
  });

  it("opens the Activité full page over the page and its Top Bar, and « Fermer » returns", async () => {
    await launch();
    const user = userEvent.setup();
    await user.press(button("Activité"));
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    expect(screen.queryByLabelText("Votre message")).toBeNull();
    await user.press(button("Fermer"));
    expect(button("Menu")).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
  });
});

describe("Jobbbox app, at the 64rem threshold", () => {
  it("is a phone layout just under 64rem (1023 pt) and columns from 64rem (1024 pt)", async () => {
    window(1023, 768);
    await launch();
    expect(button("Menu")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Activité" })).toBeOnTheScreen();
  });

  it("lays out in columns from exactly 64rem (1024 pt): the Fiche beside the conversation, the Sidebar a drawer for want of 28rem", async () => {
    window(1024, 768);
    await launch("/candidatures/a1");
    expect(screen.getByText(/La Fiche montrera ici/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Fermer" })).toBeNull();
    // 64 - 16 (Sidebar) - 20 (Fiche) - 3 gutters = 25rem, under 28rem: the Sidebar leaves its column.
    expect(sidebar()).toBeNull();
    expect(button("Menu")).toBeOnTheScreen();
  });

  it("keeps the Sidebar a column at 64rem while the conversation keeps 28rem beside it", async () => {
    window(1024, 768);
    await launch("/compte");
    expect(sidebar()).not.toBeNull();
  });

  it("lays out beside the conversation on an iPad in landscape, the Sidebar a column", async () => {
    window(...IPAD_LANDSCAPE);
    await launch();
    expect(sidebar()).not.toBeNull();
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
  });

  it("counts the system's text scale: the same window turns to full pages when the text grows", async () => {
    window(1366, 1024, 1);
    await launch();
    expect(sidebar()).not.toBeNull();
    await screen.unmount();
    window(1366, 1024, 1.5); // 1366 pt / 24 pt = 56.9rem, under 64rem
    await launch();
    expect(sidebar()).toBeNull();
  });
});

describe("Jobbbox app, locked by Face ID or fingerprint", () => {
  let listeners: ((state: AppStateStatus) => void)[] = [];
  beforeEach(() => {
    window(...PHONE);
    fakeDevice.reset();
    listeners = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: () => (listeners = listeners.filter((other) => other !== listener)) };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const awayFor = async (minutes: number) => {
    await act(async () => listeners.forEach((listener) => listener("background")));
    jest.setSystemTime(Date.now() + minutes * 60_000); // the router's tests run on fake timers
    await act(async () => listeners.forEach((listener) => listener("active")));
  };
  const message = () => screen.getByLabelText("Votre message", { includeHiddenElements: true });

  it("turned on in Réglages de l'app, locks on return after 5 minutes away, not before, and Face ID lets back in", async () => {
    await launch("/reglages");
    await act(async () => fireEvent(screen.getByRole("switch", { name: "Verrouiller l'app" }), "valueChange", true));
    expect(fakeDevice.contentProtected).toBe(true);
    const user = userEvent.setup();
    await user.press(button("Menu"));
    await user.press(link("Nouvelle conversation"));

    await awayFor(4);
    expect(message()).toBeVisible();

    fakeDevice.authenticate.mockResolvedValue({ success: false, error: "user_cancel" });
    await awayFor(5);
    expect(message()).not.toBeVisible();
    expect(screen.getByText("Jobbbox est verrouillée")).toBeOnTheScreen();

    fakeDevice.authenticate.mockResolvedValue({ success: true });
    await user.press(button("Déverrouiller"));
    expect(message()).toBeVisible();
    expect(screen).toHavePathname("/conversations/nouvelle");
  });
  const turnOn = async () => {
    await launch("/reglages");
    await act(async () => fireEvent(screen.getByRole("switch", { name: "Verrouiller l'app" }), "valueChange", true));
  };

  it("is a setting of the app, not of the account: absent from Mon compte, and nothing goes to the server", async () => {
    const fetchSpy = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    await launch("/compte");
    expect(screen.queryByRole("switch", { name: "Verrouiller l'app" })).toBeNull();
    await turnOn();
    await awayFor(6);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back on the device's code: with a code only it turns on, and the prompt leaves the code fallback enabled", async () => {
    const { SecurityLevel } = jest.requireActual<typeof import("expo-local-authentication")>("expo-local-authentication");
    fakeDevice.enrolledLevel = SecurityLevel.SECRET;
    await turnOn();
    expect(screen.getByRole("switch", { name: "Verrouiller l'app" })).toBeChecked();
    expect(fakeDevice.authenticate).toHaveBeenCalled();
    for (const [options] of fakeDevice.authenticate.mock.calls) expect(options?.disableDeviceFallback).toBeFalsy();
  });

  it("stays off, and says why, on a device with no Face ID, fingerprint or code", async () => {
    const { SecurityLevel } = jest.requireActual<typeof import("expo-local-authentication")>("expo-local-authentication");
    fakeDevice.enrolledLevel = SecurityLevel.NONE;
    await turnOn();
    expect(screen.getByRole("switch", { name: "Verrouiller l'app" })).not.toBeChecked();
    expect(screen.getByText(/Définissez d'abord Face ID/)).toBeOnTheScreen();
    expect(fakeDevice.contentProtected).toBe(false);
  });

  it("stays unlocked at any length of time away when the setting is off", async () => {
    await launch("/");
    await awayFor(30);
    expect(message()).toBeVisible();
    expect(screen.queryByText("Jobbbox est verrouillée")).toBeNull();
  });

  it("keeps the setting on the device only, and turning it off clears it and the app switcher protection", async () => {
    await turnOn();
    expect(fakeDevice.keychain.size).toBe(1);
    await act(async () => fireEvent(screen.getByRole("switch", { name: "Verrouiller l'app" }), "valueChange", false));
    expect(fakeDevice.keychain.size).toBe(0);
    expect(fakeDevice.contentProtected).toBe(false);
  });
});

describe("Jobbbox app, signing in (#685)", () => {
  beforeEach(async () => {
    window(...PHONE);
    jest.requireMock("../src/session/instance");
    await mockWeb.session.signOut();
  });

  it("asks the email, sends the link, then opens signed in when the link opens it", async () => {
    await launch("/", { signIn: false });
    const user = userEvent.setup();
    expect(screen.queryByLabelText("Votre message")).toBeNull();

    await user.type(await screen.findByLabelText("Votre adresse e-mail"), EMAIL);
    await user.press(button("Recevoir mon lien de connexion"));
    expect(await screen.findByText("En attente du lien…")).toBeOnTheScreen();

    await openWith(mockWeb.app.linkFor(EMAIL));

    expect(await screen.findByLabelText("Votre message")).toBeOnTheScreen();
  });

  it("signs out from Mon compte, back to sign-in", async () => {
    await launch("/compte");
    const user = userEvent.setup();

    await user.press(await screen.findByRole("button", { name: "Se déconnecter" }));

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
  });
});

describe("Jobbbox app, on an iPad with a pointer", () => {
  beforeEach(() => {
    window(...IPAD_LANDSCAPE);
    jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction", activityType: undefined });
    jest.spyOn(Linking, "openURL").mockResolvedValue();
  });
  afterEach(() => jest.restoreAllMocks());

  const rightClick = (name: string) => fireEvent(link(name), "pointerDown", { nativeEvent: { button: 2, pageX: 100, pageY: 200 } });
  const item = (name: string) => screen.getByRole("menuitem", { name });

  it("opens a Free conversation's context menu in the Sidebar by a right click, and shares its link", async () => {
    await launch();
    await rightClick("Me présenter en deux minutes");
    await userEvent.setup().press(item("Partager le lien"));
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ message: "https://jobbbox.ai/conversations/c1" }));
  });

  it("opens an Application's context menu in Mes candidatures by a long press, and « Ouvrir » opens it", async () => {
    await launch("/candidatures");
    const user = userEvent.setup();
    await user.longPress(link("Aéroline · Responsable qualité"));
    await user.press(item("Ouvrir"));
    expect(screen).toHavePathname("/candidatures/a1");
  });

  it("opens a Job Offer's context menu in Recherches d'offres, « Voir l'annonce » opening the posting", async () => {
    await launch("/recherches");
    await rightClick("Responsable qualité · Aéroline");
    await userEvent.setup().press(item("Voir l'annonce"));
    expect(Linking.openURL).toHaveBeenCalledWith("https://www.example.com/offres/aeroline-responsable-qualite");
  });

  it("opens a Job Offer in the Work Pane when pressed", async () => {
    await launch("/recherches");
    await userEvent.setup().press(link("Responsable qualité · Aéroline"));
    expect(screen.getByText(/L'offre s'ouvrira ici/)).toBeOnTheScreen();
  });
});

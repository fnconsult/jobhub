// End-to-end through the app's real entry: Expo Router mounts src/app (the root layout, the shell, the Sidebar and the
// screens), and a person drives it by what they see and press.
import { act, fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Alert, AppState, Dimensions, Linking, Platform, ScrollView, Share, StyleSheet, type AlertButton, type AppStateStatus } from "react-native";
import { designTokens } from "@jobhub/shared/design/tokens";
import type { AppSession } from "../src/session/app-session";
import type { FakeCoachWeb } from "../src/coach/testing";
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
const mockWeb = {} as { app: ReturnType<typeof fakeWebApp>; session: AppSession; coach: FakeCoachWeb };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch });
  // Its API's Coach Conversation routes (#690), as src/coach/testing.ts answers them.
  mockWeb.coach = jest.requireActual("../src/coach/testing").fakeCoachWeb({
    conversations: [
      { id: "c1", title: "Me présenter en deux minutes" },
      { id: "c2", title: "Préparer la négociation du salaire" },
    ],
    reads: {
      "/api/applications": {
        applications: [
          {
            id: "a1",
            title: "Responsable qualité",
            employer: "Aéroline",
            status: "interview",
            matchScore: 82,
            toHandle: "follow_up",
            nextDeadline: null,
            expired: false,
            reportedByYou: false,
            archived: false,
          },
        ],
        toHandle: 1,
        archivedHidden: 0,
      },
      "/api/agenda": { toSchedule: [], days: [] },
    },
  });
  return { appSession: mockWeb.session, appApi: mockWeb.coach.api };
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
/** The device's network as expo-network reports it: connected here, the offline cases live in offline.e2e.test.tsx. */
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));

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
    // Its Context bar and AI Activity (#690), the conversation not started yet.
    expect(screen.getByText("0 / 40 messages · 0 / 12k jetons")).toBeOnTheScreen();
    expect(screen.getByText("Aucun contenu produit par l'IA sur cette page")).toBeOnTheScreen();
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
    await screen.findByRole("link", { name: "Me présenter en deux minutes", hidden: true });
    await rightClick("Me présenter en deux minutes");
    await userEvent.setup().press(item("Partager le lien"));
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ message: "https://jobbbox.ai/conversations/c1" }));
  });

  it("opens an Application's context menu in Mes candidatures by a long press, and « Ouvrir » opens it", async () => {
    await launch("/candidatures");
    await screen.findByText("1 candidature");
    const user = userEvent.setup();
    await user.longPress(link("Responsable qualité · Aéroline"));
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

describe("Jobbbox app, the home page and the menus as their conversations (#690)", () => {
  beforeEach(() => window(...PHONE));

  it("opens on the home page's Introduction, without an AI call, and its Quick actions above the box", async () => {
    await launch();
    expect(screen.getByText(/Je suis un coach IA, pas une personne/)).toBeOnTheScreen();
    expect(screen.getByText("L'application est en cours de construction.")).toBeOnTheScreen();
    for (const name of ["Chercher des offres", "Ajouter une candidature", "Planifier un entretien", "Demander au coach"]) expect(button(name)).toBeOnTheScreen();
    await userEvent.setup().press(button("Planifier un entretien"));
    expect(screen).toHavePathname("/agenda");
  });

  it("shows Mes candidatures as its conversation: its Introduction, its card read from the API, its suggestions", async () => {
    await launch("/candidatures");
    expect(screen.getByText(/Voici vos candidatures en cours/)).toBeOnTheScreen();
    expect(await screen.findByText("1 candidature")).toBeOnTheScreen();
    expect(link("Responsable qualité · Aéroline")).toBeOnTheScreen();
    expect(screen.getByText(/Entretien · Score de correspondance 82 · Relance prête/)).toBeOnTheScreen();
    expect(button("Relance prête : Responsable qualité")).toBeOnTheScreen();
    expect(button("Ajouter une candidature")).toBeOnTheScreen();
    await userEvent.setup().press(button("Chercher des offres"));
    expect(screen).toHavePathname("/recherches");
  });

  it("sends a menu's message to its Subject's conversation, the suggestions gone once something is sent", async () => {
    await launch("/agenda");
    expect(await screen.findByText(/Aucun rendez-vous à venir/)).toBeOnTheScreen();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Votre message"), "Qu'est-ce qui vient ?");
    await user.press(button("Envoyer"));
    expect(mockWeb.coach.asked.at(-1)).toMatchObject({ subject: { kind: "menu", id: "agenda" }, message: "Qu'est-ce qui vient ?", route: "/agenda" });
    expect(screen.queryByRole("button", { name: "Ajouter un entretien" })).toBeNull();
    await user.press(button("Arrêter"));
  });
});

describe("Jobbbox app, the Free conversations in the drawer (#690, ADR-0070)", () => {
  beforeEach(() => window(...PHONE));
  afterEach(() => jest.restoreAllMocks());

  /** The confirming Dialog, the system's, answered by pressing `choice`. */
  const confirmWith = (choice: string) =>
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons?: AlertButton[]) => buttons?.find((each) => each.text === choice)?.onPress?.());
  const openDrawer = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.press(button("Menu"));
  };
  const longPressRow = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.longPress(await screen.findByRole("link", { name, hidden: true }));

  it("lists them under « Coach », as the web app has them, and opens one with its messages", async () => {
    mockWeb.coach.add({ id: "f1", title: "Écrire ma lettre", messages: [{ from: "candidate", text: "Par où commencer ?" }, { from: "coach", text: "Par l'accroche." }] });
    await launch();
    const user = userEvent.setup();
    await openDrawer(user);
    await user.press(await screen.findByRole("link", { name: "Écrire ma lettre", hidden: true }));
    expect(screen).toHavePathname("/conversations/f1");
    expect(await screen.findByText("Par l'accroche.")).toBeOnTheScreen();
    expect(screen.getByText("Écrire ma lettre")).toBeOnTheScreen(); // the Top Bar's title
  });

  it("renames one from its menu", async () => {
    mockWeb.coach.add({ id: "f2", title: "Sans titre" });
    await launch();
    const user = userEvent.setup();
    await openDrawer(user);
    await longPressRow(user, "Sans titre");
    await user.press(screen.getByRole("menuitem", { name: "Renommer" }));
    const name = screen.getByLabelText("Nom de la conversation");
    await user.clear(name);
    await user.type(name, "Mon pitch");
    await user.press(button("Enregistrer"));
    expect(await screen.findByRole("link", { name: "Mon pitch", hidden: true })).toBeOnTheScreen();
    expect(mockWeb.coach.saved.get("f2")?.title).toBe("Mon pitch");
  });

  it("deletes one only once the Dialog confirms it", async () => {
    mockWeb.coach.add({ id: "f3", title: "À supprimer" });
    await launch();
    const user = userEvent.setup();
    await openDrawer(user);

    confirmWith("Annuler");
    await longPressRow(user, "À supprimer");
    await user.press(screen.getByRole("menuitem", { name: "Supprimer" }));
    expect(Alert.alert).toHaveBeenCalledWith("Supprimer la conversation « À supprimer » ?", "Tous ses messages seront supprimés. La Mémoire du coach reste.", expect.anything());
    expect(mockWeb.coach.saved.has("f3")).toBe(true);

    confirmWith("Supprimer");
    await longPressRow(user, "À supprimer");
    await user.press(screen.getByRole("menuitem", { name: "Supprimer" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "À supprimer", hidden: true })).toBeNull());
    expect(mockWeb.coach.saved.has("f3")).toBe(false);
  });

  it("lists a new conversation once its first message is saved, at its own address", async () => {
    await launch("/conversations/nouvelle");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Votre message"), "Un tout nouveau sujet");
    await user.press(button("Envoyer"));
    await act(async () => mockWeb.coach.reply("Allons-y."));
    const saved = [...mockWeb.coach.saved.values()].find((conversation) => conversation.title === "Un tout nouveau sujet")!;
    await waitFor(() => expect(screen).toHavePathname(`/conversations/${saved.id}`));
    expect(await screen.findByText("Allons-y.")).toBeOnTheScreen();
    await openDrawer(user);
    expect(await screen.findByRole("link", { name: "Un tout nouveau sujet", hidden: true })).toBeOnTheScreen();
  });

  it("clears the page's conversation with « Effacer », once the Dialog confirms it", async () => {
    mockWeb.coach.add({ id: "f4", title: "À effacer", messages: [{ from: "candidate", text: "Un vieux message" }] });
    await launch("/conversations/f4");
    await screen.findByText("Un vieux message");
    confirmWith("Effacer");
    await userEvent.setup().press(button("Effacer"));
    expect(Alert.alert).toHaveBeenCalledWith("Effacer cette conversation ?", "Tous les messages de cette conversation seront supprimés. La Mémoire du coach reste.", expect.anything());
    await waitFor(() => expect(screen.queryByText("Un vieux message")).toBeNull());
    expect(mockWeb.coach.saved.has("f4")).toBe(false);
  });
});

describe("Jobbbox app, with the hardware keyboard's other shortcuts (#700)", () => {
  beforeEach(() => window(...IPAD_LANDSCAPE));
  afterEach(() => jest.restoreAllMocks());

  it("hides the Sidebar with ⌘\\ and brings it back", async () => {
    await launch("/compte");
    expect(sidebar()).not.toBeNull();
    await act(() => keyboard().press("⌘\\"));
    expect(sidebar()).toBeNull();
    await act(() => keyboard().press("⌘\\"));
    expect(sidebar()).not.toBeNull();
  });

  it("closes and reopens the Fiche with ⌘I", async () => {
    await launch("/candidatures/a1");
    expect(screen.getByText(/La Fiche montrera ici/)).toBeOnTheScreen();
    await act(() => keyboard().press("⌘I"));
    expect(screen.queryByText(/La Fiche montrera ici/)).toBeNull();
    await act(() => keyboard().press("⌘I"));
    expect(screen.getByText(/La Fiche montrera ici/)).toBeOnTheScreen();
  });

  it("closes the Work Pane with Échap, listed in the panel only while it is open", async () => {
    await launch("/candidatures/a1");
    expect(keyboard().panel().some((entry) => entry.startsWith("Échap"))).toBe(false);
    await userEvent.setup().press(button("Ouvrir une Section d'exemple"));
    expect(keyboard().panel()).toContain("Échap Fermer le volet");
    await act(() => keyboard().press("Échap"));
    expect(screen.queryByText(/Le Work Pane montrera ici/)).toBeNull();
    expect(keyboard().panel().some((entry) => entry.startsWith("Échap"))).toBe(false);
  });

  it("takes Ctrl in place of ⌘ on Android", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await launch("/candidatures/a1");
    expect(keyboard().panel().every((entry) => !entry.includes("⌘"))).toBe(true);
    expect(keyboard().panel()).toContain("Ctrl+N Nouvelle conversation");
    await act(() => keyboard().press("⌘N"));
    expect(screen).toHavePathname("/candidatures/a1");
    await act(() => keyboard().press("Ctrl+N"));
    expect(screen).toHavePathname("/conversations/nouvelle");
  });
});

describe("Jobbbox app, under a pointer's hover (#700)", () => {
  beforeEach(() => window(...IPAD_LANDSCAPE));

  it("highlights an Application's row while the pointer is over it", async () => {
    await launch("/candidatures");
    await screen.findByText("1 candidature");
    const row = link("Responsable qualité · Aéroline");
    const before = StyleSheet.flatten(row.props.style)?.backgroundColor;
    await fireEvent(row, "pointerEnter");
    const over = StyleSheet.flatten(screen.getByRole("link", { name: "Responsable qualité · Aéroline", hidden: true }).props.style)?.backgroundColor;
    expect(over).not.toEqual(before);
    await fireEvent(row, "pointerLeave");
    expect(StyleSheet.flatten(screen.getByRole("link", { name: "Responsable qualité · Aéroline", hidden: true }).props.style)?.backgroundColor).toEqual(before);
  });
});

describe("Jobbbox app, in Split View, Slide Over, Stage Manager and on a foldable (#700)", () => {
  // An iPad Pro 12.9" in landscape is 1366 pt wide: a third is 375 pt, a half 678 pt, two thirds 981 pt.
  const THIRD = [375, 1024] as const;
  const HALF = [678, 1024] as const;
  const TWO_THIRDS = [981, 1024] as const;
  const FOLDED = [360, 740] as const;
  const UNFOLDED = [841, 701] as const;

  it.each([
    ["a third", THIRD],
    ["a half", HALF],
    ["two thirds", TWO_THIRDS],
  ])("lays out as a phone at %s of a landscape iPad, the Sidebar a drawer", async (_name, size) => {
    window(size[0], size[1]);
    await launch();
    expect(sidebar()).toBeNull();
    expect(button("Menu")).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
  });

  it("lays out again as the window changes, keeping the conversation and the draft", async () => {
    window(...IPAD_LANDSCAPE);
    await launch();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Votre message"), "Bonjour");
    await user.press(button("Envoyer"));
    await user.press(button("Arrêter"));
    await user.type(screen.getByLabelText("Votre message"), "Un brouillon");
    for (const size of [THIRD, HALF, TWO_THIRDS, IPAD_LANDSCAPE]) {
      await act(() => window(size[0], size[1]));
      expect(screen.getByText("Bonjour")).toBeOnTheScreen();
      expect(screen.getByLabelText("Votre message")).toHaveDisplayValue("Un brouillon");
    }
    expect(sidebar()).not.toBeNull();
  });

  it("keeps the conversation and the draft when a foldable opens and closes", async () => {
    window(...FOLDED);
    await launch();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Votre message"), "Bonjour");
    await user.press(button("Envoyer"));
    await user.press(button("Arrêter"));
    await user.type(screen.getByLabelText("Votre message"), "Un brouillon");
    for (const size of [UNFOLDED, FOLDED]) {
      await act(() => window(size[0], size[1]));
      expect(screen.getByText("Bonjour")).toBeOnTheScreen();
      expect(screen.getByLabelText("Votre message")).toHaveDisplayValue("Un brouillon");
    }
  });

  it("keeps where the person scrolled the thread when the window changes", async () => {
    window(...IPAD_LANDSCAPE);
    await launch();
    const thread = screen.getByLabelText("Vos échanges avec votre coach");
    const scrollToEnd = (ScrollView.prototype as unknown as { scrollToEnd: jest.Mock }).scrollToEnd;
    scrollToEnd.mockClear();
    fireEvent.scroll(thread, { nativeEvent: { contentOffset: { x: 0, y: 300 }, contentSize: { width: 600, height: 2000 }, layoutMeasurement: { width: 600, height: 500 } } });
    await act(() => window(...HALF));
    fireEvent(screen.getByLabelText("Vos échanges avec votre coach"), "contentSizeChange", 600, 2600);
    expect(scrollToEnd).not.toHaveBeenCalled();
    });
  });

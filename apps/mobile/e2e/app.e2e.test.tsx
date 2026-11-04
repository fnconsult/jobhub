// End-to-end through the app's real entry: Expo Router mounts src/app (the root layout, the shell, the Sidebar and the
// screens), and a person drives it by what they see and press.
import { screen, userEvent } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Dimensions } from "react-native";
import { designTokens } from "@jobhub/shared/design/tokens";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));

const window = (width: number, height: number, fontScale = 1) => {
  const size = { width, height, scale: 2, fontScale };
  Dimensions.set({ window: size, screen: size });
};
const PHONE = [390, 844] as const;
const darkMode = { current: "light" as "light" | "dark" };
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => darkMode.current }));
const IPAD_LANDSCAPE = [1366, 1024] as const;

async function launch(initialUrl = "/") {
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

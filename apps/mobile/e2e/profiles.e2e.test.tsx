// End-to-end for the Profiles (#695) through the app's real entry: Expo Router mounts Mon compte and a Profile's page
// with its Fiche. Only the WebView, a native view, is faked: what it would load, and what it is told to let through,
// is asserted.
import { screen, userEvent } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import type { ReactNode } from "react";
import { Dimensions, Linking } from "react-native";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));

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

async function openProfileFiche() {
  await renderRouter("./src/app", { initialUrl: "/profils/p1" });
  await userEvent.setup().press(button("Fiche"));
}

beforeEach(() => {
  mockWebViews.length = 0;
  setWindow(PHONE);
});

describe("Profiles, to read", () => {
  it("lists the Profiles in Mon compte, each leading to its page", async () => {
    await renderRouter("./src/app", { initialUrl: "/compte" });
    expect(screen.getByText("Profils")).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("link", { name: "Qualité aéronautique" }));
    expect(screen).toHavePathname("/profils/p1");
  });

  it("sums the Profile up on its Fiche: positioning, Search Criteria, current Master CV, ATS Score", async () => {
    await openProfileFiche();

    expect(screen.getByText("Positionnement")).toBeOnTheScreen();
    expect(screen.getByText("Responsable qualité aéronautique, EN 9100 et Part 21")).toBeOnTheScreen();
    expect(screen.getByText("Critères de recherche")).toBeOnTheScreen();
    expect(screen.getByText("Poste recherché : Responsable qualité")).toBeOnTheScreen();
    expect(screen.getByText("Lieux : Toulouse, Bordeaux")).toBeOnTheScreen();
    expect(screen.getByText("Contrats : CDI, CDD")).toBeOnTheScreen();
    expect(screen.getByText("Télétravail : Hybride")).toBeOnTheScreen();
    expect(screen.getByText(/^Salaire : 55\s000 € brut par an minimum$/)).toBeOnTheScreen();
    expect(screen.getByText("CV de référence")).toBeOnTheScreen();
    expect(screen.getByText("Version 3 · Marie Dupont")).toBeOnTheScreen();
    expect(screen.getByText("ATS Score")).toBeOnTheScreen();
    expect(screen.getByText("82/100")).toBeOnTheScreen();
  });

  it("says a Search Criterion left empty is not specified, and an ATS Score not yet computed", async () => {
    await renderRouter("./src/app", { initialUrl: "/profils/p2" });
    await userEvent.setup().press(button("Fiche"));
    expect(screen.getByText("Lieux : Non précisé")).toBeOnTheScreen();
    expect(screen.getByText(/^Pas encore calculé/)).toBeOnTheScreen();
  });

  it("offers nothing to change in the app but « Modifier », which opens the web page", async () => {
    await openProfileFiche();
    const actions = screen.getAllByRole("button").map((control) => control.props.accessibilityLabel as string);
    expect(actions.filter((label) => /modifier|enregistrer|supprimer|archiver/i.test(label))).toEqual(["Modifier le profil"]);
  });
});

describe("Profiles, « Modifier » on the web", () => {
  it("opens the Profile's web page in a WebView, full page over the Fiche on a phone", async () => {
    await openProfileFiche();
    await userEvent.setup().press(button("Modifier le profil"));

    expect(lastWebView().source.uri).toBe("https://jobbbox.ai/profils/p1");
    expect(screen.getByTestId("webview")).toBeOnTheScreen();
    expect(screen.queryByText("Positionnement")).toBeNull();
    await userEvent.setup().press(button("Fermer"));
    expect(screen.getByText("Positionnement")).toBeOnTheScreen();
  });

  it("opens it in the Work Pane column on a tablet, beside the conversation", async () => {
    setWindow(IPAD_LANDSCAPE);
    await renderRouter("./src/app", { initialUrl: "/profils/p1" });
    await userEvent.setup().press(button("Modifier le profil"));

    expect(screen.getByTestId("webview")).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
  });

  it("keeps the WebView on jobbbox.ai: any other address opens in the system browser", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await openProfileFiche();
    await userEvent.setup().press(button("Modifier le profil"));

    expect(lastWebView().onShouldStartLoadWithRequest({ url: "https://jobbbox.ai/profils/p1/cv" })).toBe(true);
    expect(openURL).not.toHaveBeenCalled();
    expect(lastWebView().onShouldStartLoadWithRequest({ url: "https://www.linkedin.com/in/marie" })).toBe(false);
    expect(openURL).toHaveBeenCalledWith("https://www.linkedin.com/in/marie");
  });
});

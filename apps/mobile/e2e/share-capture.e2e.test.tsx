// End-to-end for Share capture in the app (#697) through the app's real entry: Expo Router mounts src/app, opened by the
// share link the iOS share extension and the Android share intent open it with (`shareLink`, @jobhub/shared). The web
// app is faked at the network: its session endpoints (src/session/testing), its Coach Conversation routes
// (src/coach/testing) and its Share capture and Match Score routes (./share-web), which answer only to a request
// carrying the signed-in Candidate's session cookie. The page is never read on the device: only the web app is asked.
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { shareLink } from "@jobhub/shared";
import type { ProfileResponse } from "@jobhub/shared/reads";
import { router } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Dimensions } from "react-native";
import { withCoach, type FakeCoachWeb } from "../src/coach/testing";
import type { AppSession } from "../src/session/app-session";
import type { fakeWebApp } from "../src/session/testing";
import { LINKEDIN_URL, OFFER_TEXT, READABLE_URL, serveShareCapture, type ShareRoute } from "./share-web";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));

const mockWeb = {} as { app: ReturnType<typeof fakeWebApp>; session: AppSession; coach: FakeCoachWeb };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch, webViewCookies: memoryWebViewCookies() });
  mockWeb.coach = jest.requireActual("../src/coach/testing").fakeCoachWeb();
  return { appSession: mockWeb.session };
});
// The address the system opens the app with: the share link, or a magic link.
const mockLink = { current: null as string | null, listeners: new Set<() => void>() };
jest.doMock("expo-linking", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const subscribe = (listener: () => void) => (mockLink.listeners.add(listener), () => mockLink.listeners.delete(listener));
  return { ...jest.requireActual("expo-linking"), useLinkingURL: () => useSyncExternalStore(subscribe, () => mockLink.current) };
});
const openWith = (url: string) => act(() => ((mockLink.current = url), mockLink.listeners.forEach((listener) => listener())));

const EMAIL = "marie.dupont@example.fr";
const CV = { fullName: "Marie Dupont", headline: "Directrice financière", email: EMAIL, phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: ["IFRS"], languages: [] };
const FINANCE: ProfileResponse = {
  id: "prof_finance",
  name: "Finance à Lyon",
  archived: false,
  searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
  masterCv: { version: 1, content: CV },
  atsScore: null,
};

let share: ShareRoute;
/** The web app at the network, its Share capture routes before the rest. */
function serveWebApp() {
  jest.requireMock("../src/session/instance");
  const served = serveShareCapture(mockWeb.app, mockWeb.coach, EMAIL, withCoach(mockWeb.coach, (input, init) => mockWeb.app.fetch(input, init)));
  share = served.route;
  jest.spyOn(globalThis, "fetch").mockImplementation(served.fetch);
}
async function signedIn() {
  jest.requireMock("../src/session/instance");
  if ((await mockWeb.session.current()).kind === "signedIn") return;
  await mockWeb.session.askLink(EMAIL);
  await mockWeb.session.openLink(mockWeb.app.linkFor(EMAIL));
}
/** The app opened by the share sheet on `shared`, signed in unless said. */
async function sharedFromAnotherApp(shared: { url?: string; text?: string }, { signIn = true } = {}) {
  if (signIn) await signedIn();
  serveWebApp();
  const link = shareLink(shared);
  mockLink.current = link;
  await renderRouter("./src/app", { initialUrl: link.replace(/^jobbbox:\/\//, "/") });
}
const button = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  const size = { width: 390, height: 844, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
  mockLink.current = null;
  mockWeb.app?.has(EMAIL, { profiles: [FINANCE] });
});
afterEach(() => jest.restoreAllMocks());

describe("Share capture: « Partager → Jobbbox » from another app (#697)", () => {
  it("opens on the capture screen with what was shared, sends it to the web app, and opens the Private Job Offer in its conversation", async () => {
    await sharedFromAnotherApp({ url: READABLE_URL, text: `Regarde cette offre ${READABLE_URL}` });

    expect(await screen.findByRole("heading", { name: "Partager vers Jobbbox" })).toBeOnTheScreen();
    expect(screen.getByLabelText("Lien de l'offre").props.value).toBe(READABLE_URL);
    await userEvent.setup().press(button("Envoyer à Jobbbox"));

    expect(await screen.findByText("Offre partagée depuis une autre app : Directeur administratif et financier H/F")).toBeOnTheScreen();
    expect(screen.getByText(/Offre ajoutée · Directeur administratif et financier H\/F · Groupe Seb · À traiter/)).toBeOnTheScreen();
    expect(button("Scorer contre mon profil")).toBeOnTheScreen();
    expect(share.sent).toEqual([{ url: READABLE_URL, text: `Regarde cette offre ${READABLE_URL}` }]);
  });

  it("asks to share or paste the offer's text where the site refuses to be read, then creates it from the text", async () => {
    await sharedFromAnotherApp({ text: `Découvrez cette offre sur LinkedIn ${LINKEDIN_URL}` });
    const user = userEvent.setup();

    await user.press(await screen.findByRole("button", { name: "Envoyer à Jobbbox" }));
    expect(await screen.findByText(/Ce site ne laisse pas Jobbbox lire ses offres. Partagez ou collez le texte de l'offre/)).toBeOnTheScreen();

    await user.clear(screen.getByLabelText("Texte de l'offre"));
    await user.paste(screen.getByLabelText("Texte de l'offre"), OFFER_TEXT);
    await user.press(button("Envoyer à Jobbbox"));

    expect(await screen.findByText("Offre partagée depuis une autre app : Contrôleur de gestion H/F")).toBeOnTheScreen();
    expect(share.sent.at(-1)).toEqual({ url: LINKEDIN_URL, text: OFFER_TEXT });
  });

  it("creates the offer from a text shared alone", async () => {
    await sharedFromAnotherApp({ text: OFFER_TEXT });

    await userEvent.setup().press(await screen.findByRole("button", { name: "Envoyer à Jobbbox" }));

    expect(await screen.findByText("Offre partagée depuis une autre app : Contrôleur de gestion H/F")).toBeOnTheScreen();
    expect(share.sent).toEqual([{ text: OFFER_TEXT }]);
  });

  it("asks to sign in first, then comes back to the capture screen with what was shared", async () => {
    await sharedFromAnotherApp({ url: READABLE_URL }, { signIn: false });

    await mockWeb.session.askLink(EMAIL);
    await openWith(mockWeb.app.linkFor(EMAIL));

    expect(await screen.findByRole("heading", { name: "Partager vers Jobbbox" })).toBeOnTheScreen();
    expect(screen.getByLabelText("Lien de l'offre").props.value).toBe(READABLE_URL);
  });

  it("keeps nothing once sent: back on the home page, a new conversation has no share to send", async () => {
    await sharedFromAnotherApp({ url: READABLE_URL });
    await userEvent.setup().press(await screen.findByRole("button", { name: "Envoyer à Jobbbox" }));
    await screen.findByText(/Offre partagée depuis une autre app/);

    await act(() => router.navigate("/partage"));

    expect(await screen.findByText(/Rien n'a été partagé/)).toBeOnTheScreen();
  });

  it("scores the Job Offer against the Profile, the Plan Quota applied, its refusal shown with nothing to buy", async () => {
    await sharedFromAnotherApp({ url: READABLE_URL });
    const user = userEvent.setup();
    await user.press(await screen.findByRole("button", { name: "Envoyer à Jobbbox" }));

    await user.press(await screen.findByRole("button", { name: "Scorer contre mon profil" }));
    expect(await screen.findByText("Score de correspondance : 78 / 100 contre « Finance à Lyon »")).toBeOnTheScreen();
    expect(share.scored).toEqual([{ jobOfferId: "offre-1", profileId: "prof_finance" }]);

    share.quotaReached = true;
    await user.press(button("Scorer contre mon profil"));
    expect(await screen.findByText("Limite atteinte")).toBeOnTheScreen();
    expect(screen.getByText(/Vous avez utilisé vos 5 scores de correspondance/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Passer à Premium/ })).toBeNull();
    await waitFor(() => expect(screen.getByText(/jobbbox\.ai/)).toBeOnTheScreen());
  });
});

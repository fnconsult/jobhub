// End-to-end for « + » in the box (#696) through the app's real entry: Expo Router -> layout -> shell -> Coach
// Conversation. The system's document picker and clipboard, and the drop of a document or link on a tablet, are what
// the person does; the web app's API is faked at the network (src/coach/testing.ts), and what it receives is asserted.
import { act, fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { renderRouter } from "expo-router/testing-library";
import { Dimensions } from "react-native";
import { withCoach, type FakeCoachWeb } from "../src/coach/testing";
import type { AppSession } from "../src/session/app-session";
import type { fakeWebApp } from "../src/session/testing";
import type { DroppedItem } from "../src/attach/attachment";

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

// The web app the app signs in to (#685), so the app's root reaches its signed-in screens, as app.e2e.test.tsx does.
const mockWeb = {} as { app: ReturnType<typeof fakeWebApp>; session: AppSession; coach: FakeCoachWeb };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch, passkeys: mockWeb.app.deviceWithoutPasskey(), webViewCookies: memoryWebViewCookies() });
  // Its API's Coach Conversation routes (#690), as src/coach/testing.ts answers them.
  mockWeb.coach = jest.requireActual("../src/coach/testing").fakeCoachWeb();
  return { appSession: mockWeb.session };
});
// As app.e2e.test.tsx: the app's own scheme, which the magic link it asks for returns to (Expo Router's mock has another).
const mockLink = { current: null as string | null, listeners: new Set<() => void>() };
jest.doMock("expo-linking", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  const subscribe = (listener: () => void) => (mockLink.listeners.add(listener), () => mockLink.listeners.delete(listener));
  return { ...jest.requireActual("expo-linking"), useLinkingURL: () => useSyncExternalStore(subscribe, () => mockLink.current) };
});
const EMAIL = "marie.dupont@example.fr";
/** Signed in, as the app is once its magic link opened it. */
async function signedIn() {
  jest.requireMock("../src/session/instance");
  if ((await mockWeb.session.current()).kind === "signedIn") return;
  await mockWeb.session.askLink(EMAIL);
  await mockWeb.session.openLink(mockWeb.app.linkFor(EMAIL));
}

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-clipboard", () => ({ getStringAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({
  File: function MockFile(this: { uri: string; exists: boolean; delete: () => void }, uri: string) {
    this.uri = uri;
    this.exists = true;
    this.delete = () => {};
  },
}));

const MB = 1024 * 1024;
const PDF = "application/pdf";
const button = (name: string) => screen.getByRole("button", { name });

async function launch() {
  jest.spyOn(globalThis, "fetch").mockImplementation(withCoach(mockWeb.coach, (input, init) => mockWeb.app.fetch(input, init)));
  await renderRouter("./src/app", { initialUrl: "/" });
  await waitFor(() => expect(screen.queryByLabelText("Ouverture de votre compte…")).toBeNull());
}
const cvSent = () => mockWeb.coach.requests.filter((request) => request.path === "/api/cv/draft");
function picks(file: { name: string; size: number; mimeType: string } | null) {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(
    file ? { canceled: false, assets: [{ uri: `file:///cache/${encodeURIComponent(file.name)}`, lastModified: 0, ...file }] } : { canceled: true, assets: null },
  );
}
async function choose(item: string) {
  const user = userEvent.setup();
  await user.press(button("Joindre un lien ou un document"));
  await user.press(screen.getByRole("menuitem", { name: item }));
}
const drop = (items: DroppedItem[]) => act(async () => fireEvent(screen.getByLabelText("Votre message"), "dropItems", { nativeEvent: { items } }));

describe("« + » in the box, in the app (#696)", () => {
  beforeEach(async () => {
    await signedIn();
    // A fresh web app each time: what it was sent by the last test is not this one's.
    mockWeb.coach = jest.requireActual("../src/coach/testing").fakeCoachWeb();
  });
  afterEach(() => jest.restoreAllMocks());

  it("offers a Job Offer's link and a CV, and no photo of a job posting", async () => {
    await launch();
    await userEvent.setup().press(button("Joindre un lien ou un document"));
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.getByRole("menuitem", { name: "Coller un lien d'offre" })).toBeOnTheScreen();
    expect(screen.getByRole("menuitem", { name: "Joindre un CV" })).toBeOnTheScreen();
  });

  it("« Coller un lien d'offre » sends the clipboard's link in the message", async () => {
    const url = "https://www.welcometothejungle.com/fr/companies/aeroline/jobs/responsable-qualite";
    jest.mocked(Clipboard.getStringAsync).mockResolvedValue(url);
    await launch();
    await choose("Coller un lien d'offre");
    await waitFor(() => expect(mockWeb.coach.asked).toEqual([{ message: url, route: "/" }]));
  });

  it("« Joindre un CV » opens the system's picker and sends the file to api/cv/draft", async () => {
    picks({ name: "Marie Dupont.pdf", size: 300_000, mimeType: PDF });
    await launch();
    await choose("Joindre un CV");
    await waitFor(() => expect(mockWeb.coach.cvs).toEqual([{ field: "cv", uri: "file:///cache/Marie%20Dupont.pdf", name: "Marie Dupont.pdf", type: PDF }]));
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: [PDF, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] }),
    );
  });

  it("refuses a file over 10 MB before sending it", async () => {
    picks({ name: "CV.pdf", size: 12 * MB, mimeType: PDF });
    await launch();
    await choose("Joindre un CV");
    expect(await screen.findByText("Ce fichier dépasse 10 Mo. Enregistrez votre CV dans un fichier plus léger et réessayez.")).toBeOnTheScreen();
    expect(cvSent()).toHaveLength(0);
  });

  it("refuses a file of another format before sending it", async () => {
    picks({ name: "CV.doc", size: 200_000, mimeType: "application/msword" });
    await launch();
    await choose("Joindre un CV");
    expect(await screen.findByText(/Ce fichier n'est pas un CV au format PDF ou Word/)).toBeOnTheScreen();
    expect(cvSent()).toHaveLength(0);
  });

  describe("on a tablet", () => {
    const size = { width: 1366, height: 1024, scale: 2, fontScale: 1 };
    beforeEach(() => Dimensions.set({ window: size, screen: size }));

    it("reads a PDF dropped on the box as « Joindre un CV » does", async () => {
      await launch();
      await drop([{ kind: "file", uri: "file:///cache/dropped/CV.pdf", name: "CV.pdf", size: 300_000, mimeType: PDF }]);
      await waitFor(() => expect(mockWeb.coach.cvs).toEqual([{ field: "cv", uri: "file:///cache/dropped/CV.pdf", name: "CV.pdf", type: PDF }]));
    });

    it("refuses a dropped file over 10 MB before sending it", async () => {
      await launch();
      await drop([{ kind: "file", uri: "file:///cache/dropped/CV.docx", name: "CV.docx", size: 11 * MB, mimeType: null }]);
      expect(await screen.findByText(/Ce fichier dépasse 10 Mo/)).toBeOnTheScreen();
      expect(cvSent()).toHaveLength(0);
    });

    it("sends a dropped link as « Coller un lien d'offre » does", async () => {
      const url = "https://candidat.francetravail.fr/offres/recherche/detail/123ABC";
      await launch();
      await drop([{ kind: "text", text: url }]);
      await waitFor(() => expect(mockWeb.coach.asked).toEqual([{ message: url, route: "/" }]));
    });
  });
});

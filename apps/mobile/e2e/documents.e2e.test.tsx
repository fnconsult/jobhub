// End-to-end for an Application's Tailored Documents (#695) through the app's real entry: Expo Router mounts the
// Application's page with its Fiche, which reads the Candidate's own documents from the web app
// (`GET /api/applications/:id/documents`, #684), faked at its fetch as it answers them, and the real system-documents
// module downloads (through the app's fetch, its redirects followed on the web app alone, #756), shows and shares them.
// Only the device's native modules (expo-file-system, expo-sharing, React Native's Share) are faked besides, and what
// reaches the device's cache, the system's PDF reader and its share sheet is asserted.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApplicationResponse, TailoredDocumentsResponse } from "@jobhub/shared/reads";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { router } from "expo-router";
import { AppState, Dimensions, Share } from "react-native";

jest.setTimeout(60_000);

/** The app opened at `initialUrl`, past the legal steps it reads first once signed in (#689). */
async function openApp(initialUrl: string) {
  await renderRouter("./src/app", { initialUrl });
  await waitFor(() => expect(screen.queryByLabelText("Ouverture de votre compte…")).toBeNull());
}

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
/** The device's network as expo-network reports it: connected (offline.e2e.test.tsx has the offline cases). */
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));

// Signed in, as the app is once its magic link opened it (#685): the web app's endpoints faked at the session's fetch.
const mockWeb = {} as { app: ReturnType<typeof import("../src/session/testing").fakeWebApp>; session: import("../src/session/app-session").AppSession };
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, TEST_BASE_URL } = jest.requireActual("../src/session/testing");
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: mockWeb.app.fetch, passkeys: mockWeb.app.deviceWithoutPasskey() });
  // The app's fetch (expo/fetch in the app): the global one, faked below as the web app answers it.
  return { appSession: mockWeb.session, appFetch: (input: RequestInfo, init?: RequestInit) => globalThis.fetch(input, init) };
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

/** The downloads asked of the web app's export routes: the address, the headers sent with it. */
const mockDownloads: { url: string; headers: Record<string, string> | undefined }[] = [];
const mockPreview = jest.fn<Promise<void>, [string, unknown]>(async () => {});
const mockShare = jest.fn<Promise<void>, [string, unknown]>(async () => {});
const mockFailNextDownload = { current: false };
/** What is in the app's cache on the device: the files' addresses. */
const mockFiles = new Set<string>();

jest.mock("expo-sharing", () => ({ shareAsync: (uri: string, options: unknown) => mockShare(uri, options) }));
jest.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? `${part}/` : part.uri)).join("");
    }
    get exists() {
      return [...mockFiles].some((file) => file.startsWith(this.uri));
    }
    create() {}
    delete() {
      for (const file of mockFiles) if (file.startsWith(this.uri)) mockFiles.delete(file);
    }
  }
  class File {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("");
    }
    create() {}
    async write() {
      mockFiles.add(this.uri);
    }
    preview(options: unknown) {
      return mockPreview(this.uri, options);
    }
  }
  return { Directory, File, Paths: { cache: { uri: "file:///cache/" } } };
});

const PHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };
const setWindow = ({ width, height }: { width: number; height: number }) => {
  const size = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
};
const button = (name: string | RegExp) => screen.getByRole("button", { name });

/** Marie's own Application on the web app, as `GET /api/applications/:id` answers it, and its Tailored Documents. */
const APPLICATION: ApplicationResponse = {
  id: "app_rhone",
  status: "applied",
  statusChangedAt: "2026-11-02T09:00:00.000Z",
  createdAt: "2026-10-28T09:00:00.000Z",
  jobOffer: { id: "offer_rhone", title: "Responsable logistique", employer: "Rhône Distribution", location: "Lyon", url: null, postedAt: null, expiredAt: null },
  profile: { id: "prof_lyon", name: "Supply chain à Lyon" },
  matchScore: 78,
  reportedUnavailableAt: null,
  interviews: [],
};
const exports = (document: "tailored-cv" | "cover-letter") => ({
  pdf: `/api/applications/app_rhone/${document}/export?format=pdf&template=classic`,
  docx: `/api/applications/app_rhone/${document}/export?format=docx&template=classic`,
});
const DOCUMENTS: TailoredDocumentsResponse = {
  documentLanguage: "fr",
  documents: [
    { kind: "tailored_cv", language: "fr", updatedAt: "2026-11-03T10:15:00.000Z", downloads: exports("tailored-cv"), message: null },
    { kind: "cover_letter", language: "fr", updatedAt: "2026-11-03T10:40:00.000Z", downloads: exports("cover-letter"), message: null },
    {
      kind: "outreach_message",
      language: "fr",
      updatedAt: "2026-11-04T08:05:00.000Z",
      downloads: null,
      message: { subject: "Votre poste de responsable logistique", text: "Bonjour,\n\nDix ans d'entrepôt à Lyon : je serais ravie d'échanger sur votre poste.\n\nMarie Dupont" },
    },
  ],
};
/** Each Application's document in a folder of its own, named for the Application and the document (#756). */
const CV_PDF = "file:///cache/documents/app_rhone-tailored_cv/CV adapté – Rhône Distribution · Responsable logistique.pdf";

/** Where the web app's export routes redirect, when a test says so (`mockRedirectExports`). */
const mockRedirectExports = { current: null as string | null };

/** The web app, at the app's fetch: its export routes answer a file (or fail, or redirect); every other call, the fake web app. */
const webAppFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (!url.includes("/export?")) return mockWeb.app.fetch(input as string, init);
  if (!url.startsWith("https://jobbbox.ai/")) return new Response("ailleurs", { status: 200 });
  mockDownloads.push({ url, headers: init?.headers as Record<string, string> | undefined });
  if (mockFailNextDownload.current) {
    mockFailNextDownload.current = false;
    throw new TypeError("Network request failed");
  }
  if (mockRedirectExports.current) {
    const location = mockRedirectExports.current;
    // As the system's fetch does: followed, the cookie with it, unless the call follows redirects itself.
    return init?.redirect === "manual" ? new Response(null, { status: 302, headers: { location } }) : webAppFetch(location, init);
  }
  return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
};

async function openFiche(id = APPLICATION.id) {
  await signedIn();
  await openApp(`/candidatures/${id}`);
  await userEvent.setup().press(button("Fiche"));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockDownloads.length = 0;
  mockFiles.clear();
  mockRedirectExports.current = null;
  setWindow(PHONE);
  // Every call of the app's useApi() goes to the web app, faked at its fetch as the session's are.
  jest.requireMock("../src/session/instance");
  jest.spyOn(globalThis, "fetch").mockImplementation(webAppFetch);
  mockWeb.app.has(EMAIL, { applications: [{ application: APPLICATION, documents: DOCUMENTS }] });
  mockWeb.app.reads.length = 0;
});
afterEach(() => jest.restoreAllMocks());

describe("Tailored Documents, read from the web app", () => {
  it("lists the Application's own Tailored Documents, read with the Candidate's session", async () => {
    await openFiche();
    expect(await screen.findByRole("button", { name: "CV adapté" })).toBeOnTheScreen();
    expect(button("Lettre de motivation")).toBeOnTheScreen();
    expect(button("Message d'approche")).toBeOnTheScreen();
    expect(mockWeb.app.reads).toContainEqual({ path: "/api/applications/app_rhone/documents", as: EMAIL });
  });

  it("says when the Application has no document yet", async () => {
    mockWeb.app.has(EMAIL, { applications: [{ application: APPLICATION, documents: { documentLanguage: "fr", documents: [] } }] });
    await openFiche();
    expect(await screen.findByText(/Pas encore de document/)).toBeOnTheScreen();
  });

  it("says an Application that is not the Candidate's cannot be found, and shows no documents", async () => {
    await openFiche("app_de_quelquun_d_autre");
    expect(await screen.findByText(/Cette candidature est introuvable/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "CV adapté" })).toBeNull();
  });

  it("says when the documents could not be read, and « Réessayer » reads them again", async () => {
    mockWeb.app.failNext("/api/applications/app_rhone/documents", 500, 2);
    await openFiche();
    expect(await screen.findByText(/n'a pas pu être chargé/, {}, { timeout: 10_000 })).toBeOnTheScreen();
    await userEvent.setup().press(button("Réessayer"));
    expect(await screen.findByRole("button", { name: "CV adapté" })).toBeOnTheScreen();
  });
});

describe("Tailored Documents, the system's PDF reader", () => {
  it("opens the Tailored CV in the Work Pane and its PDF in the system's reader", async () => {
    await openFiche();
    await userEvent.setup().press(await screen.findByRole("button", { name: "CV adapté" }));

    expect(mockDownloads).toEqual([
      {
        url: "https://jobbbox.ai/api/applications/app_rhone/tailored-cv/export?format=pdf&template=classic",
        headers: { "Jobbbox-Api-Version": "1", "Jobbbox-Client": "mobile", cookie: expect.any(String) },
      },
    ]);
    expect([...mockFiles]).toEqual([CV_PDF]);
    // The download carries the session (#685), as the app's reads do: the web app reads it as Marie's, not a 401.
    expect(mockWeb.app.signedInAs(mockDownloads[0]?.headers)).toBe(EMAIL);
    expect(mockPreview).toHaveBeenCalledWith(CV_PDF, { title: "CV adapté", mimeType: "application/pdf" });
    // The Work Pane over the Fiche, on a phone: the document's title, and what can be done with it.
    expect(screen.getByText("CV adapté")).toBeOnTheScreen();
    expect(button("Partager")).toBeOnTheScreen();
  });
});

describe("Tailored Documents, « Partager » and « Télécharger » through the system's share sheet", () => {
  it("shares the Tailored CV's PDF, downloaded once for reading and sharing", async () => {
    await openFiche();
    await screen.findByRole("button", { name: "CV adapté" });
    const user = userEvent.setup();
    await user.press(button("CV adapté"));
    await user.press(button("Partager"));

    expect(mockShare).toHaveBeenCalledWith(CV_PDF, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "CV adapté" });
    expect(mockDownloads).toHaveLength(1);
  });

  it("downloads the Cover Letter as Word to the share sheet (Fichiers, Mail…), and still shows it as its PDF", async () => {
    await openFiche();
    await screen.findByRole("button", { name: "CV adapté" });
    const user = userEvent.setup();
    await user.press(button("Lettre de motivation"));
    await user.press(button("Télécharger en Word"));

    const word = "file:///cache/documents/app_rhone-cover_letter/Lettre de motivation – Rhône Distribution · Responsable logistique.docx";
    expect(mockDownloads.map((download) => download.url)).toEqual([
      "https://jobbbox.ai/api/applications/app_rhone/cover-letter/export?format=pdf&template=classic",
      "https://jobbbox.ai/api/applications/app_rhone/cover-letter/export?format=docx&template=classic",
    ]);
    expect(mockShare).toHaveBeenCalledWith(word, {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      UTI: "org.openxmlformats.wordprocessingml.document",
      dialogTitle: "Lettre de motivation",
    });
    await user.press(button("Ouvrir"));
    expect(mockPreview).toHaveBeenLastCalledWith("file:///cache/documents/app_rhone-cover_letter/Lettre de motivation – Rhône Distribution · Responsable logistique.pdf", { title: "Lettre de motivation", mimeType: "application/pdf" });
  });

  it("shows the Outreach Message's words in the Work Pane and shares them, its subject for Mail", async () => {
    const shareText = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await openFiche();
    await screen.findByRole("button", { name: "CV adapté" });
    const user = userEvent.setup();
    await user.press(button("Message d'approche"));

    expect(screen.getByText("Objet : Votre poste de responsable logistique")).toBeOnTheScreen();
    expect(screen.getByText(/je serais ravie d'échanger sur votre poste/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Télécharger en PDF" })).toBeNull();
    await user.press(button("Partager"));

    expect(shareText).toHaveBeenCalledWith(
      { title: "Votre poste de responsable logistique", message: expect.stringContaining("je serais ravie d'échanger sur votre poste") },
      { subject: "Votre poste de responsable logistique", dialogTitle: "Message d'approche" },
    );
    expect(mockDownloads).toEqual([]);
    expect(mockPreview).not.toHaveBeenCalled();
  });
});

describe("Tailored Documents, downloaded from the web app alone", () => {
  for (const [what, elsewhere] of [
    ["an address on another host", "https://exports.example.net/cv.pdf"],
    ["an address relative to the scheme, so on another host", "//exports.example.net/cv.pdf"],
  ] as const) {
    it(`refuses ${what} the read gives: no request, no session cookie, the download's error`, async () => {
      const [cv, ...others] = DOCUMENTS.documents;
      mockWeb.app.has(EMAIL, { applications: [{ application: APPLICATION, documents: { ...DOCUMENTS, documents: [{ ...cv!, downloads: { pdf: elsewhere, docx: elsewhere } }, ...others] } }] });
      await openFiche();
      const user = userEvent.setup();
      await user.press(await screen.findByRole("button", { name: "CV adapté" }));

      expect(await screen.findByText(/n'a pas pu être ouvert/)).toBeOnTheScreen();
      await user.press(button("Télécharger en Word"));
      // Nothing was asked of the other host, by the download or otherwise, so no cookie reached it.
      expect(mockDownloads).toEqual([]);
      expect((globalThis.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes("exports.example.net"))).toEqual([]);
      expect(mockPreview).not.toHaveBeenCalled();
      expect(mockShare).not.toHaveBeenCalled();
    });
  }

  it("refuses a redirect of the web app to another host: no session cookie goes there, the download's error (#756)", async () => {
    mockRedirectExports.current = "https://exports.example.net/cv.pdf";
    await openFiche();
    await userEvent.setup().press(await screen.findByRole("button", { name: "CV adapté" }));

    expect(await screen.findByText(/n'a pas pu être ouvert/)).toBeOnTheScreen();
    expect(mockDownloads.map(({ url }) => url)).toEqual(["https://jobbbox.ai/api/applications/app_rhone/tailored-cv/export?format=pdf&template=classic"]);
    expect((globalThis.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes("exports.example.net"))).toEqual([]);
    expect(mockFiles.size).toBe(0);
    expect(mockPreview).not.toHaveBeenCalled();
  });
});

describe("Tailored Documents, kept on the device", () => {
  it("never keeps a document's download links in the read cache, only the Application it is for", async () => {
    await openFiche();
    await screen.findByRole("button", { name: "CV adapté" });
    await act(() => jest.advanceTimersByTimeAsync(1_200));
    const kept = (await AsyncStorage.getItem("jobbbox.reads")) ?? "";
    expect(kept).toContain("Rhône Distribution");
    expect(kept).not.toContain("/export?");
  });
});

describe("Tailored Documents, read only", () => {
  it("offers nothing to change a document in the app, and says where it is changed", async () => {
    await openFiche();
    await screen.findByRole("button", { name: "CV adapté" });
    const user = userEvent.setup();
    for (const name of ["CV adapté", "Lettre de motivation", "Message d'approche"]) {
      await user.press(button(name));
      const actions = screen.getAllByRole("button").map((control) => control.props.accessibilityLabel as string);
      expect(actions.filter((label) => /modifier|rédiger|enregistrer|copier/i.test(label))).toEqual([]);
      expect(screen.getByText(/ils se modifient sur jobbbox\.ai/)).toBeOnTheScreen();
      await user.press(button("Fermer"));
    }
  });

  it("says when a document could not be opened, and « Ouvrir » tries again", async () => {
    mockFailNextDownload.current = true;
    await openFiche();
    await screen.findByRole("button", { name: "CV adapté" });
    const user = userEvent.setup();
    await user.press(button("CV adapté"));

    expect(screen.getByText(/n'a pas pu être ouvert/)).toBeOnTheScreen();
    expect(mockPreview).not.toHaveBeenCalled();
    await user.press(button("Ouvrir"));
    expect(mockPreview).toHaveBeenCalledWith(CV_PDF, { title: "CV adapté", mimeType: "application/pdf" });
    expect(screen.queryByText(/n'a pas pu être ouvert/)).toBeNull();
  });
});

describe("Tailored Documents, on a tablet", () => {
  it("opens the document in the Work Pane column beside the conversation and the Fiche", async () => {
    setWindow(IPAD_LANDSCAPE);
    await signedIn();
    await openApp("/candidatures/app_rhone");
    await userEvent.setup().press(await screen.findByRole("button", { name: "CV adapté" }));

    expect(mockPreview).toHaveBeenCalledWith(CV_PDF, { title: "CV adapté", mimeType: "application/pdf" });
    expect(button("Partager")).toBeOnTheScreen();
    // A column: the conversation stays in reach beside it.
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
  });
});

describe("Tailored Documents, two Applications of the same title (#756)", () => {
  it("keeps each Application's document in a file of its own, the Cover Letter and the CV apart", async () => {
    // The same offer applied to under a second Profile: same title, same employer, another Application.
    const SECOND: ApplicationResponse = { ...APPLICATION, id: "app_rhone_bis", profile: { id: "prof_bis", name: "Direction logistique" } };
    const secondExports = (document: "tailored-cv" | "cover-letter") => ({
      pdf: `/api/applications/app_rhone_bis/${document}/export?format=pdf&template=classic`,
      docx: `/api/applications/app_rhone_bis/${document}/export?format=docx&template=classic`,
    });
    const SECOND_DOCUMENTS: TailoredDocumentsResponse = {
      documentLanguage: "fr",
      documents: [
        { kind: "tailored_cv", language: "fr", updatedAt: "2026-11-03T10:15:00.000Z", downloads: secondExports("tailored-cv"), message: null },
        { kind: "cover_letter", language: "fr", updatedAt: "2026-11-03T10:40:00.000Z", downloads: secondExports("cover-letter"), message: null },
      ],
    };
    mockWeb.app.has(EMAIL, {
      applications: [
        { application: APPLICATION, documents: DOCUMENTS },
        { application: SECOND, documents: SECOND_DOCUMENTS },
      ],
    });
    const user = userEvent.setup();

    await openFiche("app_rhone");
    await user.press(await screen.findByRole("button", { name: "CV adapté" }));
    await act(async () => router.navigate("/candidatures/app_rhone_bis"));
    await user.press(await screen.findByRole("button", { name: "Fiche" }));
    await user.press(await screen.findByRole("button", { name: "CV adapté" }));
    await act(async () => router.navigate("/candidatures/app_rhone"));
    await user.press(await screen.findByRole("button", { name: "Fiche" }));
    await user.press(await screen.findByRole("button", { name: "Lettre de motivation" }));

    const files = [...mockFiles];
    expect(files).toHaveLength(3);
    expect(new Set(files).size).toBe(3);
    expect(files.filter((file) => file.includes("app_rhone-tailored_cv/"))).toHaveLength(1);
    expect(files.filter((file) => file.includes("app_rhone-cover_letter/"))).toHaveLength(1);
    expect(files.filter((file) => file.includes("app_rhone_bis-tailored_cv/"))).toHaveLength(1);
    for (const file of files) expect(file).toMatch(/\.pdf$/);
  });
});

describe("Tailored Documents, at sign-out", () => {
  it("deletes the documents downloaded into the cache from the device", async () => {
    await openFiche();
    await screen.findByRole("button", { name: "CV adapté" });
    const user = userEvent.setup();
    await user.press(button("CV adapté"));
    expect([...mockFiles]).toEqual([CV_PDF]);

    await act(async () => router.navigate("/compte"));
    await user.press(await screen.findByRole("button", { name: "Se déconnecter" }));

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect([...mockFiles]).toEqual([]);
  });
});

describe("Tailored Documents, a session found revoked back in the foreground", () => {
  it("deletes the documents downloaded into the cache, as « Se déconnecter » does", async () => {
    await openFiche();
    await screen.findByRole("button", { name: "CV adapté" });
    await userEvent.setup().press(button("CV adapté"));
    expect([...mockFiles]).toEqual([CV_PDF]);

    mockWeb.app.revokeAll(EMAIL);
    const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter(([event]) => event === "change").map(([, listener]) => listener);
    await act(async () => listeners.forEach((listener) => listener("active")));

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect([...mockFiles]).toEqual([]);
  });
});

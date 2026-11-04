// End-to-end for an Application's Tailored Documents (#695) through the app's real entry: Expo Router mounts the
// Application's page with its Fiche, and the real system-documents module downloads, shows and shares them. Only the
// device's native modules (expo-file-system, expo-sharing, React Native's Share) are faked, and what reaches the
// system's PDF reader and share sheet is asserted.
import { screen, userEvent } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Dimensions, Share } from "react-native";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));

const mockDownloads: { url: string; to: string; headers: Record<string, string> | undefined }[] = [];
const mockPreview = jest.fn<Promise<void>, [string, unknown]>(async () => {});
const mockShare = jest.fn<Promise<void>, [string, unknown]>(async () => {});
const mockFailNextDownload = { current: false };

jest.mock("expo-sharing", () => ({ shareAsync: (uri: string, options: unknown) => mockShare(uri, options) }));
jest.mock("expo-file-system", () => {
  class File {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = parts.map((part) => (typeof part === "string" ? part : part.uri)).join("");
    }
    static async downloadFileAsync(url: string, destination: File, options?: { headers?: Record<string, string> }) {
      if (mockFailNextDownload.current) {
        mockFailNextDownload.current = false;
        throw new Error("offline");
      }
      mockDownloads.push({ url, to: destination.uri, headers: options?.headers });
      return destination;
    }
    preview(options: unknown) {
      return mockPreview(this.uri, options);
    }
  }
  return { File, Paths: { cache: { uri: "file:///cache/" } } };
});

const PHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };
const setWindow = ({ width, height }: { width: number; height: number }) => {
  const size = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
};
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const CV_PDF = "file:///cache/CV adapté – Aéroline · Responsable qualité.pdf";

async function openFiche() {
  await renderRouter("./src/app", { initialUrl: "/candidatures/a1" });
  await userEvent.setup().press(button("Fiche"));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDownloads.length = 0;
  setWindow(PHONE);
});

describe("Tailored Documents, the system's PDF reader", () => {
  it("opens the Tailored CV in the Work Pane and its PDF in the system's reader", async () => {
    await openFiche();
    await userEvent.setup().press(button("CV adapté"));

    expect(mockDownloads).toEqual([
      {
        url: "https://jobbbox.ai/api/applications/a1/tailored-cv/export?format=pdf&template=classic",
        to: CV_PDF,
        headers: { "Jobbbox-Api-Version": "1", "Jobbbox-Client": "mobile" },
      },
    ]);
    expect(mockPreview).toHaveBeenCalledWith(CV_PDF, { title: "CV adapté", mimeType: "application/pdf" });
    // The Work Pane over the Fiche, on a phone: the document's title, and what can be done with it.
    expect(screen.getByText("CV adapté")).toBeOnTheScreen();
    expect(button("Partager")).toBeOnTheScreen();
  });
});

describe("Tailored Documents, « Partager » and « Télécharger » through the system's share sheet", () => {
  it("shares the Tailored CV's PDF, downloaded once for reading and sharing", async () => {
    await openFiche();
    const user = userEvent.setup();
    await user.press(button("CV adapté"));
    await user.press(button("Partager"));

    expect(mockShare).toHaveBeenCalledWith(CV_PDF, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "CV adapté" });
    expect(mockDownloads).toHaveLength(1);
  });

  it("downloads the Cover Letter as Word to the share sheet (Fichiers, Mail…), and still shows it as its PDF", async () => {
    await openFiche();
    const user = userEvent.setup();
    await user.press(button("Lettre de motivation"));
    await user.press(button("Télécharger en Word"));

    const word = "file:///cache/Lettre de motivation – Aéroline · Responsable qualité.docx";
    expect(mockDownloads.map((download) => download.url)).toEqual([
      "https://jobbbox.ai/api/applications/a1/cover-letter/export?format=pdf&template=classic",
      "https://jobbbox.ai/api/applications/a1/cover-letter/export?format=docx&template=classic",
    ]);
    expect(mockShare).toHaveBeenCalledWith(word, {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      UTI: "org.openxmlformats.wordprocessingml.document",
      dialogTitle: "Lettre de motivation",
    });
    await user.press(button("Ouvrir"));
    expect(mockPreview).toHaveBeenLastCalledWith("file:///cache/Lettre de motivation – Aéroline · Responsable qualité.pdf", { title: "Lettre de motivation", mimeType: "application/pdf" });
  });

  it("shows the Outreach Message's words in the Work Pane and shares them, its subject for Mail", async () => {
    const shareText = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await openFiche();
    const user = userEvent.setup();
    await user.press(button("Message d'approche"));

    expect(screen.getByText("Objet : Candidature au poste de responsable qualité")).toBeOnTheScreen();
    expect(screen.getByText(/j'aimerais en parler avec vous/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Télécharger en PDF" })).toBeNull();
    await user.press(button("Partager"));

    expect(shareText).toHaveBeenCalledWith(
      { title: "Candidature au poste de responsable qualité", message: expect.stringContaining("j'aimerais en parler avec vous") },
      { subject: "Candidature au poste de responsable qualité", dialogTitle: "Message d'approche" },
    );
    expect(mockDownloads).toEqual([]);
    expect(mockPreview).not.toHaveBeenCalled();
  });
});

describe("Tailored Documents, read only", () => {
  it("offers nothing to change a document in the app, and says where it is changed", async () => {
    await openFiche();
    const user = userEvent.setup();
    for (const name of ["CV adapté", "Lettre de motivation", "Message d'approche"]) {
      await user.press(button(name));
      const actions = screen.getAllByRole("button").map((control) => control.props["aria-label"] as string);
      expect(actions.filter((label) => /modifier|rédiger|enregistrer|copier/i.test(label))).toEqual([]);
      expect(screen.getByText(/ils se modifient sur jobbbox\.ai/)).toBeOnTheScreen();
      await user.press(button("Fermer"));
    }
  });

  it("says when a document could not be opened, and « Ouvrir » tries again", async () => {
    mockFailNextDownload.current = true;
    await openFiche();
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
    await renderRouter("./src/app", { initialUrl: "/candidatures/a1" });
    await userEvent.setup().press(button("CV adapté"));

    expect(mockPreview).toHaveBeenCalledWith(CV_PDF, { title: "CV adapté", mimeType: "application/pdf" });
    expect(button("Partager")).toBeOnTheScreen();
    // A column: the conversation stays in reach beside it.
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
  });
});

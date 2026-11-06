import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { Slot } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { AccessibilityInfo, Text } from "react-native";
import { AppProviders } from "../app-providers";
import { CoachConversation } from "../coach/CoachConversation";
import { fakeCoachWeb, type FakeCoachWeb } from "../coach/testing";
import { fakeNetwork, memoryStorage } from "../offline/testing";
import { METRICS, renderInApp } from "../testing";
import type { DroppedItem } from "./attachment";

// The system's document picker and clipboard, as the person answers them.
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-clipboard", () => ({ getStringAsync: jest.fn() }));
// The app's cache, where the system copies a file picked or dropped: what the app deletes from it.
const mockDeleted: string[] = [];
jest.mock("expo-file-system", () => ({
  File: function MockFile(this: { uri: string; exists: boolean; delete: () => void }, mockUri: string) {
    this.uri = mockUri;
    this.exists = true;
    this.delete = () => void mockDeleted.push(mockUri);
  },
}));

const MB = 1024 * 1024;
const PDF = "application/pdf";

let web: FakeCoachWeb;
beforeEach(() => {
  web = fakeCoachWeb();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  mockDeleted.splice(0);
});

/** The person picks `file` in the system's document picker; null, they close it. */
function picks(file: { name: string; size?: number; mimeType?: string } | null) {
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(
    file
      ? { canceled: false, assets: [{ uri: `file:///cache/${encodeURIComponent(file.name)}`, lastModified: 0, ...file }] }
      : { canceled: true, assets: null },
  );
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const menuItem = (name: string) => screen.getByRole("menuitem", { name });

async function choose(item: "Coller un lien d'offre" | "Joindre un CV") {
  const user = userEvent.setup();
  await user.press(button("Joindre un lien ou un document"));
  await user.press(menuItem(item));
  return user;
}

/** What the server reads in Marie Dupont's CV. */
const DRAFT = {
  masterCv: {
    fullName: "Marie Dupont",
    headline: "Responsable qualité",
    email: "marie.dupont@example.fr",
    phone: "",
    location: "Lyon",
    summary: "",
    experience: [],
    education: [],
    skills: ["ISO 9001"],
    languages: [],
  },
  searchCriteria: { targetRole: "Responsable qualité", locations: ["Lyon", "Grenoble"], location: "Lyon" },
  provenance: { v: 1, steps: [], sites: [], startedAt: "2026-11-05T10:00:00.000Z", wallMs: 900 },
};

const CV_SENT = () => web.requests.filter((request) => request.path === "/api/cv/draft");

describe("« Joindre un CV », from « + » in the box", () => {
  it("refuses a file over 10 MB before sending it", async () => {
    picks({ name: "CV.pdf", size: 12 * MB, mimeType: PDF });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await choose("Joindre un CV");

    expect(await screen.findByText("Ce fichier dépasse 10 Mo. Enregistrez votre CV dans un fichier plus léger et réessayez.")).toBeOnTheScreen();
    expect(CV_SENT()).toHaveLength(0);
  });

  it("refuses a file of another format before sending it", async () => {
    picks({ name: "CV.doc", size: 200_000, mimeType: "application/msword" });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await choose("Joindre un CV");

    expect(await screen.findByText(/Ce fichier n'est pas un CV au format PDF ou Word \(\.docx\)/)).toBeOnTheScreen();
    expect(CV_SENT()).toHaveLength(0);
  });

  it("offers PDF and Word files in the system's document picker, and sends nothing when it is closed", async () => {
    picks(null);
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await choose("Joindre un CV");

    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] }),
    );
    expect(CV_SENT()).toHaveLength(0);
  });

  it("sends the CV to be read as the web's form does, and shows what was read; nothing is saved", async () => {
    picks({ name: "Marie Dupont.pdf", size: 300_000, mimeType: PDF });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await choose("Joindre un CV");

    expect(web.cvs).toEqual([{ field: "cv", uri: "file:///cache/Marie%20Dupont.pdf", name: "Marie Dupont.pdf", type: PDF }]);
    expect(await screen.findByText("Lecture de votre CV en cours…")).toBeOnTheScreen();

    await act(async () => web.readCv(200, DRAFT));
    expect(await screen.findByText("CV lu : Marie Dupont.pdf")).toBeOnTheScreen();
    expect(screen.getByText("Marie Dupont · Responsable qualité")).toBeOnTheScreen();
    expect(screen.getByText("Poste recherché : Responsable qualité")).toBeOnTheScreen();
    expect(screen.getByText("Lieux : Lyon, Grenoble")).toBeOnTheScreen();
    expect(web.profiles).toHaveLength(0);
  });

  it("keeps no copy of the CV on the device once it is read, or refused", async () => {
    picks({ name: "CV.pdf", size: 300_000, mimeType: PDF });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await choose("Joindre un CV");
    expect(mockDeleted).toEqual([]);
    await act(async () => web.readCv(200, DRAFT));
    expect(mockDeleted).toEqual(["file:///cache/CV.pdf"]);

    picks({ name: "Film.mp4", size: 300 * MB, mimeType: "video/mp4" });
    await choose("Joindre un CV");
    expect(mockDeleted).toEqual(["file:///cache/CV.pdf", "file:///cache/Film.mp4"]);
  });

  it("says why the server could not read it: the server decides", async () => {
    picks({ name: "CV.pdf", size: 300_000, mimeType: PDF });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await choose("Joindre un CV");
    await act(async () => web.readCv(400, { error: "unreadable" }));

    expect(await screen.findByText(/Nous n'avons pas pu ouvrir ce fichier/)).toBeOnTheScreen();
  });

  it("stops reading at « Arrêter la lecture du CV »: nothing is read", async () => {
    picks({ name: "CV.pdf", size: 300_000, mimeType: PDF });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    const user = await choose("Joindre un CV");
    await user.press(await screen.findByRole("button", { name: "Arrêter la lecture du CV" }));

    expect(await screen.findByText(/^Lecture arrêtée à .* : rien n'a été lu ni enregistré\.$/)).toBeOnTheScreen();
    expect(screen.queryByText(/CV lu/)).toBeNull();
  });

  it("saves what was read as a new Profile at « Créer le profil », and opens it", async () => {
    picks({ name: "CV.pdf", size: 300_000, mimeType: PDF });
    const app = await renderRouter(
      {
        _layout: () => (
          <AppProviders i18n={createI18n(DEFAULT_LOCALE)} initialMetrics={METRICS} device={{ storage: memoryStorage(), network: fakeNetwork(true) }} {...web.client}>
            <Slot />
          </AppProviders>
        ),
        index: () => <CoachConversation conversationId={null} route="/" />,
        "profils/[id]": () => <Text>Le profil</Text>,
      },
      { initialUrl: "/" },
    );
    jest.useRealTimers();
    const user = await choose("Joindre un CV");
    await act(async () => web.readCv(200, DRAFT));
    await user.press(await screen.findByRole("button", { name: "Créer le profil" }));

    expect(web.profiles).toEqual([
      { masterCv: DRAFT.masterCv, searchCriteria: { targetRole: "Responsable qualité", locations: ["Lyon", "Grenoble"] }, provenance: DRAFT.provenance },
    ]);
    expect(await screen.findByText("Le profil")).toBeOnTheScreen();
    expect(app.getPathname()).toBe("/profils/p1");
  });

  it("sends a draft the server finds incomplete to be finished on jobbbox.ai", async () => {
    web.answerProfiles(400, { errors: [{ field: "searchCriteria.targetRole", code: "required" }] });
    picks({ name: "CV.pdf", size: 300_000, mimeType: PDF });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    const user = await choose("Joindre un CV");
    await act(async () => web.readCv(200, { ...DRAFT, searchCriteria: { targetRole: "", locations: [] } }));
    await user.press(await screen.findByRole("button", { name: "Créer le profil" }));

    expect(await screen.findByText(/Ce CV ne dit pas tout ce qu'un profil demande \(Poste recherché\)/)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Créer le profil sur jobbbox.ai" })).toBeOnTheScreen();
  });

  it("says the Plan Quota is reached, with no offer to buy", async () => {
    web.answerProfiles(409, { error: "plan_quota_reached", prompt: { message: "Passez à Pro", action: "Voir", href: "/abonnement" } });
    picks({ name: "CV.pdf", size: 300_000, mimeType: PDF });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    const user = await choose("Joindre un CV");
    await act(async () => web.readCv(200, DRAFT));
    await user.press(await screen.findByRole("button", { name: "Créer le profil" }));

    expect(await screen.findByText(/Vous avez atteint le nombre de profils actifs prévu par votre formule/)).toBeOnTheScreen();
    expect(screen.queryByText("Passez à Pro")).toBeNull();
  });
});

describe("« Coller un lien d'offre », from « + » in the box", () => {
  it("sends the clipboard's link to the coach, who reads it as a Job Offer (until the Share capture, #697)", async () => {
    jest.mocked(Clipboard.getStringAsync).mockResolvedValue("https://www.welcometothejungle.com/fr/companies/aeroline/jobs/responsable-qualite");
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await choose("Coller un lien d'offre");

    expect(web.asked).toEqual([{ message: "https://www.welcometothejungle.com/fr/companies/aeroline/jobs/responsable-qualite", route: "/" }]);
  });

  it("says so when the clipboard holds no link, and sends nothing", async () => {
    jest.mocked(Clipboard.getStringAsync).mockResolvedValue("Responsable qualité, Lyon");
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await choose("Coller un lien d'offre");

    expect(await screen.findByText("Le presse-papiers ne contient pas de lien. Copiez le lien de l'offre, puis réessayez.")).toBeOnTheScreen();
    expect(web.asked).toHaveLength(0);
  });
});

describe("a document or a link dropped on the box, on a tablet", () => {
  /** What the native view sends when something is dropped on the box, its text field included (modules/drop-target). */
  const drop = (items: DroppedItem[]) => act(async () => fireEvent(screen.getByLabelText("Votre message"), "dropItems", { nativeEvent: { items } }));

  it("reads a dropped PDF as « Joindre un CV » does", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await drop([{ kind: "file", uri: "file:///cache/dropped/CV.pdf", name: "CV.pdf", size: 300_000, mimeType: PDF }]);

    expect(web.cvs).toEqual([{ field: "cv", uri: "file:///cache/dropped/CV.pdf", name: "CV.pdf", type: PDF }]);
  });

  it("refuses a dropped file over 10 MB before sending it", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await drop([{ kind: "file", uri: "file:///cache/dropped/CV.docx", name: "CV.docx", size: 11 * MB, mimeType: null }]);

    expect(await screen.findByText(/Ce fichier dépasse 10 Mo/)).toBeOnTheScreen();
    expect(CV_SENT()).toHaveLength(0);
  });

  it("sends a dropped link as « Coller un lien d'offre » does", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await drop([{ kind: "text", text: "https://candidat.francetravail.fr/offres/recherche/detail/123ABC" }]);

    expect(web.asked).toEqual([{ message: "https://candidat.francetravail.fr/offres/recherche/detail/123ABC", route: "/" }]);
  });

  it("takes nothing dropped without network", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { ...web.client, network: fakeNetwork(false) });
    await drop([{ kind: "text", text: "https://candidat.francetravail.fr/offres/recherche/detail/123ABC" }]);

    expect(web.asked).toHaveLength(0);
  });
});

describe("« + » in the box", () => {
  it("offers a Job Offer's link or a CV, and no photo of a job posting (v1.1)", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, web.client);
    await userEvent.setup().press(button("Joindre un lien ou un document"));

    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(menuItem("Coller un lien d'offre")).toBeOnTheScreen();
    expect(menuItem("Joindre un CV")).toBeOnTheScreen();
  });
});

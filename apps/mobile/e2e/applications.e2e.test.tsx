// End-to-end for Mes candidatures in the app (#691) through the app's real entry: Expo Router mounts the list and an
// Application's page, its conversation and its Fiche. The web app is faked at the network: its Mes candidatures routes
// (./applications-web), which answer only to the signed-in Candidate's session and take a write only from the app's
// origin, the Coach Conversation's routes (src/coach/testing.ts) and the session's endpoints (src/session/testing.ts).
// Only the device's native modules are faked besides: the system's Dialog (Alert) and browser (Linking).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ApplicationResponse } from "@jobhub/shared/reads";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Alert, Dimensions, Linking, type AlertButton } from "react-native";
import { fakeCoachWeb, withCoach } from "../src/coach/testing";
import { serveApplications, type ApplicationsRoute, type HeldApplication } from "./applications-web";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
/** The device's network as expo-network reports it, connected unless a test turns it off. */
const mockNetwork = { connected: true, listeners: new Set<(state: { isConnected: boolean }) => void>() };
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: mockNetwork.connected }),
  addNetworkStateListener: (listener: (state: { isConnected: boolean }) => void) => {
    mockNetwork.listeners.add(listener);
    return { remove: () => mockNetwork.listeners.delete(listener) };
  },
}));

// The web app the app signs in to (#685), as documents.e2e.test.tsx fakes it.
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

const PHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };
const setWindow = ({ width, height }: { width: number; height: number }) => {
  const size = { width, height, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
};
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const link = (name: string | RegExp) => screen.getByRole("link", { name, hidden: true });

const jobOffer = (id: string, title: string, employer: string, location: string) => ({ id, title, employer, location, url: null, postedAt: null, expiredAt: null });

/** Marie's Application to Aéroline, « Postulée », no Interview yet. */
const AEROLINE: ApplicationResponse = {
  id: "app_aeroline",
  status: "applied",
  statusChangedAt: "2026-10-30T09:00:00.000Z",
  createdAt: "2026-10-28T09:00:00.000Z",
  jobOffer: { ...jobOffer("offer_aeroline", "Responsable qualité", "Aéroline", "Toulouse"), url: "https://www.welcometothejungle.com/fr/companies/aeroline/jobs/responsable-qualite", postedAt: "2026-10-20T08:00:00.000Z" },
  profile: { id: "prof_qualite", name: "Qualité aéronautique" },
  matchScore: 82,
  reportedUnavailableAt: null,
  interviews: [],
};
/** Her Application to Rhône Distribution, at « Entretien »: one Interview Rescheduled, one Cancelled. */
const RHONE: ApplicationResponse = {
  id: "app_rhone",
  status: "interview",
  statusChangedAt: "2026-11-02T09:00:00.000Z",
  createdAt: "2026-10-20T09:00:00.000Z",
  jobOffer: jobOffer("offer_rhone", "Responsable logistique", "Rhône Distribution", "Lyon"),
  profile: { id: "prof_lyon", name: "Supply chain à Lyon" },
  matchScore: null,
  reportedUnavailableAt: null,
  interviews: [
    {
      id: "interview-rh",
      scheduledAt: "2026-11-12T13:30:00.000Z",
      durationMinutes: 45,
      format: "video",
      place: "https://teams.microsoft.com/l/meetup-join/rhone",
      note: "Avec la DRH",
      cancelledAt: null,
      reschedules: [{ previousAt: "2026-11-10T09:00:00.000Z", newAt: "2026-11-12T13:30:00.000Z", by: "candidate", at: "2026-11-03T08:00:00.000Z" }],
    },
    { id: "interview-site", scheduledAt: "2026-11-20T09:00:00.000Z", durationMinutes: null, format: "on_site", place: "12 quai Perrache, Lyon", note: "", cancelledAt: "2026-11-04T10:00:00.000Z", reschedules: [] },
  ],
};
/** An Archived Application: « Refusée », its past Interview kept. */
const ARCHIVED: ApplicationResponse = {
  ...RHONE,
  id: "app_ancienne",
  status: "rejected",
  jobOffer: jobOffer("offer_ancienne", "Cheffe de quai", "Transports Martin", "Vénissieux"),
  interviews: [{ ...RHONE.interviews[1]!, id: "interview-ancien", scheduledAt: "2026-09-15T08:00:00.000Z", cancelledAt: null }],
};
const HELD: HeldApplication[] = [{ application: AEROLINE, toHandle: "follow_up" }, { application: RHONE }, { application: ARCHIVED }];

let web: ApplicationsRoute;
/** Signed in, the web app serving Mes candidatures (`held`), the app opened at `url`, past the legal steps (#689). */
async function launch(url: string, held = HELD) {
  await signedIn();
  web = serveApplications(mockWeb.app, EMAIL, held, withCoach(fakeCoachWeb(), mockWeb.app.fetch));
  await renderRouter("./src/app", { initialUrl: url });
  await waitFor(() => expect(screen.queryByLabelText("Ouverture de votre compte…")).toBeNull());
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockNetwork.connected = true;
  setWindow(PHONE);
  jest.requireMock("../src/session/instance");
  mockWeb.app.has(EMAIL, { applications: HELD.map(({ application }) => ({ application, documents: { documentLanguage: "fr", documents: [] } })) });
});
afterEach(() => jest.restoreAllMocks());

describe("Mes candidatures, the list", () => {
  it("lists the Applications with their status, Match Score and what is à traiter, and a row opens its Application", async () => {
    await launch("/candidatures");
    expect(await screen.findByText("2 candidatures")).toBeOnTheScreen();
    expect(screen.getByText("1 à traiter")).toBeOnTheScreen();
    expect(screen.getByText("Postulée · Score de correspondance 82 · Relance prête")).toBeOnTheScreen();
    expect(screen.getByText("Entretien · Score de correspondance non calculable")).toBeOnTheScreen();
    await userEvent.setup().press(link("Responsable logistique · Rhône Distribution"));
    expect(screen).toHavePathname("/candidatures/app_rhone");
  });

  it("titles an Application's page with its Job Offer, and the title, an arrow before it, leads back to the list", async () => {
    await launch("/candidatures/app_rhone");
    const title = await screen.findByRole("link", { name: "Responsable logistique" });
    await userEvent.setup().press(title);
    expect(screen).toHavePathname("/candidatures");
  });
});

describe("Mes candidatures, the Archived Applications", () => {
  it("leaves them out of the list until asked for, as the web does, and hides them again", async () => {
    await launch("/candidatures");
    expect(await screen.findByText("1 candidature archivée est masquée.")).toBeOnTheScreen();
    expect(screen.queryByText(/Cheffe de quai/)).toBeNull();
    const user = userEvent.setup();
    await user.press(button("Les afficher"));
    expect(await screen.findByRole("link", { name: "Cheffe de quai · Transports Martin" })).toBeOnTheScreen();
    expect(screen.getByText("3 candidatures")).toBeOnTheScreen();
    await user.press(button("Masquer les candidatures archivées"));
    await waitFor(() => expect(screen.queryByText(/Cheffe de quai/)).toBeNull());
  });
});

/** The Application's page at `id`, its Fiche opened from the Top Bar (full page on a phone). */
async function openFiche(id = AEROLINE.id) {
  await launch(`/candidatures/${id}`);
  await userEvent.setup().press(button("Fiche"));
  await screen.findByText("Statut");
}

describe("An Application's page", () => {
  it("is its Coach Conversation, whose Subject the Application is", async () => {
    await launch("/candidatures/app_aeroline");
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
    expect(button("Fiche")).toBeOnTheScreen();
  });

  it("opens its Fiche from the Top Bar: its card, read from the web app with the Candidate's session", async () => {
    await openFiche();
    expect(screen.getAllByText("Responsable qualité").length).toBeGreaterThan(0);
    expect(screen.getByText("Aéroline · Toulouse")).toBeOnTheScreen();
    expect(screen.getByText("Postulée")).toBeOnTheScreen();
    expect(screen.getByText("Enregistrée le")).toBeOnTheScreen();
    expect(screen.getByText("28 octobre 2026")).toBeOnTheScreen();
    expect(screen.getByText("82 / 100")).toBeOnTheScreen();
    expect(screen.getByText("Qualité aéronautique")).toBeOnTheScreen();
  });

  it("lists its Sections, its Activity and its Results on the Fiche", async () => {
    await openFiche();
    expect(screen.getByRole("heading", { name: "Sections" })).toBeOnTheScreen();
    for (const section of ["Correspondance", "Entretiens", "L'offre"]) expect(button(section)).toBeOnTheScreen();
    expect(screen.getByRole("heading", { name: "Activité" })).toBeOnTheScreen();
    expect(screen.getByText("Aucun contenu produit par l'IA sur cette page")).toBeOnTheScreen();
    expect(screen.getByRole("heading", { name: "Résultats" })).toBeOnTheScreen();
    expect(await screen.findByText(/Pas encore de document/)).toBeOnTheScreen();
  });

  it("opens its Job Offer's site in the system's browser", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await openFiche();
    await userEvent.setup().press(button("Voir l'offre sur welcometothejungle.com"));
    expect(openURL).toHaveBeenCalledWith(AEROLINE.jobOffer.url);
  });

  it("says an Application that is not the Candidate's cannot be found", async () => {
    await launch("/candidatures/app_de_quelquun_d_autre");
    await userEvent.setup().press(button("Fiche"));
    expect(await screen.findByText(/Cette candidature est introuvable/)).toBeOnTheScreen();
  });
});

/** The network goes, or comes back, as expo-network reports it. */
const setNetwork = (connected: boolean) =>
  act(() => {
    mockNetwork.connected = connected;
    for (const listener of mockNetwork.listeners) listener({ isConnected: connected });
  });

describe("An Application's status, changed from its Fiche", () => {
  it("saves the status chosen with the web's route, says so, and Mes candidatures shows it", async () => {
    await openFiche();
    const user = userEvent.setup();
    await user.press(button("Statut : Postulée"));
    await user.press(screen.getByRole("radio", { name: "Entretien" }));

    expect(await screen.findByText("Statut enregistré")).toBeOnTheScreen();
    expect(web.writes).toEqual([{ method: "PATCH", path: "/api/applications/app_aeroline", body: { status: "interview" } }]);
    expect(button("Statut : Entretien")).toBeOnTheScreen();
    expect(web.application("app_aeroline").status).toBe("interview");

    await user.press(button("Fermer"));
    await user.press(screen.getByRole("link", { name: "Responsable qualité" }));
    expect(await screen.findByText("Entretien · Score de correspondance 82 · Relance prête")).toBeOnTheScreen();
  });

  it("offers every Application Status, as the web does, the current one checked", async () => {
    await openFiche();
    await userEvent.setup().press(button("Statut : Postulée"));
    const choices = screen.getAllByRole("radio");
    expect(choices.map((choice) => choice.props.accessibilityLabel)).toEqual(["À postuler", "Postulée", "Relancée", "Entretien", "Offre reçue", "Acceptée", "Refusée", "Abandonnée"]);
    expect(screen.getByRole("radio", { name: "Postulée", checked: true })).toBeOnTheScreen();
  });

  it("says when the web app could not save it, and keeps the status it has", async () => {
    await openFiche();
    web.failNextWrite = 500;
    const user = userEvent.setup();
    await user.press(button("Statut : Postulée"));
    await user.press(screen.getByRole("radio", { name: "Refusée" }));

    expect(await screen.findByText("L'enregistrement a échoué. Vérifiez votre connexion et réessayez.")).toBeOnTheScreen();
    expect(button("Statut : Postulée")).toBeOnTheScreen();
    expect(web.application("app_aeroline").status).toBe("applied");
  });

  it("changes nothing without network: it says so at once and sends nothing", async () => {
    await openFiche();
    await setNetwork(false);
    expect(await screen.findByText("Hors ligne : rien ne s'enregistre avant le retour du réseau.")).toBeOnTheScreen();
    expect(button("Statut : Postulée")).toBeDisabled();
    expect(web.writes).toEqual([]);
  });
});

/** The Interviews Section of the Application `id`, opened from its Fiche in the Work Pane. */
async function openInterviews(id = RHONE.id) {
  await openFiche(id);
  await userEvent.setup().press(button("Entretiens"));
  await screen.findByRole("button", { name: "Voir dans l'agenda" });
}

/** The explanation before the system's prompt for Push notifications, when an Interview is added (#699). */
const PUSH_FOR_INTERVIEWS = "Être prévenu la veille de vos rendez-vous ?";

/** The system's Dialog, answered by pressing its button named `answer`. */
const answerDialogs = (answer: string) =>
  jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons?: AlertButton[]) => buttons?.find((each) => each.text === answer)?.onPress?.());

describe("The Interviews Section, in the Work Pane", () => {
  it("lists the Application's Interviews as the web does: when, how and where, the note, a Reschedule, a cancellation", async () => {
    await openInterviews();
    expect(screen.getByText("jeudi 12 novembre 2026, 14:30 – 15:15")).toBeOnTheScreen();
    expect(screen.getByText("Visio · https://teams.microsoft.com/l/meetup-join/rhone")).toBeOnTheScreen();
    expect(screen.getByText("Avec la DRH")).toBeOnTheScreen();
    expect(screen.getByText("Reporté · initialement prévu le 10 novembre 2026 à 10:00")).toBeOnTheScreen();
    expect(screen.getByText("vendredi 20 novembre 2026, 10:00 – 11:00")).toBeOnTheScreen();
    expect(screen.getByText("Annulé le 4 novembre 2026")).toBeOnTheScreen();
    expect(button("Modifier l'entretien du jeudi 12 novembre 2026 à 14:30")).toBeOnTheScreen();
    expect(button("Annuler l'entretien du jeudi 12 novembre 2026 à 14:30")).toBeOnTheScreen();
    // A Cancelled Interview cannot be cancelled again.
    expect(screen.queryByRole("button", { name: "Annuler l'entretien du vendredi 20 novembre 2026 à 10:00" })).toBeNull();
  });

  it("adds an Interview with the web's route, lists it, and empties the form", async () => {
    await openInterviews();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Date de l'entretien (jj/mm/aaaa)"), "26/11/2026");
    await user.type(screen.getByLabelText("Heure, à Paris (hh:mm)"), "10:00");
    await user.type(screen.getByLabelText("Durée en minutes (facultatif)"), "60");
    await user.press(screen.getByRole("radio", { name: "Sur place" }));
    await user.type(screen.getByLabelText("Lieu ou lien (facultatif)"), "12 quai Perrache, Lyon");
    await user.type(screen.getByLabelText("Note (facultatif)"), "Second tour");
    await user.press(button("Ajouter l'entretien"));

    expect(await screen.findByText("jeudi 26 novembre 2026, 10:00 – 11:00")).toBeOnTheScreen();
    expect(web.writes).toEqual([
      {
        method: "POST",
        path: "/api/applications/app_rhone/interviews",
        body: { scheduledAt: "2026-11-26T10:00", durationMinutes: 60, format: "on_site", place: "12 quai Perrache, Lyon", note: "Second tour" },
      },
    ]);
    expect(screen.getByText("Second tour")).toBeOnTheScreen();
    expect(screen.getByLabelText("Date de l'entretien (jj/mm/aaaa)").props.value).toBe("");
  });

  it("asks for Push notifications once the web app has added the Interview, after its own explanation (#699)", async () => {
    await openInterviews();
    expect(screen.queryByText(PUSH_FOR_INTERVIEWS)).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Date de l'entretien (jj/mm/aaaa)"), "26/11/2026");
    await user.type(screen.getByLabelText("Heure, à Paris (hh:mm)"), "10:00");
    await user.press(button("Ajouter l'entretien"));

    expect(await screen.findByText(PUSH_FOR_INTERVIEWS)).toBeOnTheScreen();
    expect(web.application("app_rhone").interviews).toHaveLength(3);
  });

  it("says under the field what the web app refused, adds nothing, and asks nothing", async () => {
    await openInterviews();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Date de l'entretien (jj/mm/aaaa)"), "26/13/2026");
    await user.type(screen.getByLabelText("Heure, à Paris (hh:mm)"), "10:00");
    await user.press(button("Ajouter l'entretien"));
    expect(await screen.findByText("Cette valeur n'est pas valide.")).toBeOnTheScreen();
    expect(web.application("app_rhone").interviews).toHaveLength(2);
    expect(screen.queryByText(PUSH_FOR_INTERVIEWS)).toBeNull();

    await user.clear(screen.getByLabelText("Date de l'entretien (jj/mm/aaaa)"));
    await user.clear(screen.getByLabelText("Heure, à Paris (hh:mm)"));
    await user.press(button("Ajouter l'entretien"));
    expect(await screen.findByText("Ce champ est obligatoire.")).toBeOnTheScreen();
  });

  it("offers to add one only while the Application is at « Entretien », as the web does", async () => {
    await openInterviews(AEROLINE.id);
    expect(screen.getByText("Aucun entretien enregistré pour l'instant.")).toBeOnTheScreen();
    expect(screen.getByText("Vous pourrez noter vos entretiens quand la candidature sera au statut « Entretien ».")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Ajouter l'entretien" })).toBeNull();
  });

  it("moves an Interview to another date (a Reschedule) with the web's route, and says it was Rescheduled", async () => {
    await openInterviews();
    const user = userEvent.setup();
    await user.press(button("Modifier l'entretien du jeudi 12 novembre 2026 à 14:30"));
    const date = screen.getAllByLabelText("Date de l'entretien (jj/mm/aaaa)")[0]!;
    expect(date.props.value).toBe("12/11/2026");
    await user.clear(date);
    await user.type(date, "13/11/2026");
    await user.press(button("Enregistrer l'entretien"));

    expect(await screen.findByText("vendredi 13 novembre 2026, 14:30 – 15:15")).toBeOnTheScreen();
    expect(web.writes).toEqual([
      {
        method: "PATCH",
        path: "/api/applications/app_rhone/interviews/interview-rh",
        body: { scheduledAt: "2026-11-13T14:30", durationMinutes: 45, format: "video", place: "https://teams.microsoft.com/l/meetup-join/rhone", note: "Avec la DRH" },
      },
    ]);
    expect(screen.getByText("Reporté · initialement prévu le 10 novembre 2026 à 10:00")).toBeOnTheScreen();
    expect(web.application("app_rhone").interviews[0]!.reschedules).toHaveLength(2);
  });

  it("cancels an Interview once the system's Dialog confirms it: it stays, struck through, with its date of cancellation", async () => {
    const dialogs = answerDialogs("Oui, annuler");
    await openInterviews();
    await userEvent.setup().press(button("Annuler l'entretien du jeudi 12 novembre 2026 à 14:30"));

    expect(dialogs).toHaveBeenCalledWith("Annuler l'entretien", "Annuler cet entretien ? Il reste dans votre agenda et dans cette candidature, barré, avec la date d'annulation.", expect.any(Array));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Annuler l'entretien du jeudi 12 novembre 2026 à 14:30" })).toBeNull());
    expect(web.writes).toEqual([{ method: "POST", path: "/api/applications/app_rhone/interviews/interview-rh/cancel", body: undefined }]);
    expect(screen.getAllByText(/^Annulé le /)).toHaveLength(2);
  });

  it("cancels nothing when the Dialog is answered « Non, garder »", async () => {
    answerDialogs("Non, garder");
    await openInterviews();
    await userEvent.setup().press(button("Annuler l'entretien du jeudi 12 novembre 2026 à 14:30"));
    expect(web.writes).toEqual([]);
    expect(button("Annuler l'entretien du jeudi 12 novembre 2026 à 14:30")).toBeOnTheScreen();
  });

  it("removes an Interview entered by mistake, without a trace, as the web does", async () => {
    await openInterviews();
    await userEvent.setup().press(button("Supprimer l'entretien du vendredi 20 novembre 2026 à 10:00"));
    await waitFor(() => expect(screen.queryByText("vendredi 20 novembre 2026, 10:00 – 11:00")).toBeNull());
    expect(web.writes).toEqual([{ method: "DELETE", path: "/api/applications/app_rhone/interviews/interview-site", body: undefined }]);
  });

  it("writes nothing to the Interviews without network", async () => {
    await openInterviews();
    await setNetwork(false);
    expect(button("Ajouter l'entretien")).toBeDisabled();
    expect(button("Modifier l'entretien du jeudi 12 novembre 2026 à 14:30")).toBeDisabled();
    expect(button("Annuler l'entretien du jeudi 12 novembre 2026 à 14:30")).toBeDisabled();
    expect(web.writes).toEqual([]);
  });

  it("opens at the web's address of the Section: an Interview on the Agenda leads there", async () => {
    await launch("/candidatures/app_rhone/entretiens");
    expect(await screen.findByText("jeudi 12 novembre 2026, 14:30 – 15:15")).toBeOnTheScreen();
    await userEvent.setup().press(button("Voir dans l'agenda"));
    expect(screen).toHavePathname("/agenda");
  });

  it("opens in the Work Pane column beside the conversation on a tablet", async () => {
    setWindow(IPAD_LANDSCAPE);
    await launch("/candidatures/app_rhone");
    await userEvent.setup().press(await screen.findByRole("button", { name: "Entretiens" }));
    expect(await screen.findByText("jeudi 12 novembre 2026, 14:30 – 15:15")).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toBeOnTheScreen();
  });

  it("keeps an Archived Application readable: its Fiche and its Interviews, as on the web", async () => {
    await openInterviews(ARCHIVED.id);
    expect(screen.getByText("mardi 15 septembre 2026, 10:00 – 11:00")).toBeOnTheScreen();
    await userEvent.setup().press(button("Fermer"));
    expect(button("Statut : Refusée")).toBeOnTheScreen();
    expect(screen.getByText("Transports Martin · Vénissieux")).toBeOnTheScreen();
  });
});

describe("An Application's other Sections, to read in the Work Pane", () => {
  it("opens Correspondance: the Match Score and the Profile it measures, nothing to change", async () => {
    await openFiche();
    await userEvent.setup().press(button("Voir le détail"));
    expect(screen.getByRole("heading", { name: "Score de correspondance" })).toBeOnTheScreen();
    expect(screen.getByText(/compare le CV de référence du profil « Qualité aéronautique »/)).toBeOnTheScreen();
    expect(screen.getAllByRole("button").map((control) => control.props.accessibilityLabel)).toEqual(["Fermer"]);
  });

  it("says a Match Score that could not be computed is not computable, never 0 / 100", async () => {
    await openFiche(RHONE.id);
    await userEvent.setup().press(button("Correspondance"));
    expect(screen.getAllByText("Non calculable").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 / 100")).toBeNull();
  });

  it("opens L'offre: its facts and its site, read only", async () => {
    await openFiche();
    await userEvent.setup().press(button("L'offre"));
    expect(screen.getByText("Employeur")).toBeOnTheScreen();
    expect(screen.getByText("Toulouse")).toBeOnTheScreen();
    expect(screen.getByText("20 octobre 2026")).toBeOnTheScreen();
    expect(screen.getAllByRole("button").map((control) => control.props.accessibilityLabel)).toEqual(["Fermer", "Voir l'offre sur welcometothejungle.com"]);
  });
});

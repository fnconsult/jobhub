// The key screens at the system's largest text size (#705, ADR-0009), through the app's real entry: on a phone and on a
// tablet, every control named for VoiceOver and TalkBack, no text cut, and a tablet's columns opened full page. The
// automatic part of the app's accessibility floor; the Maestro flows look at the same screens on simulators
// (apps/mobile/maestro/flows/2-ecrans-cles.yaml), where their captures are checked.
import { screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Dimensions } from "react-native";
import { fakeCoachWeb, withCoach, type FakeCoachWeb } from "../src/coach/testing";
import type { AppSession } from "../src/session/app-session";
import type { fakeWebApp } from "../src/session/testing";
import { cutTexts, unnamedControls } from "../src/testing-accessibility";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));
const mockWeb = {} as { app: ReturnType<typeof fakeWebApp>; session: AppSession };
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
const jobOffer = { id: "o1", title: "Responsable qualité et amélioration continue des sites", employer: "Aéroline Industries", location: "Toulouse", url: null, postedAt: null, expiredAt: null };
/** The web app's reads behind the key screens: long names, which a phone at the largest text size must wrap, not cut. */
const coachWeb = (): FakeCoachWeb =>
  fakeCoachWeb({
    conversations: [{ id: "c1", title: "Préparer la négociation du salaire avec la directrice des ressources humaines" }],
    reads: {
      "/api/applications": {
        applications: [
          { id: "a1", title: jobOffer.title, employer: jobOffer.employer, status: "interview", matchScore: 82, toHandle: "follow_up", nextDeadline: null, expired: false, reportedByYou: false, archived: false },
        ],
        toHandle: 1,
        archivedHidden: 0,
      },
      "/api/applications/a1": {
        id: "a1",
        status: "interview",
        statusChangedAt: "2026-11-02T09:00:00.000Z",
        createdAt: "2026-10-28T09:00:00.000Z",
        jobOffer,
        profile: { id: "p1", name: "Qualité aéronautique" },
        matchScore: 82,
        reportedUnavailableAt: null,
        interviews: [],
      },
      "/api/applications/a1/documents": { documentLanguage: "fr", documents: [] },
      "/api/agenda": {
        toSchedule: [],
        days: [
          {
            day: "2031-03-12",
            items: [
              {
                kind: "interview",
                id: "i1",
                applicationId: "a1",
                jobTitle: jobOffer.title,
                employer: jobOffer.employer,
                scheduledAt: "2031-03-12T13:30:00.000Z",
                durationMinutes: 45,
                format: "video",
                place: "Teams : https://teams.microsoft.com/l/meetup-join/exemple",
                note: null,
                cancelledAt: null,
                reschedules: [],
              },
            ],
          },
        ],
      },
      "/api/job-searches": { profiles: [{ profile: { id: "p1", name: "Qualité aéronautique" }, searches: [] }], unseen: 0 },
    },
  });

/** The system's largest text size, as React Native reads it: iOS's AX5, Android's 200 % (apps/mobile/maestro/devices.ts). */
const LARGEST = { ios: 3.571, android: 2 };
const window = (width: number, height: number, fontScale: number) => {
  const size = { width, height, scale: 2, fontScale };
  Dimensions.set({ window: size, screen: size });
};
const PHONE = [375, 667] as const;
const TABLET = [1376, 1032] as const;

async function launch(path: string) {
  if ((await mockWeb.session.current()).kind !== "signedIn") {
    await mockWeb.session.askLink(EMAIL);
    await mockWeb.session.openLink(mockWeb.app.linkFor(EMAIL));
  }
  jest.spyOn(globalThis, "fetch").mockImplementation(withCoach(coachWeb(), (input, init) => mockWeb.app.fetch(input, init)));
  await renderRouter("./src/app", { initialUrl: path });
  await waitFor(() => expect(screen.queryByLabelText("Ouverture de votre compte…")).toBeNull());
}

beforeEach(() => jest.requireMock("../src/session/instance"));
afterEach(() => jest.restoreAllMocks());

/** Each key screen (apps/mobile/maestro/seed.ts, KEY_SCREENS), as the person reaches it, and what shows it is there. */
const KEY_SCREENS: [string, string, () => Promise<unknown>][] = [
  ["accueil", "/", () => screen.findByLabelText("Votre message")],
  ["candidatures", "/candidatures", () => screen.findByText("1 candidature")],
  ["fiche", "/candidatures/a1", async () => (await screen.findByLabelText("Votre message"), await openFiche())],
  ["recherches", "/recherches", () => screen.findByText("Vos recherches par profil")],
  ["agenda", "/agenda", () => screen.findByText(jobOffer.title)],
  ["conversation", "/conversations/c1", () => screen.findByLabelText("Votre message")],
];

/** The Fiche, full page behind « Fiche » when the panes are not columns. */
async function openFiche() {
  if (screen.queryByText("Statut")) return;
  await userEvent.setup().press(screen.getByRole("button", { name: "Fiche" }));
  await screen.findByText("Statut");
}

describe.each([
  ["a small phone, iOS's largest text", PHONE, LARGEST.ios],
  ["a small phone, Android's largest text", PHONE, LARGEST.android],
  ["a tablet in landscape, iOS's largest text", TABLET, LARGEST.ios],
])("The key screens on %s (#705)", (_name, [width, height], fontScale) => {
  beforeEach(() => window(width, height, fontScale));

  it.each(KEY_SCREENS)("%s names every control for VoiceOver and TalkBack, and cuts no text", async (_screen, path, shown) => {
    await launch(path);
    await shown();
    expect(unnamedControls()).toEqual([]);
    expect(cutTexts()).toEqual([]);
  });
});

describe("A tablet's columns at the largest text size (#705)", () => {
  it("opens the Fiche beside the conversation at the default text size", async () => {
    window(...TABLET, 1);
    await launch("/candidatures/a1");
    expect(await screen.findByText("Statut")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Masquer le menu" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Fermer" })).toBeNull();
  });

  it("opens it full page, with « Fermer », the Sidebar in a drawer, at the largest", async () => {
    window(...TABLET, LARGEST.ios);
    await launch("/candidatures/a1");
    await screen.findByLabelText("Votre message");
    expect(screen.getByRole("button", { name: "Menu" })).toBeOnTheScreen();
    await openFiche();
    expect(screen.getByRole("button", { name: "Fermer" })).toBeOnTheScreen();
  });
});

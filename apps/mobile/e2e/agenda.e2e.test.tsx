// End-to-end for the Agenda (#693) through the app's real entry: Expo Router mounts src/app/agenda with the real
// system-sheets module; only the device's native modules (expo-calendar, expo-sharing, expo-file-system) are faked, and
// what the person would see on the system's sheets is asserted from what reaches them. The web app is faked at the
// network: its session endpoints (src/session/testing) and `GET /api/agenda` (./agenda-web), which answers the
// signed-in Candidate's Agenda only to a request carrying their session cookie. The clock is fixed.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { screen, userEvent, within } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Dimensions, Linking, Platform } from "react-native";
import { serveAgenda } from "./agenda-web";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "fr" }],
}));
jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  useFonts: () => [true, null],
}));

/** The device's network as expo-network reports it: connected. */
jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove: () => {} }),
}));

// The web app the app signs in to (#685), as app.e2e.test.tsx fakes it.
const mockWeb = {} as {
  app: ReturnType<typeof import("../src/session/testing").fakeWebApp>;
  session: import("../src/session/app-session").AppSession;
};
jest.mock("../src/session/instance", () => {
  const { fakeWebApp, memoryStorage, TEST_BASE_URL } = jest.requireActual(
    "../src/session/testing",
  );
  const { createAppSession } = jest.requireActual("../src/session/app-session");
  mockWeb.app = fakeWebApp();
  mockWeb.session = createAppSession({
    baseURL: TEST_BASE_URL,
    storage: memoryStorage(),
    fetch: mockWeb.app.fetch,
    passkeys: mockWeb.app.deviceWithoutPasskey(),
  });
  // The app's calls to the API as src/session/instance.ts makes them, with the session's cookie, at the network
  // (the global fetch, which ./agenda-web serves), looked up at each call so a test's spy is the one called.
  const { createApi } = jest.requireActual("../src/api/web-api");
  const appApi = createApi({
    baseURL: TEST_BASE_URL,
    cookie: () => mockWeb.session.cookie(),
    fetch: (input: string, init?: RequestInit) => globalThis.fetch(input, init),
  });
  return { appSession: mockWeb.session, appApi };
});
// Not hoisted: it replaces Expo Router's own mock, whose scheme is not the app's (as in app.e2e.test.tsx).
jest.doMock("expo-linking", () => ({
  ...jest.requireActual("expo-linking"),
  useLinkingURL: () => null,
}));
const EMAIL = "marie.dupont@example.fr";
async function signedIn() {
  jest.requireMock("../src/session/instance");
  if ((await mockWeb.session.current()).kind === "signedIn") return;
  await mockWeb.session.askLink(EMAIL);
  await mockWeb.session.openLink(mockWeb.app.linkFor(EMAIL));
}

const mockCalendar = {
  requestCalendarPermissions: jest.fn<
    Promise<{ granted: boolean }>,
    [boolean]
  >(),
  addEventWithForm: jest.fn<Promise<unknown>, [Record<string, unknown>]>(
    async () => ({ action: "saved" }),
  ),
  getCalendars: jest.fn(),
  listEvents: jest.fn(),
};
const mockLegacy = {
  createEventInCalendarAsync: jest.fn<
    Promise<unknown>,
    [Record<string, unknown>]
  >(async () => ({ action: "done" })),
};
const mockWritten: { uri: string; content: string }[] = [];
const mockShare = jest.fn<Promise<void>, [string, unknown]>(async () => {});

jest.mock("expo-calendar", () => ({
  requestCalendarPermissions: (writeOnly: boolean) =>
    mockCalendar.requestCalendarPermissions(writeOnly),
  getDefaultCalendarSync: () => ({
    addEventWithForm: (event: Record<string, unknown>) =>
      mockCalendar.addEventWithForm(event),
  }),
  getCalendars: (...args: unknown[]) => mockCalendar.getCalendars(...args),
  listEvents: (...args: unknown[]) => mockCalendar.listEvents(...args),
}));
jest.mock("expo-calendar/legacy", () => ({
  createEventInCalendarAsync: (event: Record<string, unknown>) =>
    mockLegacy.createEventInCalendarAsync(event),
}));
jest.mock("expo-sharing", () => ({
  shareAsync: (uri: string, options: unknown) => mockShare(uri, options),
}));
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    uri: string;
    constructor(directory: string, name: string) {
      this.uri = `${directory}/${name}`;
    }
    create() {}
    write(content: string) {
      mockWritten.push({ uri: this.uri, content });
    }
  },
}));

// Tuesday 20 October 2026, 08:00 UTC (10:00 in Paris, summer time). Only Date is faked.
const NOW = new Date("2026-10-20T08:00:00.000Z");
const onPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
const button = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(async () => {
  jest.clearAllMocks();
  mockWritten.length = 0;
  // The read cache the last test left on the device: each test reads its Agenda afresh.
  await AsyncStorage.clear();
  jest.useFakeTimers({
    now: NOW,
    doNotFake: [
      "nextTick",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "performance",
      "hrtime",
    ],
  });
  const size = { width: 390, height: 844, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
  onPlatform("ios");
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** The web app's `GET /api/agenda` for the signed-in Candidate, once the fake web app is built (by signing in). */
let agendaRoute: ReturnType<typeof serveAgenda>;
/** Signed in, the web app serving the Agenda (`changed` before the page reads it), the Agenda's page opened. */
async function launchAgenda(
  changed: (route: typeof agendaRoute) => void = () => {},
) {
  await signedIn();
  agendaRoute = serveAgenda(mockWeb.app, EMAIL);
  changed(agendaRoute);
  await renderRouter("./src/app", { initialUrl: "/agenda" });
}
/** The Agenda's page, once its list is read from the web app. */
async function openAgenda() {
  await launchAgenda();
  await screen.findByRole("heading", { name: "À planifier" });
}

const INTERVIEW_BUTTON = /^Ajouter à mon calendrier : Responsable qualité/;
const SESSION_BUTTON = /^Ajouter à mon calendrier : Séance avec Claire Martin/;

describe("Agenda, read from the web app", () => {
  it("shows the signed-in Candidate's Agenda as GET /api/agenda answers it, asked with their session", async () => {
    await openAgenda();
    expect(agendaRoute.asked).toContain(EMAIL);
    expect(
      screen.getByText("Séance avec Paul Durand, payée le 18 octobre 2026"),
    ).toBeOnTheScreen();
    expect(
      screen.getAllByRole("link", { name: /Responsable qualité/ }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: /Claire Martin/ }),
    ).toBeOnTheScreen();
  });

  it("says there is nothing when the Candidate's Agenda is empty, and shows no other", async () => {
    await launchAgenda(
      (route) => (route.agenda = { toSchedule: [], days: [] }),
    );
    expect(
      await screen.findByText(/^Aucun rendez-vous à venir/),
    ).toBeOnTheScreen();
    expect(screen.queryByText("À planifier")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says when the Agenda could not be read, and reads it again on « Réessayer »", async () => {
    await launchAgenda((route) => (route.status = 500));
    expect(
      await screen.findByText(
        "L'agenda n'a pas pu être chargé. Réessayez dans quelques instants.",
        {},
        { timeout: 10_000 },
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole("link")).toBeNull();

    agendaRoute.status = 200;
    await userEvent.setup().press(button("Réessayer"));
    expect(
      await screen.findByRole("heading", { name: "À planifier" }),
    ).toBeOnTheScreen();
  });
});

describe("Agenda, the list", () => {
  it("puts « À planifier » first with the Human Coach's booking link, then the days", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await openAgenda();
    const headings = screen
      .getAllByRole("heading")
      .map((h) => h.props.children);
    expect(headings[0]).toBe("À planifier");
    expect(headings.length).toBeGreaterThan(1);
    await userEvent
      .setup()
      .press(button("Choisir mon créneau avec Paul Durand sur Cal.com"));
    expect(open).toHaveBeenCalledWith("https://cal.com/paul-durand");
  });

  it("strikes a Cancelled Interview through with its date of cancellation, and says « modifié par le coach »", async () => {
    await openAgenda();
    const cancelled = screen
      .getAllByRole("link", { name: /Responsable qualité/ })
      .find((l) => within(l).queryByText("Entretien annulé"));
    expect(cancelled).toBeDefined();
    expect(within(cancelled!).getByText("Responsable qualité")).toHaveStyle({
      textDecorationLine: "line-through",
    });
    expect(screen.getByText("Annulé le 19 octobre 2026")).toBeOnTheScreen();
    expect(
      within(screen.getByRole("link", { name: /Claire Martin/ })).getByText(
        "modifié par le coach",
      ),
    ).toBeOnTheScreen();
  });

  it("leads an Interview to its Application's Interviews Section", async () => {
    await openAgenda();
    const user = userEvent.setup();
    const interview = screen
      .getAllByRole("link", { name: /Responsable qualité/ })
      .find((l) => !within(l).queryByText("Entretien annulé"));
    await user.press(interview!);
    expect(screen).toHavePathname("/candidatures/a1/entretiens");
  });

  it("leads a Coaching Session to its Human Coach", async () => {
    await openAgenda();
    const user = userEvent.setup();
    await user.press(screen.getByRole("link", { name: /Claire Martin/ }));
    expect(screen).toHavePathname("/coachs");
  });
});

describe("Agenda, « Ajouter au calendrier »", () => {
  it("opens the system's « Nouvel événement » filled in: title, Paris time converted, duration, video link", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({
      granted: true,
    });
    await openAgenda();
    await userEvent.setup().press(button(INTERVIEW_BUTTON));
    expect(mockCalendar.requestCalendarPermissions).toHaveBeenCalledWith(true);
    expect(mockCalendar.addEventWithForm).toHaveBeenCalledTimes(1);
    const event = mockCalendar.addEventWithForm.mock.calls[0]![0] as {
      title: string;
      startDate: Date;
      endDate: Date;
      url?: string;
      location?: string;
    };
    expect(event.title).toBe("Entretien — Responsable qualité, Aéroline");
    // 12:00 in Paris on 21 October (UTC+2) is 10:00 UTC, for 45 minutes.
    expect(event.startDate.toISOString()).toBe("2026-10-21T10:00:00.000Z");
    expect(event.endDate.toISOString()).toBe("2026-10-21T10:45:00.000Z");
    expect(event.url).toBe("https://teams.microsoft.com/l/meetup-join/exemple");
    expect(event.location).toContain(
      "https://teams.microsoft.com/l/meetup-join/exemple",
    );
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("fills in a Coaching Session with its Human Coach, its hour and its video link", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({
      granted: true,
    });
    await openAgenda();
    await userEvent.setup().press(button(SESSION_BUTTON));
    const event = mockCalendar.addEventWithForm.mock.calls[0]![0] as {
      title: string;
      startDate: Date;
      endDate: Date;
      url?: string;
    };
    expect(event.title).toContain("Claire Martin");
    expect(event.startDate.toISOString()).toBe("2026-10-23T09:00:00.000Z");
    expect(event.endDate.toISOString()).toBe("2026-10-23T10:00:00.000Z");
    expect(event.url).toBe("https://meet.google.com/exemple");
  });

  it("opens the calendar app's new event screen on Android, with no permission asked", async () => {
    onPlatform("android");
    await openAgenda();
    await userEvent.setup().press(button(INTERVIEW_BUTTON));
    expect(mockCalendar.requestCalendarPermissions).not.toHaveBeenCalled();
    expect(mockLegacy.createEventInCalendarAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Entretien — Responsable qualité, Aéroline",
      }),
    );
  });

  it("shares the Calendar file (.ics) through the system's share sheet when access is refused", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({
      granted: false,
    });
    await openAgenda();
    await userEvent.setup().press(button(INTERVIEW_BUTTON));
    expect(mockCalendar.addEventWithForm).not.toHaveBeenCalled();
    expect(mockShare).toHaveBeenCalledTimes(1);
    const [uri, options] = mockShare.mock.calls[0]!;
    expect(uri).toMatch(/^file:\/\/\/cache\/.+\.ics$/);
    expect(options).toEqual({
      mimeType: "text/calendar",
      UTI: "public.calendar-event",
    });
    const ics = mockWritten[0]!.content;
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;TZID=Europe/Paris:20261021T120000");
    expect(ics).toContain("DTEND;TZID=Europe/Paris:20261021T124500");
    expect(ics).toContain("Responsable qualité");
  });

  it("shares the Calendar file when the calendar is unavailable (the sheet throws)", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({
      granted: true,
    });
    mockCalendar.addEventWithForm.mockRejectedValueOnce(
      new Error("no calendar"),
    );
    await openAgenda();
    await userEvent.setup().press(button(INTERVIEW_BUTTON));
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockWritten[0]!.content).toContain("BEGIN:VCALENDAR");
  });

  it("offers no calendar entry for a Cancelled Interview, and reads no calendar", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({
      granted: true,
    });
    await openAgenda();
    const buttons = screen.getAllByRole("button", {
      name: /^Ajouter à mon calendrier/,
    });
    expect(buttons).toHaveLength(2); // the upcoming Interview and the Coaching Session, not the cancelled Interview
    // The Cancelled Interview is at 15:00 on 21 October: no button names it.
    expect(screen.queryByRole("button", { name: /à 15:00/ })).toBeNull();
    const user = userEvent.setup();
    await user.press(button(INTERVIEW_BUTTON));
    await user.press(button(SESSION_BUTTON));
    expect(mockCalendar.getCalendars).not.toHaveBeenCalled();
    expect(mockCalendar.listEvents).not.toHaveBeenCalled();
  });
});

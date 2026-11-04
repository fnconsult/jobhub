// End-to-end for the Agenda (#693) through the app's real entry: Expo Router mounts src/app/agenda with the real
// system-sheets module; only the device's native modules (expo-calendar, expo-sharing, expo-file-system) are faked, and
// what the person would see on the system's sheets is asserted from what reaches them. The clock is fixed so the
// sample Agenda's relative dates are known.
import { screen, userEvent, within } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";
import { Dimensions, Linking, Platform } from "react-native";

jest.setTimeout(60_000);

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "fr" }] }));
jest.mock("expo-font", () => ({ ...jest.requireActual("expo-font"), useFonts: () => [true, null] }));

const mockCalendar = {
  requestCalendarPermissions: jest.fn<Promise<{ granted: boolean }>, [boolean]>(),
  addEventWithForm: jest.fn<Promise<unknown>, [Record<string, unknown>]>(async () => ({ action: "saved" })),
  getCalendars: jest.fn(),
  listEvents: jest.fn(),
};
const mockLegacy = { createEventInCalendarAsync: jest.fn<Promise<unknown>, [Record<string, unknown>]>(async () => ({ action: "done" })) };
const mockWritten: { uri: string; content: string }[] = [];
const mockShare = jest.fn<Promise<void>, [string, unknown]>(async () => {});

jest.mock("expo-calendar", () => ({
  requestCalendarPermissions: (writeOnly: boolean) => mockCalendar.requestCalendarPermissions(writeOnly),
  getDefaultCalendarSync: () => ({ addEventWithForm: (event: Record<string, unknown>) => mockCalendar.addEventWithForm(event) }),
  getCalendars: (...args: unknown[]) => mockCalendar.getCalendars(...args),
  listEvents: (...args: unknown[]) => mockCalendar.listEvents(...args),
}));
jest.mock("expo-calendar/legacy", () => ({ createEventInCalendarAsync: (event: Record<string, unknown>) => mockLegacy.createEventInCalendarAsync(event) }));
jest.mock("expo-sharing", () => ({ shareAsync: (uri: string, options: unknown) => mockShare(uri, options) }));
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
const onPlatform = (os: typeof Platform.OS) => Object.defineProperty(Platform, "OS", { value: os, configurable: true });
const button = (name: string | RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  jest.clearAllMocks();
  mockWritten.length = 0;
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ["nextTick", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback", "performance", "hrtime"],
  });
  const size = { width: 390, height: 844, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
  onPlatform("ios");
});
afterEach(() => jest.useRealTimers());

async function openAgenda() {
  await renderRouter("./src/app", { initialUrl: "/agenda" });
}

const INTERVIEW_BUTTON = /^Ajouter à mon calendrier : Responsable qualité/;
const SESSION_BUTTON = /^Ajouter à mon calendrier : Séance avec Claire Martin/;

describe("Agenda, the list", () => {
  it("puts « À planifier » first with the Human Coach's booking link, then the days", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await openAgenda();
    const headings = screen.getAllByRole("heading").map((h) => h.props.children);
    expect(headings[0]).toBe("À planifier");
    expect(headings.length).toBeGreaterThan(1);
    await userEvent.setup().press(button("Choisir mon créneau avec Paul Durand sur Cal.com"));
    expect(open).toHaveBeenCalledWith("https://cal.com/");
  });

  it("strikes a Cancelled Interview through with its date of cancellation, and says « modifié par le coach »", async () => {
    await openAgenda();
    const cancelled = screen.getAllByRole("link", { name: /Responsable qualité/ }).find((l) => within(l).queryByText("Entretien annulé"));
    expect(cancelled).toBeDefined();
    expect(within(cancelled!).getByText("Responsable qualité")).toHaveStyle({ textDecorationLine: "line-through" });
    expect(screen.getByText("Annulé le 19 octobre 2026")).toBeOnTheScreen();
    expect(within(screen.getByRole("link", { name: /Claire Martin/ })).getByText("modifié par le coach")).toBeOnTheScreen();
  });

  it("leads an Interview to its Application's Interviews Section", async () => {
    await openAgenda();
    const user = userEvent.setup();
    const interview = screen.getAllByRole("link", { name: /Responsable qualité/ }).find((l) => !within(l).queryByText("Entretien annulé"));
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
    mockCalendar.requestCalendarPermissions.mockResolvedValue({ granted: true });
    await openAgenda();
    await userEvent.setup().press(button(INTERVIEW_BUTTON));
    expect(mockCalendar.requestCalendarPermissions).toHaveBeenCalledWith(true);
    expect(mockCalendar.addEventWithForm).toHaveBeenCalledTimes(1);
    const event = mockCalendar.addEventWithForm.mock.calls[0]![0] as { title: string; startDate: Date; endDate: Date; url?: string; location?: string };
    expect(event.title).toBe("Entretien — Responsable qualité, Aéroline");
    // 12:00 in Paris on 21 October (UTC+2) is 10:00 UTC, for 45 minutes.
    expect(event.startDate.toISOString()).toBe("2026-10-21T10:00:00.000Z");
    expect(event.endDate.toISOString()).toBe("2026-10-21T10:45:00.000Z");
    expect(event.url).toBe("https://teams.microsoft.com/l/meetup-join/exemple");
    expect(event.location).toContain("https://teams.microsoft.com/l/meetup-join/exemple");
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("fills in a Coaching Session with its Human Coach, its hour and its video link", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({ granted: true });
    await openAgenda();
    await userEvent.setup().press(button(SESSION_BUTTON));
    const event = mockCalendar.addEventWithForm.mock.calls[0]![0] as { title: string; startDate: Date; endDate: Date; url?: string };
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
    expect(mockLegacy.createEventInCalendarAsync).toHaveBeenCalledWith(expect.objectContaining({ title: "Entretien — Responsable qualité, Aéroline" }));
  });

  it("shares the Calendar file (.ics) through the system's share sheet when access is refused", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({ granted: false });
    await openAgenda();
    await userEvent.setup().press(button(INTERVIEW_BUTTON));
    expect(mockCalendar.addEventWithForm).not.toHaveBeenCalled();
    expect(mockShare).toHaveBeenCalledTimes(1);
    const [uri, options] = mockShare.mock.calls[0]!;
    expect(uri).toMatch(/^file:\/\/\/cache\/.+\.ics$/);
    expect(options).toEqual({ mimeType: "text/calendar", UTI: "public.calendar-event" });
    const ics = mockWritten[0]!.content;
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;TZID=Europe/Paris:20261021T120000");
    expect(ics).toContain("DTEND;TZID=Europe/Paris:20261021T124500");
    expect(ics).toContain("Responsable qualité");
  });

  it("shares the Calendar file when the calendar is unavailable (the sheet throws)", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({ granted: true });
    mockCalendar.addEventWithForm.mockRejectedValueOnce(new Error("no calendar"));
    await openAgenda();
    await userEvent.setup().press(button(INTERVIEW_BUTTON));
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockWritten[0]!.content).toContain("BEGIN:VCALENDAR");
  });

  it("offers no calendar entry for a Cancelled Interview, and reads no calendar", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({ granted: true });
    await openAgenda();
    const buttons = screen.getAllByRole("button", { name: /^Ajouter à mon calendrier/ });
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

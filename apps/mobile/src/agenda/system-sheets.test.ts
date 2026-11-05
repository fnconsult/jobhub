import { Platform } from "react-native";
import type { AgendaEvent } from "./calendar-event";

const mockCalendar = {
  requestCalendarPermissions: jest.fn(),
  getDefaultCalendarSync: jest.fn(),
  addEventWithForm: jest.fn(async () => ({ action: "saved" })),
  getCalendars: jest.fn(),
  listEvents: jest.fn(),
};
const mockLegacy = { createEventInCalendarAsync: jest.fn<Promise<{ action: string }>, [unknown]>(async () => ({ action: "done" })) };
const mockWritten: { uri: string; content: string }[] = [];
const mockSharing = { shareAsync: jest.fn<Promise<void>, [string, unknown]>(async () => {}) };

jest.mock("expo-calendar", () => ({
  requestCalendarPermissions: (writeOnly: boolean) => mockCalendar.requestCalendarPermissions(writeOnly),
  getDefaultCalendarSync: () => ({ addEventWithForm: mockCalendar.addEventWithForm }),
  getCalendars: (...args: unknown[]) => mockCalendar.getCalendars(...args),
  listEvents: (...args: unknown[]) => mockCalendar.listEvents(...args),
}));
jest.mock("expo-calendar/legacy", () => ({ createEventInCalendarAsync: (event: unknown) => mockLegacy.createEventInCalendarAsync(event) }));
jest.mock("expo-sharing", () => ({ shareAsync: (uri: string, options: unknown) => mockSharing.shareAsync(uri, options) }));
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

import { systemSheets } from "./system-sheets";

const event: AgendaEvent = {
  uid: "interview-i1@jobbbox.fr",
  title: "Entretien — Responsable qualité, Aéroline",
  startDate: new Date("2026-10-22T12:30:00.000Z"),
  endDate: new Date("2026-10-22T13:15:00.000Z"),
  location: "https://teams.example.com/l/abc",
  url: "https://teams.example.com/l/abc",
  sequence: 0,
};

const onPlatform = (os: typeof Platform.OS) => Object.defineProperty(Platform, "OS", { value: os, configurable: true });

beforeEach(() => jest.clearAllMocks());

describe("the system's sheets, on iOS", () => {
  beforeEach(() => onPlatform("ios"));

  it("asks for write-only access, then opens « Nouvel événement » filled in, and reads no calendar", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({ granted: true });
    expect(await systemSheets.newEvent(event)).toBe("shown");
    expect(mockCalendar.requestCalendarPermissions).toHaveBeenCalledWith(true);
    expect(mockCalendar.addEventWithForm).toHaveBeenCalledWith({
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      location: event.location,
      url: event.url,
      notes: undefined,
    });
    expect(mockCalendar.getCalendars).not.toHaveBeenCalled();
    expect(mockCalendar.listEvents).not.toHaveBeenCalled();
  });

  it("says the calendar is unavailable when access is refused, and opens nothing", async () => {
    mockCalendar.requestCalendarPermissions.mockResolvedValue({ granted: false });
    expect(await systemSheets.newEvent(event)).toBe("unavailable");
    expect(mockCalendar.addEventWithForm).not.toHaveBeenCalled();
  });
});

describe("the system's sheets, on Android", () => {
  beforeEach(() => onPlatform("android"));

  it("opens the calendar app's new event screen without asking for any permission", async () => {
    expect(await systemSheets.newEvent(event)).toBe("shown");
    expect(mockCalendar.requestCalendarPermissions).not.toHaveBeenCalled();
    expect(mockLegacy.createEventInCalendarAsync).toHaveBeenCalledWith(expect.objectContaining({ title: event.title, startDate: event.startDate, location: event.location }));
  });
});

describe("sharing a Calendar file", () => {
  it("writes it to the cache and opens the share sheet on it as a calendar event", async () => {
    await systemSheets.shareFile("entretien-2026-10-22.ics", "BEGIN:VCALENDAR\r\n");
    expect(mockWritten).toEqual([{ uri: "file:///cache/entretien-2026-10-22.ics", content: "BEGIN:VCALENDAR\r\n" }]);
    expect(mockSharing.shareAsync).toHaveBeenCalledWith("file:///cache/entretien-2026-10-22.ics", { mimeType: "text/calendar", UTI: "public.calendar-event" });
  });
});

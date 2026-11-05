import * as Calendar from "expo-calendar";
import { createEventInCalendarAsync } from "expo-calendar/legacy";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import type { CalendarSheets } from "./add-to-calendar";

/**
 * The device's own sheets (ADR-0029, #693). No calendar is ever read: on iOS 17+ the app asks for write-only access
 * (app.json's expo-calendar plugin, `writeOnlyAccess`) and fills in EventKit's « Nouvel événement » sheet on its
 * virtual calendar; on Android the calendar app's own « new event » screen opens, which needs no permission (the
 * calendar permissions are blocked in app.json). The Calendar file goes through the system's share sheet.
 */
export const systemSheets: CalendarSheets = {
  async newEvent({ title, startDate, endDate, location, url, notes }) {
    if (Platform.OS === "ios") {
      const { granted } = await Calendar.requestCalendarPermissions(true);
      if (!granted) return "unavailable";
      await Calendar.getDefaultCalendarSync().addEventWithForm({ title, startDate, endDate, location, url, notes });
      return "shown";
    }
    if (Platform.OS === "android") {
      // No URL field on Android: the video link is in the location. Its answer is always "done", saved or not.
      await createEventInCalendarAsync({ title, startDate, endDate, location, notes });
      return "shown";
    }
    return "unavailable";
  },

  async shareFile(name, content) {
    const file = new File(Paths.cache, name);
    file.create({ overwrite: true });
    file.write(content);
    await Sharing.shareAsync(file.uri, { mimeType: "text/calendar", UTI: "public.calendar-event" });
  },
};

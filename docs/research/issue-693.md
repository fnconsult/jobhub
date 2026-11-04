# Research for issue #693: Agenda list and "Add to calendar" through the system sheet

Scope: only the external facts the issue depends on (ADR-0029: no calendar read, no sync). Checked 2026-11-04 against first-party docs, read through a page summariser, so wording is paraphrased. Product code is out of scope. The app is on Expo SDK 58 (`apps/mobile/package.json`).

## 1. expo-calendar: system event dialog

Source: https://docs.expo.dev/versions/latest/sdk/calendar/
- `Calendar.createEventInCalendarAsync(eventData, presentationOptions)` opens the OS event dialog, iOS and Android. In the "latest" docs it is marked deprecated and only works when imported from `expo-calendar/legacy`; the replacement is `ExpoCalendar.addEventWithForm(options)`, which "requires at least write-only calendar permission".
- Result `DialogEventResult`: iOS `action` is `saved`, `canceled` or `deleted` (plus `id`); Android `action` is always `done` and `id` is always `null`. So on Android we cannot tell saved from canceled.
- Android: "if you only use the system calendar UI, you don't need to request any permissions". `READ_CALENDAR`/`WRITE_CALENDAR` are only needed for the programmatic API; do not declare them (ADR-0029, no read).
- Event time zone: `Event.timeZone` set, otherwise device zone. Dates are ISO 8601.
- NOT verified: which of the two APIs SDK 58 ships exactly (the page is the "latest" version, not pinned to SDK 58). Check the installed `expo-calendar` types before coding. NOT verified either: whether the legacy dialog needs any permission on iOS.

## 2. iOS 17 write-only access

Sources: https://docs.expo.dev/versions/latest/sdk/calendar/ (config plugin); Apple page https://developer.apple.com/documentation/eventkit/accessing-the-event-store could not be read by the summariser, so the Apple points below come from general knowledge and are NOT verified against Apple.
- Expo: `requestCalendarPermissions(true)` asks for write-only on iOS 17+. Write-only allows creating events (`createEvent`, `addEventWithForm`) but not `getCalendars`/`listEvents`/`presentPicker` (full access). With write-only, `getCalendars(EVENT)` returns one virtual calendar.
- Config plugin: `writeOnlyAccess: true` sets `NSCalendarsWriteOnlyAccessUsageDescription` and omits `NSCalendarsFullAccessUsageDescription`; message via `writeOnlyCalendarPermission`. Default is `false`, so it must be set explicitly, otherwise the full-access strings are added (contradicts "no read").
- Expo does not document the denied-permission behaviour beyond `PermissionResponse.canAskAgain`; the issue's fallback (share the .ics) must be driven by `granted === false` or a thrown error. Test on device.
- Apple (unverified): `EKEventEditViewController` is the system "New Event" sheet; iOS 17 `requestWriteOnlyAccessToEvents` and the `NSCalendarsWriteOnlyAccessUsageDescription` key. Missing usage key crashes on request.

## 3. iCalendar file (.ics) fallback

Source: https://datatracker.ietf.org/doc/html/rfc5545 (sections 3.1, 3.3.5, 3.3.11, 3.6.1, 3.7.x)
- VCALENDAR requires `VERSION:2.0` and `PRODID`. VEVENT requires `DTSTAMP` and `UID`; `DTSTART` is required when there is no `METHOD`. `DTEND` or `DURATION`, not both.
- Date-time: UTC form `YYYYMMDDTHHMMSSZ` (no TZID) is simplest and avoids shipping a VTIMEZONE; a TZID local time needs a matching VTIMEZONE. Convert Paris time to UTC before writing.
- Text: escape backslash, comma and semicolon with a backslash; newline as `\n`. CRLF line endings; fold lines over 75 octets (CRLF + one space).
- `METHOD` absent means information only, no scheduling transaction. Do not set `METHOD:REQUEST`.
- NOT verified (section not reached): `STATUS` values. The issue says no .ics for a Cancelled Agenda Item, so `STATUS:CANCELLED` is not needed.

## 4. Sharing the file with the system share sheet

Not researched here: `expo-sharing` (or `Share`) is not in `apps/mobile/package.json`. Before implementing, read https://docs.expo.dev/versions/latest/sdk/sharing/ for the mimeType (`text/calendar`), UTI (`public.calendar-event`) and `isAvailableAsync`, and check whether adding it needs a native rebuild.

## Implications for implementation
1. Set the config plugin `writeOnlyAccess: true`; declare no Android calendar permissions.
2. Verify the installed `expo-calendar` API for SDK 58 (legacy dialog vs `addEventWithForm`) before choosing.
3. Android result is always `done`: do not show "added" confirmation based on it.
4. Generate the .ics in UTC, with UID, DTSTAMP, PRODID, no METHOD.

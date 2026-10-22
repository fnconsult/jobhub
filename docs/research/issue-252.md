# Issue #252: Agenda ".ics" file per Agenda Item (RFC 5545)

Scope: only what a hand-written VEVENT generator needs. Checked on 2026-10-21 against RFC 5545, RFC 5546 and the IANA `text/calendar` registration (primary sources). Client import behaviour (Google, Apple, Outlook) is NOT documented by those sources and is not verified here (see Gaps).

## 1. File framing
- Line break is CRLF (RFC 5545 s3.1). Default charset is UTF-8 (s3.1.4).
- Folding (s3.1): lines SHOULD NOT exceed 75 octets, excluding the line break. Fold by inserting CRLF + one SPACE (or HTAB); unfolding removes the CRLF and that one whitespace character. Count OCTETS, not characters: accented French text ("Entretien — ...", the em dash is 3 bytes) must not be split inside a UTF-8 multi-octet sequence. s3.1 warns that naive folders split mid-sequence; do not.
- Serve as `text/calendar` (IANA registration, RFC 5545). `charset=utf-8` parameter is allowed; `method` parameter, if used, must equal the object's METHOD. Extension `.ics`.

## 2. Required properties
- VCALENDAR MUST include PRODID and VERSION (s3.6); VERSION is `2.0`.
- VEVENT: DTSTAMP and UID are required, once each (s3.6.1). DTSTART is required when the object has no METHOD. DTEND and DURATION MUST NOT both appear.
- DTSTAMP MUST be in UTC form (`YYYYMMDDTHHMMSSZ`) (s3.8.7.2).
- UID MUST be globally unique and persistent; receivers must store at least 255 octets (s3.8.4.7). Use a stable id derived from the Agenda Item id plus a domain, e.g. `agenda-item-<id>@<our-domain>`, never random per download.
- SEQUENCE starts at 0 and is incremented on each significant revision (s3.8.7.4). The RFC defines it for the organizer's scheduling flow; it does not say how clients treat a re-import. Optional here: the issue's decision is that a later change needs a new download (ADR-0029), so emitting a SEQUENCE derived from a reschedule counter, if one exists, is cheap but unverified to help.

## 3. METHOD
- RFC 5546 s3.2.1: PUBLISH requires an ORGANIZER in each component and forbids ATTENDEE. So if we emit `METHOD:PUBLISH` we must add an ORGANIZER; without METHOD there is no such requirement and DTSTART alone is enough (s3.6.1). Simplest compliant choice for a plain "add to calendar" download: omit METHOD, no ORGANIZER, no ATTENDEE. Whether Outlook prefers METHOD:PUBLISH is not covered by the RFCs (see Gaps).

## 4. Time zone (TZID=Europe/Paris)
- A DATE-TIME that is not UTC and not floating needs a TZID parameter on DTSTART/DTEND (s3.2.19); local time without TZID is "floating" (s3.3.5). TZID MUST NOT be combined with a `Z` UTC value (s3.3.5).
- One VTIMEZONE MUST be present per distinct TZID used (s3.2.19). It needs TZID, and each STANDARD/DAYLIGHT sub-component needs DTSTART, TZOFFSETFROM, TZOFFSETTO (s3.6.5).
- The RFC gives no Europe/Paris block (its example is America/New_York). Content below comes from our own knowledge of the tz database / EU rule, NOT fetched from a primary source here, so verify against tzdata (iana.org/time-zones, latest listed release 2026e, whose only change is Manitoba) before shipping: Europe/Paris is UTC+1 (CET) and UTC+2 (CEST); DST starts the last Sunday of March (02:00 local, offset +0100 to +0200) and ends the last Sunday of October (03:00 local, +0200 to +0100). Draft block:
```
BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
```
- Unit test idea: a summer and a winter Agenda Item both render the expected local wall-clock time with the same TZID; do not convert to UTC.

## 5. TEXT escaping (s3.3.11)
- Backslash MUST be escaped as `\\`; semicolon `\;`; comma `\,`; newline as `\n` (or `\N`). Colons are not escaped. Apply to SUMMARY, DESCRIPTION, LOCATION (all TEXT). Escape first the backslash, then the others, then fold.
- Escape user-entered notes and company/job names: a raw newline in the note would otherwise inject new content lines. CR/LF must be normalised to `\n`.
- LOCATION (s3.8.1.7) is TEXT: the "venue". DESCRIPTION (s3.8.1.5) is TEXT, a fuller description than SUMMARY.
- URL (s3.8.4.6) is a URI value, at most once per VEVENT, "a more dynamic rendition" of the event. It is a URI, not TEXT, so it is not text-escaped; keep it a valid absolute URL (percent-encode, no raw spaces or newlines).

## Gaps
- Google Calendar, Apple Calendar and Outlook behaviour (VTIMEZONE handling, METHOD preference, how a re-import with the same UID behaves, whether URL is shown) is not specified in the RFCs, and the Google Calendar API page fetched does not cover .ics import. This is the issue's "checked by hand once" acceptance item; no source read here substitutes for it.
- Europe/Paris VTIMEZONE block and the EU DST rule were not confirmed from a fetched primary source (see s4).
- RFC 5545 s3.8.4.7 and the RFC generally say nothing on same-UID re-import; the "later change needs a new download" hint in the issue stays accurate.

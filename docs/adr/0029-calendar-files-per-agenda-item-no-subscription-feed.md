# Calendar export is a file per Agenda Item, with no subscription feed or sync

Candidates can add an Agenda Item to their own calendar by downloading its Calendar file (.ics). Jobbbox reminds them with one Appointment Reminder email at 18:00 French time the day before, which they can switch off. We do not offer a calendar subscription feed (a secret iCal URL) or a Google or Outlook sync.

## Considered Options

- **A secret iCal feed URL**: calendars pull it on their own schedule, often hours late. Its URL works without signing in and would expose interview details (employer, place, note) to anyone who gets it, so it would need rotation and revocation, plus its own entry in the Data export story.
- **Google / Microsoft calendar sync**: this needs OAuth scopes on the Candidate's calendar, token storage and handling of two-way edits. That is a lot of trust to ask of this audience for a few items a month.

## Consequences

- A Candidate who reschedules must download the new file. The Agenda says so next to « Ajouter à mon calendrier ».
- A feed or a sync can be added later on top of the same Agenda Items without changing them.

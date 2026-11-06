# A Push notification is sent once per event key, and a Human Coach is reached through the account of their verified email

Status: accepted (#699)

Events run again: a worker retry, a re-saved page, a second click. A notification sent twice is worse than one missed, and a push cannot be taken back.

- **One notification per event key and per person.** `notify(personId, notification, { once })` records the key (the event, its object's id and what happened, e.g. `coach_review:<id>`) in `push_notification_sent` before queueing, with the date and never the text. If queueing fails the key is unmarked so the next run sends it. The table is purged at 90 days, deleted with the account and in the Data export. Rejected: deduplicating in memory or by the failures table (lost at restart, or blind to successes), and storing the text (it would keep what the notifications are built never to name).
- **A failing notification never stops its action.** Each module takes an optional `push` dependency and swallows its error.
- **The Appointment Reminder notification has its own switch**, apart from the email's, so either can be off without the other.
- **A Human Coach has no account of their own in the model, so they are reached through the account with their verified email**, only while not retired. Rejected: a device registered per coach record, which would duplicate sign-in and session handling (ADR-0076).
- **« Pas maintenant » is remembered on the device as declined**, distinct from refused (the system's answer), so the app never asks again in context.

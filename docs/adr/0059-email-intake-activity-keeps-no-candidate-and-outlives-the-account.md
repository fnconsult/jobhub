# Email intake's activity keeps no Candidate and outlives the account

_Builds on ADR-0051 (Forwarding address) for #449._

Administrators need to see what Email intake did (which emails were read, set aside, why) without seeing a Candidate's mail. So each Received offer email gets a row in `received_email_activity`, and each Linked mailbox event a row in `linked_mailbox_event`. Neither has a Candidate column: the date, the sender's domain, whether it was forwarded by hand, the kind, the offers new and already stored, the outcome and the Guardrail verdict, nothing that names a person.

- **Direction of the link**: the Candidate's `received_offer_email.activity_id` points to the activity row (ON DELETE SET NULL); nothing points back. Deleting the account leaves the rows, and they are not in the Data export, since they hold no personal data.
- **Retention**: 24 months, purged by the worker's hourly `email-intake.purge`, against 12 months for the Received offer email itself.
- **Who reads**: « Emails reçus » is a tab of Activité (super-admin, Support, Technique); Linked mailbox events are a Journal filter (super-admin, Technique).

## Considered Options

- **List the Received offer emails directly**: they hold the Candidate and go with the account (12 months), so the trail would vanish on deletion.
- **Keep a Candidate id and hide it in the UI**: still personal data; it would belong in the Data export and the erasure.

## Consequences

- The reading worker (#445) must call `recordReading`, or kind, offers and Guardrail stay empty.
- No Administrator can tell which Candidate an activity row was.

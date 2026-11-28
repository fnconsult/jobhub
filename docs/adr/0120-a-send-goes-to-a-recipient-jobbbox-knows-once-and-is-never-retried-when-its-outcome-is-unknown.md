# A Send goes to a recipient Jobbbox knows, once, and is never retried when its outcome is unknown

Decided in #1162, for the Sends ADR-0119 allows (amends ADR-0005).

- **Recipient.** Never chosen by the AI Coach nor typed in the form. It is a revealed Enriched Contact, the Outreach Message's contact or the Exchange's sender, read again at the click; if it or the draft changed since the card, the click is refused as a conflict. A model can then not send to an address it invented or was told by a Job Offer's text.
- **Once.** A row in `sent_email`, one per card, is reserved before Brevo is called. A second click finds it and sends nothing.
  - Brevo refuses the email (an HTTP refusal): the reservation is dropped and the Candidate may click again.
  - Any other error, a timeout or a mailer that cannot be built: the outcome is unknown. The Send is **never retried**, and the card tells the Candidate to look in their inbox, where they are in copy. A lost email is better than one sent twice to an employer.
- **Cap.** `COACH_SENDS_PER_DAY` (20) per Candidate and Paris-time day, shown on the card; reached, it replaces « Envoyer ».
- **Switched off.** `COACH_SEND_ENABLED` is off by default. The constant `SEND_IN_PRODUCTION` is false: no Send in Production until the Legal Review (#1160) is done, whatever the setting.
- **Kept.** Kind, recipient, subject, status, dates and Brevo's message id, never the text; in the Data export; deleted with the Application.

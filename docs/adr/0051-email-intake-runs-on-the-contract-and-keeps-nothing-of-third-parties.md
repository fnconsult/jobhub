# Email intake runs on the contract, keeps nothing of third parties, and its Back Office rows name no Candidate

The Candidate forwards offer emails to their Forwarding address (ADR-0050). Each email is the Candidate's correspondence and may name third parties: a recruiter's name, address and phone.

- **Legal basis**: performing the service the Candidate switches on and feeds email by email (GDPR art. 6.1.b), not a consent. Switching Email intake on shows what is read (forwarded emails), what is kept (the offers, never the email's text) and the AI processing (#438), and is recorded with its date. Switching it off or replacing the address stops the old one at once; what reaches it then is discarded unread; Job Offers already made stay, and the Candidate can delete them.
- **Third parties**: nothing of a person named in an email is kept (the AI's output excludes it and the email Guardrail checks it, #438), so recruiters are not informed one by one (art. 14.5.b); the privacy policy says so (art. 6.1.f for the moment the email is read).
- **What follows the Candidate**: their Forwarding address, the date it was switched on, their Received offer emails (outcome, sender's domain, date) and their private Job Offers (ADR-0049) are in the Data export and deleted with the account.
- **What the Back Office keeps**: the « Emails reçus » rows of Activité name no Candidate and are kept 24 months, like the run figures (ADR-0047).
- **Before launch**: a DPIA (correspondence processed by AI), the record of processing and the privacy policy updated, Brevo's data-processing agreement checked to cover inbound email.

## Considered Options

- **Consent (art. 6.1.a)**: a separate box would add nothing to forwarding, which the Candidate does deliberately, email by email; and withdrawing it would mean the same as switching the service off.
- **Back Office rows tied to the Candidate**: useful to support one Candidate, but they would be personal data, deleted with the account and part of the export, so no trend could be kept; support reads the Candidate's own page instead.
- **Informing each recruiter named in a message**: disproportionate for data that is never kept.

## Consequences

- A later IMAP beta (ADR-0050) is different in kind: Jobbbox would hold a password opening the whole mailbox. It needs its own explicit, dated, withdrawable consent saying so, the password encrypted like Provider Secrets (ADR-0020) and deleted when the mailbox is unlinked, read-only access to recognised senders only, and a reminder to revoke the app password at the provider.
- Connecting a mailbox through OAuth (Microsoft Graph, later Gmail) is decided with that beta's consent, not this one.

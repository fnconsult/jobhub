# MVP: web app and Chrome extension, drafts only

The MVP ships a responsive web app (PWA) and a Chrome extension. Native iOS/Android apps come later, built on the same API. The platform drafts Outreach Messages and follow-ups but does not send them: the Candidate copies the text or opens it in their own mail client. Connecting Gmail/Outlook (sending, and detecting replies to update Application Status automatically) is deferred.

## Amended by ADR-0076 (2026-11-04)

The native apps start: one Expo app for iOS, iPadOS and Android, phones and tablets, for Candidates and Human Coaches, as a companion to the web app on the same API and the same session. The PWA itself is not pursued. Drafts only still holds: the app sends no Outreach Message or Follow-up either.

# Email intake starts with the Forwarding address; Jobbbox holds no access to a mailbox at launch

Email intake (#426) needs the Candidate's offer emails. Research compared reaching them by connecting the mailbox (Gmail API: `docs/research/issue-427.md`; Microsoft Graph: `issue-428.md`; IMAP with an app or account password for iCloud, Yahoo, Orange, Free, SFR, La Poste: `issue-429.md`, `issue-430.md`) with the Candidate forwarding them to a Forwarding address (`issue-431.md`).

At launch the Forwarding address is the only way, for every provider and every Plan: emails arrive through Brevo Inbound Parsing on `alertes.jobbbox.ai` (Mailgun's EU region if Brevo does not fit). Step-by-step guides cover filtered automatic forwarding for Gmail, Outlook.com, iCloud and Orange; Free and SFR get theirs once tested on real accounts; every other mailbox, Yahoo and AOL without Mail Plus included, forwards by hand. Then come, in this order: connecting Outlook, Hotmail and Live through Microsoft Graph (publisher verification started now), IMAP as a beta for providers without automatic forwarding, and Gmail OAuth, re-assessed once the number of Gmail Candidates is known.

The reason is that every way into the mailbox gives Jobbbox far more than offers: Gmail's and Graph's reading scopes and an IMAP password open the whole mailbox, Gmail's needs a yearly CASA assessment (about EUR 1,000–5,000 and 1–3 months the first time), and Yahoo's terms forbid automated access. Forwarding gives Jobbbox only what the Candidate chose to send, works with every provider, and stores no secret of theirs.

## Considered Options

- **Gmail OAuth first, as most Candidates use Gmail**: the CASA cost and delay would gate launch, for access to the whole mailbox.
- **Microsoft Graph at launch**: free, but publisher verification has an unpublished delay; it follows the Forwarding address instead of waiting for it.
- **IMAP with an app password for everyone**: works almost everywhere, but Jobbbox would keep a password that reads, deletes and sends from the whole mailbox; kept as a later beta, its terms decided with consent and GDPR (#436).
- **Gmail filters with forwarding only, no other provider**: leaves out Outlook, iCloud and the French ISPs most Candidates also use.

## Consequences

- No Linked mailbox at launch holds a token or a password; unlinking is replacing or abandoning the Forwarding address.
- Anyone can send to a Forwarding address: it is long and random, replaceable by the Candidate, capped per day, and its emails go through the email Guardrail (#438).
- Each email provider's setup (the inbound domain and its MX records, Brevo's inbound webhook, later Microsoft's app registration and publisher verification, Google's verification and CASA, Yahoo's OAuth application) is explained in detail by the Back Office Assistant from the Email intake sheet of Paramètres, provider by provider.

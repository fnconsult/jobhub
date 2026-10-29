# The privacy policy tells the AI routes; a generated Recipient list names the providers

_Decided in the grilling of #503 (map #494), on the research of #497 and #498. Builds on ADR-0007 (amended 2026-10-28) and ADR-0062. Reshapes #338._

« IA dans Jobbbox » is a section of the privacy policy (`/legal/confidentialite#ia`, `/legal/ia` redirects there), versioned with it. It tells the routes in words: Claude outside the EU after Redaction, Mistral in the EU for identity under EU AI Consent and for reading emails, web search outside the EU on queries only, the Guardrails and their limits. It does not name each provider. The names, purposes, data sent, place and transfer safeguard live in the **Recipient list** (`/legal/destinataires`), a page generated from the Tool catalog at request time, showing every Tool switched on in production that receives personal data or queries drawn from it. The privacy policy and the section link to it; it carries the date it last changed. AI Activity shows nothing the Recipient list does not.

## Considered Options

- **Name every provider in the policy text**: every provider added in Paramètres would need a new Legal Text Version, or the policy would silently be wrong.
- **A separate, versioned `/legal/ia` text**: a sixth Legal Text for content that is GDPR information and belongs in the privacy policy.
- **List every Tool declared in the catalog, switched on or not**: names recipients who receive nothing, and drifts from what AI Activity shows.

## Consequences

- A Tool whose residency is `unknown` is shown as outside the EU, as ADR-0007 treats it for lack of proof.
- A new recipient **outside the EU** is a substantial change to the privacy policy: a new version and its email notice come before it is switched on. A new recipient in the EU is minor.
- Paramètres does not block switching on such a Tool (an emergency switch must stay possible): it warns, names the policy version to publish, and writes a Back Office Audit line.
- The Tool catalog gains public fields: a public name, a purpose in plain words (FR and EN), the data sent (redacted, queries only, identity under EU AI Consent), the contracting entity and the transfer safeguard. Provider and model family only, never a model version; text names, no logos.
- `docs/privacy/register.md` stays hand-written (legal bases, retention, DPIAs), with a test that every Tool receiving personal data has an entry.

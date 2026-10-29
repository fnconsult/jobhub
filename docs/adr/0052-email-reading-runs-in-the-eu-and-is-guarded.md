# Reading an offer email runs on an EU provider and has its own Guardrail

_Amends ADR-0022 (Guardrails) and ADR-0026 (Task Playbooks' providers) for Email intake (#426, #438)._

Email intake reads the text of each Received offer email with an AI step, the `offer_email_reading` task, ruled by the Task Playbook « Lire un email d'offres d'emploi ». The AI reads the text and decides the kind of email (an alert, a recruiter's message, or anything else) and its offers; a small module per Recognised sender only takes the offer's id out of its link and strips tracking. The Playbook is imported not validated: until a person validates a version, Email intake does not run in production (« En attente de validation du playbook » on the Sources tab), and runs on the latest version elsewhere (ADR-0026).

- **EU only**: an email may name a recruiter or a contact, which Redaction does not take out (it removes the Candidate's identity and every email address and phone number). So this task runs only on an EU provider (Mistral), whatever the Candidate's EU AI Consent, and the Back Office offers only EU models for its Playbook Agent. Redaction still applies; with EU AI Consent the Candidate's identity goes to Mistral unredacted, as for any task.
- **A Guardrail of its own**: anyone can write to a Forwarding address, so an email is untrusted content that reaches an AI with no Candidate reading it first. On input, the « Contenu piégé dans un email » Guardrail (fixed rules: unauthenticated sender, size, hidden text, known injection patterns; then a model check for indirect prompt injection) blocks or flags; super-admins tune it or switch it off like the others. On output, fixed rules always on: no email, phone or person's name from the email, every link present in the email as is, at most 30 offers; otherwise the reply is set aside. A blocked email gives no Job Offer and is listed as set aside by a Guardrail for the Candidate and in Activité; its Guardrail Trigger names no one. Its Eval Cases are fictional, modelled on a real corpus kept outside the repo.
- **The Guardrail's model check runs in the EU too**: it reads the same email, recruiters' and contacts' names included, so it has its own AI task, `email_guardrail`, EU only like `offer_email_reading` and routed like it by default, not the `guardrail` task routed like `coaching` (ADR-0022), which may be outside the EU.
- **Cost**: one call per email, one more for the Guardrail's model check, in AI Usage under `offer_email_reading` and `email_guardrail`; three tries within 72 hours, then the email is marked failed.

## Considered Options

- **Templates per sender instead of AI**: no AI cost and no third party sent anywhere, but each redesign of an alert breaks its template silently, and recruiters' messages have none.
- **The task's configured provider, as for other tasks**: would send recruiters' names outside the EU when the configured provider is.
- **Only the fixed rules every task has, no Guardrail (ADR-0022 as it was)**: the email is written by an outsider, not the Candidate, and nobody reads it before the AI does; a tunable, evaluated Guardrail is the place for a threat that will change.
- **Run Email intake in production on the built-in text until validation**: against ADR-0026's rule for new tasks; a person accountable reviews it first.

## Consequences

- Each Job Offer from an email then follows the usual path: deduplication before the Candidate sees it, Job Offer Summary and sector (a private one's from its excerpt only), Match Score by rules, expiry re-checks when an Application follows it.
- Changing the email Guardrail's settings plays its Eval Cases, like every Guardrail (ADR-0023).

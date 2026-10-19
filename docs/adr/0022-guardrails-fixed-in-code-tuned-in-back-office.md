# Guardrails are fixed in code and tuned in the Back Office; checks fail open, triggers name no one

The AI Coach, its Playbook Agents and the Back Office Assistant are the AI calls that take free text: what the Candidate types, and content the Candidate did not write (a captured Job Offer, a Company Dossier from the web, an imported CV) that reaches them as the item In view. They are guarded by Guardrails against prompt injection, personal data leaks, disclosure of prompts, playbook rules or secrets, out-of-scope or harmful advice, and distress. Other AI tasks (Tailored CV, Outreach Message, Match Score...) take no free conversation and keep their own rules (ADR-0006, ADR-0015).

The set of Guardrails is fixed in code. Super-admins only tune each one in the Back Office: block or flag only, threshold, and its Guardrail message. The distress, personal data leak and secret disclosure Guardrails cannot be switched off. Checks come in three layers: untrusted content is always marked as data in the prompt (not a setting); fixed rules (third-party emails and phones, copied prompt or playbook text, key shapes, distress words); and one EU-resident AI check on input (injection, distress) and one on output (out-of-scope advice, leaks), on their own `guardrail` AI task routed like `coaching`. Only the final reply is checked on output, not each Playbook Agent's; a Playbook Agent's reply reaches the AI Coach as data.

## Considered Options

- **Guardrails written freely by editors, in natural language judged by a model**: rejected because each would be an untested prompt guarding the others; a new threat comes with a release and its tests.
- **A model chosen per Guardrail in the Back Office**: rejected because changing the judge without re-running the evals would weaken a Guardrail silently.
- **Fail closed when the AI check is unavailable**: rejected because a provider outage would stop the AI Coach for everyone. We fail open and record it; the fixed rules still apply, and distress words always bring the 3114 message without the model.
- **Check every Playbook Agent's reply**: rejected for cost (up to two more calls per consultation against the Coach cost target); its reply never reaches the Candidate unread by the AI Coach, and the final reply is checked.
- **Guardrail Triggers tied to the Candidate's Coach Conversation**: rejected because they would then be personal data, deleted with the conversation and in the Data export, so no trend could be kept. They name no one, are kept 24 months like AI Usage, and the text stays in the 30-day AI Message Log.
- **Alerting a person when a Candidate expresses distress**: rejected because it would mean monitoring health data (GDPR art. 9) that Jobbbox has no basis nor staff to act on. The Candidate gets the 3114 helpline message, and no one is alerted.

## Consequences

- A reply may cost two more AI calls; they count in the Coach Message Cost.
- A blocked reply is written again once, told what was wrong, before being replaced by the Guardrail message (a leak or a secret is replaced at once). Both the blocked message and the answer stay in the Coach Conversation, marked as blocked without naming the Guardrail.
- Guardrail messages are in French and English, each Human-validated by someone other than its author before production serves it; a default text in code applies until then, so production always has a distress message.
- Strengthening Guardrails (and Playbooks) through evals is left to its own design session.

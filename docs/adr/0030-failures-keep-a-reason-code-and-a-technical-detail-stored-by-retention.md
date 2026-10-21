# Failures keep a reason code and a technical detail, each stored where its retention allows; refused Back Office attempts are audited

Most failures and warnings only reached the server console. The Back Office Audit recorded successful changes only: a failed connection test, a refused Playbook validation, a Guardrail setting refused by its Eval Run or a Stripe refusal left no trace. AI Usage and the AI Message Log kept `ok = false` and dropped the provider's error; a call stopped before it was sent (`AiConfigError`, `DataResidencyError`) was recorded nowhere; the degraded paths (Task Playbook fallback, a Playbook Agent left out, job title variants or Company News unavailable, Redaction by shape alone) were `console.warn` only. A super-admin could see that something failed, never why.

We decided that every failure or warning keeps a **Failure Reason** in two parts, and an **Outcome** (ok, warning, failed):

- **Functional:** a stable code from one catalog fixed in the code, with its French wording for an Administrator. Unknown errors are `other`. Codes can be filtered and counted, and carry no personal data.
- **Technical:** the error's class, provider, HTTP status and message, scrubbed of keys and secrets, passed through Redaction and cut at 500 characters, since a provider may echo part of the prompt.

Each part is stored where its retention and readers already fit:

| Where | What | Kept | Read by |
|---|---|---|---|
| AI Usage | Outcome and code | 24 months | super-admins, Support (counts per reason on Consommation IA and Outils) |
| Guardrail Trigger (« unavailable ») | code only | 24 months | super-admins, Support |
| AI Message Log | Outcome, code and technical reason | 30 days | super-admins (Journaux IA) |
| Back Office Audit | Outcome, code, wording and technical reason | 3 years | super-admins (Journal) |

A call stopped before it was sent is recorded as failed and « non envoyé », with its redacted text and no cost. The Candidate's Data export holds the code and wording of their failed calls, never the technical reason.

The Back Office Audit now also records failed or refused attempts that change nothing: connection and sign-in tests, business refusals (validation, Eval Run, last super-admin, Stripe) and an Administrator opening a section outside their Back Office Roles. It never records form input errors (empty, too long), the values a refused save carried, or visitors without a Back Office Role.

## Considered Options

- **Free text only:** readable, but neither filterable nor countable, and too easily a carrier of personal data kept for years.
- **Everything in AI Usage:** it is kept 24 months and read by Support; a provider message may echo the prompt, which belongs with the 30-day, super-admin-only text.
- **Audit refused attempts with their values:** a refused save may carry a secret or personal data; what was tried and the field at fault are enough.
- **Log every 403 and 404 under /admin:** that is a security log, not the Back Office Audit; without an Administrator there is no one to attribute it to.

## Out of scope

Failures outside AI calls and Administrator actions (Job Digest and Follow-up emails, Stripe webhooks and checkout, Job discovery runs) stay on the console for now; they need their own design. AI provider calls have no timeout today.

# Privacy register

Jobbbox's record of processing activities (GDPR art. 30). One entry per processing; each names its purpose, legal basis, people and data concerned, who can read it, where it is stored and how long it is kept. Add an entry with the change that starts a new processing.

Controller: Jobbbox. Hosting: the EU, per ADR-0007 and `docs/ops/hosting.md`; no transfer outside the EU.

## Back Office Audit (#203)

| | |
| --- | --- |
| Purpose | Keep a record of every change made in the Back Office (Plan Quotas, Human Coaches, and later Back Office Roles and Provider Secrets): who made it, what it was before and after, when. It lets the Jobbbox team find out who changed a setting, correct mistakes and answer for changes that affect Candidates and Human Coaches. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): accountability and security of Jobbbox's own administration. The record holds no more than the change itself. |
| People concerned | Administrators (Jobbbox team members who made the change). Human Coaches, when the change is about them. |
| Data | The Administrator's Candidate id and the email address they had when making the change; the date and time; the Back Office section, the item changed (a Plan, a Human Coach's email) and the action; the values before and after. For a Human Coach: name, email, Cal.com booking link and bio. Secret values (Provider Secrets) are never recorded, only that they were replaced (possibly despite a failed connection test) or cleared. |
| Source | Written by the web app, in the same database transaction as the change, from the signed-in Administrator. |
| Who can read it | Administrators, on the Back Office Journal page (`/admin/journal`): those listed in `ADMIN_EMAILS` until Back Office Roles land, then super-admins only. Anyone else gets a 404. |
| Storage | The `back_office_audit` table in the app's Postgres database (EU). |
| Retention | 3 years from the change. The worker's nightly job `back-office-audit.purge` deletes older entries. When an Administrator's account is deleted, their entries stay until then, their Candidate id set to null and the email they had kept, so the record still says who made each change. |
| Rights | Not part of a Candidate's account data export (it is Jobbbox's operations record, see `OPERATIONS_RECORD_TABLES` in `apps/web/src/candidate-data`). An Administrator or Human Coach who asks for access to, or erasure of, what it holds about them is answered by the Jobbbox team directly; a request to erase is weighed against the legitimate interest above (GDPR art. 17(1)(c) and 21) within the 3 years. |
| Security | Back Office pages and writes check the Administrator on every request. Entries cannot be edited from the app; they are only added, read and purged. |

## Provider Secrets (#208)

| | |
| --- | --- |
| Purpose | Let super-admins replace the third-party keys the app uses (AI providers, France Travail, contact enrichment, Stripe, Brevo) without a deployment, and show who last changed each one. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): security and accountability of Jobbbox's own administration. |
| People concerned | Administrators (super-admins) who replaced a key. |
| Data | Per key: the value, encrypted (AES-256-GCM, ADR-0020); the email address of the super-admin who last replaced it, and when. No Candidate id. |
| Source | Entered by a super-admin in the Back Office's Clés section (`/admin/cles`). |
| Who can read it | Super-admins see each key's source, last 4 characters and who changed it when; nobody can read a value back from the app. Anyone else gets a 404. |
| Storage | The `provider_secret` table in the app's Postgres database (EU); the master keys stay outside it, in the hosting's secret manager (`docs/ops/provider-secrets.md`). |
| Retention | While the key is in use; clearing it deletes the row. Each change stays in the Back Office Audit (above), without the value. |
| Rights | Not part of a Candidate's data export (the table names no Candidate). An Administrator who asks about it is answered by the Jobbbox team directly. |
| Security | Encrypted in the app, never with database functions, so no value reaches SQL logs; provider error messages are scrubbed of keys before they are logged or stored. |

## Back Office Assistant (#205)

| | |
| --- | --- |
| Purpose | Let an Administrator ask questions about Back Office data and settings (Plan Quotas, Human Coaches, the AI Coach's cost, Administrators, the Journal) in the Back Office, and keep their conversations so they can reopen them. Read-only: it changes nothing. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): helping the Jobbbox team run its own administration. |
| People concerned | Administrators (who ask). Human Coaches, by their public name and bio, when the asking Administrator's roles cover Human Coaches. |
| Data | What the Administrator types and the assistant's replies, with dates; the AI provider, model and estimated cost of each reply (internal). What the AI is told is limited to what the Administrator's Back Office Roles may read, and minimised: no email address (Administrators are counted per role, Journal targets are masked, any address left is masked), no Human Coach booking link, and never a Provider Secret or SSO client secret value. |
| Source | The Administrator, in the Back Office Assistant panel; the Back Office's own data. |
| Processors | The AI provider of the `coaching` task, EU endpoints only (ADR-0007); with the Administrator's EU AI consent, what they type that carries identity goes to Mistral (#121). |
| Who can read it | The Administrator who had the conversation, in the panel. Not other Administrators, not Candidates; Back Office routes answer 404 to anyone without a Back Office Role. |
| Storage | The `back_office_assistant_conversation` and `back_office_assistant_message` tables in the app's Postgres database (EU), apart from Candidates' Coach Conversations. |
| Retention | 12 months after the conversation's last message (the worker's nightly job `back-office-assistant.purge`); deleted at once with the Administrator's account, or when they delete the conversation. |
| Rights | In the Administrator's account data export (`backOfficeAssistantConversations`, without AI costs). |
| Security | The API checks the Administrator's Back Office Roles on every request; conversations are scoped to their own account. |

## AI Usage (#218)

| | |
| --- | --- |
| Purpose | Follow what AI costs Jobbbox: every AI call (all tasks), the tools its model used and the calls to external APIs (France Travail, contact enrichment), in the Back Office's AI consumption report. |
| Legal basis | Not a processing of personal data: no person is named or identifiable. Recorded here to say so. |
| People concerned | None. |
| Data | Per AI call: when, task, provider, endpoint, model, tokens (input, output, cached input), estimated cost, duration, success or failure; per tool used: its name, how many uses, success, cost when billed. Per external API call: provider, operation (HTTP method and path, no query string), HTTP status, duration, cost when known. No Candidate id, no prompt or reply text, no payload, no key (operations are scrubbed of anything shaped like one). |
| Source | Written by the AI layer (web app and worker) and by the France Travail and contact enrichment clients, without waiting: a failed insert never fails the call. |
| Who can read it | Super-admins and Support, on the Back Office's Consommation IA page (`/admin/consommation-ia`), as totals and breakdowns; the Back Office Assistant gets the same aggregates for those roles. Anyone else gets a 404. |
| Storage | The `ai_usage`, `ai_tool_usage` and `external_api_usage` tables in the app's Postgres database (EU). |
| Retention | 24 months. The worker's nightly job `ai-usage.purge` deletes older rows. |
| Rights | Not part of a Candidate's data export, and kept when an account is deleted: the tables name no one (`apps/web/src/candidate-data/deletion-reach.test.ts` checks it). |
| Security | Read-only pages, checked on every request. |

## AI Message Log (#218)

| | |
| --- | --- |
| Purpose | Quality and debugging of the AI features: lets the Jobbbox team see what an AI call was asked and answered when a reply goes wrong. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): keeping the AI features correct and safe for Candidates. Short retention and super-admin-only, audited access limit the impact. |
| People concerned | Candidates (and Administrators using the Back Office Assistant on their own account), whose AI calls these are; people named in what they wrote. |
| Data | Per AI call: the system text, the messages and the reply (null when the call failed), as the AI layer sent and received them, with keys and secrets scrubbed before storing (every key in use, and anything shaped like a credential); the Candidate's id (none for a Guest); the call's AI Usage row (task, model, tokens, cost). It can hold anything the call carried: CV content, Profile, Applications, Coach Conversations. |
| Source | Written by the AI layer (web app and worker) with each call, without waiting: a failed insert never fails the call. |
| Who can read it | Super-admins only (the `aiMessages` resource; not Support, not the Back Office Assistant), on the Back Office's Journaux IA page (`/admin/journaux-ia`): the list shows who, when, task and model, never the text; opening a log shows its text and writes who opened which log, when, to the Back Office Audit. Anyone else gets a 404. |
| Storage | The `ai_message_log` table in the app's Postgres database (EU). |
| Retention | 30 days. The worker's nightly job `ai-usage.purge` deletes older logs. Deleted with the Candidate's account (`ON DELETE CASCADE`). |
| Rights | In the Candidate's data export (`aiMessageLog`, without costs); erased with the account, or on request by the Jobbbox team. |
| Security | Secrets are scrubbed before storing; every read is audited; the pages check the super-admin role on every request. |

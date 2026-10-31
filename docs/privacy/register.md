# Privacy register

Jobbbox's record of processing activities (GDPR art. 30). One entry per processing; each names its purpose, legal basis, people and data concerned, who can read it, where it is stored and how long it is kept. Add an entry with the change that starts a new processing.

Controller: Jobbbox. Hosting: the EU, per ADR-0007 and `docs/ops/hosting.md`; no transfer outside the EU.

## Back Office Audit (#203)

| | |
| --- | --- |
| Purpose | Keep a record of every change made in the Back Office (Plan Quotas, Human Coaches, and later Back Office Roles and Provider Secrets): who made it, what it was before and after, when. It lets the Jobbbox team find out who changed a setting, correct mistakes and answer for changes that affect Candidates and Human Coaches. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): accountability and security of Jobbbox's own administration. The record holds no more than the change itself. |
| People concerned | Administrators (Jobbbox team members who made the change). Human Coaches, when the change is about them. |
| Data | The Administrator's Candidate id and the email address they had when making the change; the date and time; the Back Office section, the item changed (a Plan, a Human Coach's email) and the action; the values before and after. For a Human Coach: name, email, Cal.com booking link and bio. For a recipient outside the EU switched on in Paramètres that the privacy policy in effect does not name (#548): the Tool, its residency, the policy version in effect and « non couvert ». Secret values (Provider Secrets) are never recorded, only that they were replaced (possibly despite a failed connection test) or cleared. |
| Source | Written by the web app, in the same database transaction as the change, from the signed-in Administrator. |
| Who can read it | Super-admins and Technique, on the Back Office's Activité › Actions des administrateurs tab (`/admin/activite/actions`, formerly the Journal at `/admin/journal`, which redirects there, #404). Anyone else gets a 404. |
| Storage | The `back_office_audit` table in the app's Postgres database (EU). |
| Retention | 3 years from the change. The worker's nightly job `back-office-audit.purge` deletes older entries. When an Administrator's account is deleted, their entries stay until then, their Candidate id set to null and the email they had kept, so the record still says who made each change. |
| Rights | Not part of a Candidate's account data export (it is Jobbbox's operations record, see `OPERATIONS_RECORD_TABLES` in `apps/web/src/candidate-data`). An Administrator or Human Coach who asks for access to, or erasure of, what it holds about them is answered by the Jobbbox team directly; a request to erase is weighed against the legitimate interest above (GDPR art. 17(1)(c) and 21) within the 3 years. |
| Security | Back Office pages and writes check the Administrator on every request. Entries cannot be edited from the app; they are only added, read and purged. |

## Provider Secrets (#208)

| | |
| --- | --- |
| Purpose | Let super-admins replace the third-party keys the app uses (AI providers, France Travail, Fantastic.jobs, contact enrichment, Stripe, Brevo) without a deployment, and show who last changed each one. |
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
| Purpose | Follow what AI costs Jobbbox: every AI call (all tasks), the tools its model used and every call to an external tool (France Travail, Fantastic.jobs, the French company register, the job boards and other sites' pages, contact enrichment, Stripe, Brevo, the sign-in providers, the Provider Secrets' connection tests, #234), in the Back Office's AI consumption report, Outils pages and Journal. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): knowing and controlling what the service costs to run. The rows name no one; for the 30 days its AI Message Log is kept, a call's row can be joined to the Candidate it was made for, and is personal data then; after that it is not. |
| People concerned | Candidates, Administrators (Back Office Assistant) and Guests whose AI calls these are, indirectly and for 30 days through the AI Message Log; after that, none. |
| Data | Per AI call: when, task, provider, endpoint, model, tokens (input, output, cached input), estimated cost, duration, success or failure; per tool used: its name, how many uses, success, cost when billed. Per external API call: provider, operation (an API's HTTP method and path, no query string; an SDK's method, such as Stripe's `checkout.sessions.create`; `send` for an email; `token`, `keys`, `userinfo` or `discovery` for a sign-in; `connection_test`; `page_read` and the site's registrable domain alone for a page read on another site, never its URL), HTTP status, duration, cost when known. No Candidate id, no email address, no prompt or reply text, no payload, no key (operations are scrubbed of anything shaped like an email address, a UUID or a credential). |
| Source | Written by the AI layer (web app and worker) and by every client of an external tool (France Travail, the French register, job boards and other sites, contact enrichment, Stripe, Brevo, the sign-in providers, the connection tests), without waiting: a failed insert never fails nor delays the call. |
| Who can read it | Super-admins and Support, on the Back Office's Consommation IA page (`/admin/consommation-ia`), as totals and breakdowns, on each Tool's Outils page (`/admin/outils/<id>`) and in Activité › Actions des administrateurs with its Outils filter (`/admin/activite/actions?section=tools`, for those who may also read it), call by call; the Back Office Assistant gets the same aggregates for those roles. Anyone else gets a 404. |
| Storage | The `ai_usage`, `ai_tool_usage` and `external_api_usage` tables in the app's Postgres database (EU). |
| Retention | 24 months. The worker's nightly job `ai-usage.purge` deletes older rows. |
| Rights | Not part of a Candidate's data export, and kept when an account is deleted: the tables name no one (`apps/web/src/candidate-data/deletion-reach.test.ts` checks it), and the link through the AI Message Log goes with it (exported, then deleted with the account or after 30 days). |
| Security | Read-only pages, checked on every request. |

## AI Message Log (#218)

| | |
| --- | --- |
| Purpose | Quality and debugging of the AI features: lets the Jobbbox team see what an AI call was asked and answered when a reply goes wrong. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): keeping the AI features correct and safe for Candidates. Short retention and super-admin-only, audited access limit the impact. |
| People concerned | Candidates (and Administrators using the Back Office Assistant on their own account), whose AI calls these are; Guests (the browser extension without an account), whose calls are kept without an id; people named in what they wrote. |
| Data | Per AI call: the system text, the messages and the reply (null when the call failed), as the AI layer sent and received them, with keys and secrets scrubbed before storing (every key in use, and anything shaped like a credential) and each text capped at 200,000 characters; the Candidate's id (none for a Guest; a call whose Candidate no longer exists keeps no log); the call's AI Usage row (task, model, tokens, cost). It can hold anything the call carried: CV content, Profile, Applications, Coach Conversations. |
| Source | Written by the AI layer (web app and worker) with each call, without waiting: a failed insert never fails the call. |
| Who can read it | Super-admins only (the `aiMessages` resource; not Support, not the Back Office Assistant), on the Back Office's Activité › Appels IA tab (`/admin/activite/appels-ia`, formerly Journaux IA at `/admin/journaux-ia`, which redirects there, #404): the list shows who, when, task and model, never the text; opening a log shows its text and writes who opened which log, when, to the Back Office Audit. Anyone else gets a 404. |
| Storage | The `ai_message_log` table in the app's Postgres database (EU). |
| Retention | 30 days. The worker's nightly job `ai-usage.purge` deletes older logs. Deleted with the Candidate's account (`ON DELETE CASCADE`). |
| Rights | In the Candidate's data export (`aiMessageLog`, without costs); erased with the account, or on request by the Jobbbox team. |
| Security | Secrets are scrubbed before storing; every read is audited; the pages check the super-admin role on every request. |

## Signalements (#374)

| | |
| --- | --- |
| Purpose | Support and improving Jobbbox: let a signed-in Candidate tell the Jobbbox team about a Bug, suggest an Idée, or ask a Question after help or the AI Coach did not satisfy them, and follow what the team does with it. |
| Legal basis | Contract (GDPR art. 6(1)(b)) for Questions: answering the Candidate about the service they use. Legitimate interest (GDPR art. 6(1)(f)) for Bugs and Idées: keeping Jobbbox working and improving it. |
| People concerned | Candidates who send a Signalement; people they name in what they write. |
| Data | The Candidate's id; the type (Bug, Idée, Question); the message (10 to 2,000 characters), kept as written, without redaction; for a Question, a copy of the Candidate's question and the AI Coach's reply (not a link to the Coach Conversation); the context attached automatically: the page's path without its query string or `#…`, the Jobbbox version, the browser parsed to name, major version and operating system (« Chrome 141, Mac », never the raw user agent), the Interface Language and the Text Size; the status (nouveau, vu, traité) and when it last changed; the team's reply (at most 2,000 characters) and when it was last saved; when it was sent. Which Administrator changed the status or replied is not kept with it (the Back Office Audit records that, by the Signalement's id, without its text). |
| Source | The Candidate, from the Signalement dialog (`POST /api/signalements`); the context from the page and the request. At most 10 per Candidate in a rolling 24 hours. |
| Processors | None: Signalements are read by people only and never sent to an AI. If an agent triage comes later, redaction applies on the way to the AI (ADR-0007). |
| Who can read it | The Candidate who sent it; Administrators whose Back Office Role allows it (#376): Support and super-admins, and Help editors for Questions only. |
| Storage | The `signalement` table in the app's Postgres database (EU). |
| Retention | 12 months after it is marked « traité » (the worker's nightly job `signalements.purge`); one not yet handled is kept until it is. Deleted at once with the Candidate's account (`ON DELETE CASCADE`). |
| Rights | In the Candidate's data export (`signalements`: every field, without the Administrator's identity); erased with the account. |
| Security | Sending checks the signed-in Candidate and the request's origin; the type, message and limits are checked on the server. |

## Job discovery runs (#404)

| | |
| --- | --- |
| Purpose | Let the Jobbbox team see how each run of Job discovery went (a Job Search's, or a Job Digest's top-up): which searches it made, with which Search provider and fallback, what each gave, the pages read and skipped, why it stopped, how long it took and what it cost, to tune the sources, the providers and the Job discovery budget. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): quality, cost and security of the service the Candidate asked for. |
| People concerned | Candidates whose Job Search or Job Digest ran Job discovery. |
| Data | Kept 30 days, tied to the Candidate: their Candidate id, the Profile's id (shown only as a 4-character pseudonym), the Search Criteria searched with, the query texts each web search sent (built from the Search Criteria alone, after Redaction, ADR-0007) and the link to the Job Search. Kept 24 months, of no one: when, what started it, its duration and stop reason, its Discovery metrics (funnel, pages skipped by Skip reason, estimated cost, France Travail's and Fantastic.jobs' parts, the fallback switch) and per search its kind, site, page, provider, results, new Job Offers and cost. |
| Source | Written by the worker when each run ends (`discovery_run`, `discovery_run_detail`). |
| Who can read it | Super-admins, Technique and Support, on the Back Office's Activité › Recherches tab (`/admin/activite/recherches`), with no Candidate name or email. Only super-admins open the run's AI calls (Activité › Appels IA) and the Job Search behind it; each opening of a Job Search is written to the Back Office Audit. Anyone else gets a 404. |
| Storage | The `discovery_run` (figures) and `discovery_run_detail` (what ties a run to its Candidate) tables in the app's Postgres database (EU). |
| Retention | `discovery_run_detail`: 30 days from the run, or until the Candidate's account or Profile is deleted, whichever comes first. `discovery_run`: 24 months from the run. The worker's nightly job `discovery-runs.purge` deletes both when due. |
| Rights | The last 30 days' runs are in the Candidate's Data export (`profiles[].jobDiscoveryRuns`: when, trigger, Search Criteria and each search's query texts) and are deleted with their account. The figures kept afterwards name no one. |
| Security | Back Office pages check the Administrator's Back Office Roles on every request. Runs cannot be edited from the app; they are only added, read and purged. |


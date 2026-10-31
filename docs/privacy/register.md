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


## Coach Conversations (#124, #600)

| | |
| --- | --- |
| Purpose | Let a Candidate talk with the AI Coach about their job search and find each conversation again: each Coach Conversation is attached to the object or the menu it is about (its Subject: an Application, a Profile, a Job Search, a Job Digest, or one of the Sidebar menus Mes candidatures, Recherches d'offres, Job Digests, Agenda, Mes coachs humains), or to the active Profile for a Free conversation (ADR-0070). |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)): the AI Coach is part of the service the Candidate signed up for. |
| People concerned | Candidates. Third parties only as far as the Candidate names them in what they write, or a Job Offer read from a link names its employer. |
| Data | What the Candidate writes and the AI Coach's replies, with dates; the conversation's title and Subject (kind and id of the object or menu); each reply's Focus (the object or Agenda it was about), its Provenance, and its Job Offer card's Job Offer; Blocked messages, marked as such; the AI provider, model, tokens and estimated cost of each reply and of each Playbook Agent consulted (internal). |
| Source | The Candidate, in the conversation; the AI Coach's replies, written from the Coach context (their own Profiles, Applications, Job Searches, Job Digests, Agenda and Coach Memory). |
| Processors | The AI provider of the `coaching` task, EU endpoints only (ADR-0007); with the Candidate's EU AI consent, what carries identity goes to Mistral (#121). |
| Who can read it | The Candidate, in their conversations. Never Human Coaches (Coach Access covers Profiles and Applications only). Administrators see only each day's cost figures, never a conversation; the text of a call, if needed, is in the AI Message Log. |
| Storage | The `coach_conversation` and `coach_message` tables in the app's Postgres database (EU). |
| Retention | 12 months after the conversation's last message (the worker's nightly job `coach-conversations.purge`); deleted at once with the Candidate's account, when they delete it, or with its object if the object itself is deleted. An archived object keeps its conversation. The conversations saved before Subjects existed (only on staging) were deleted when #600 shipped; the Coach Memory was kept. |
| Rights | In the Candidate's Data export (`coachConversations`: each with its Subject's kind, id and name, every message, each reply's Provenance and Focus; without AI costs). |
| Security | Every read and change is scoped to the Candidate: another Candidate's conversation, or a Subject that is not theirs, is « not found ». |

## Préavis des Legal Text Versions (#547)

| | |
| --- | --- |
| Purpose | Tell each Candidate, at least 30 days ahead, of a substantial version of the CGU, the CGV or the privacy policy (ADR-0062): an email naming the text, its effective date, its line in the version history, what happens then, and links to the new version and the version history. Then show once in the app, from its effective date, that the privacy policy changed, and remember that the Candidate closed it. |
| Legal basis | Legal obligation (GDPR art. 6(1)(c)) to inform the Candidate of a change to the contract and to the information on processing, as the issue decided: Code de la consommation L215-1-1 and GDPR art. 12-13. These references are not verified against their primary sources yet (`docs/research/issue-547.md`): the Legal Review of the first noticed version confirms or corrects them. A service email: it goes without any marketing opt-in. |
| People concerned | Candidates with a verified email address. |
| Data | Per notice sent: the Candidate's id, the text and version (its effective date) it told of, when it was sent. Per privacy policy change closed: the Candidate's id, the version, when it was closed. The email itself goes to the Candidate's account address, in their Interface Language; its text is not kept. |
| Source | Written by the worker when it sends each notice (`legal-text-notices.send`: when it starts, then daily, Production only, never the Beta), and by the web app when the Candidate clicks « J'ai compris » (`DELETE /api/privacy-change/<version>`). |
| Processors | Brevo (EU, ADR-0007), which sends the email. The email carries no image and no tracked link: Brevo's open and click tracking must be off on the account for transactional emails, to be checked by the product owner (`docs/research/issue-547.md`, item 3). |
| Who can read it | The Candidate, through their Data export. No Back Office screen shows it. |
| Storage | The `legal_text_notice` and `privacy_change_seen` tables in the app's Postgres database (EU). |
| Retention | As long as the account: deleted with it (`ON DELETE CASCADE`). |
| Rights | In the Candidate's Data export (`legalTextNotices.emailed` and `legalTextNotices.privacyChangesSeen`); erased with the account. |
| Security | One notice per Candidate and per version, claimed in the transaction that sends it. Closing checks the signed-in Candidate and the request's origin, and only the version shown can be closed. |

## Withdrawals (#511)

| | |
| --- | --- |
| Purpose | Let a Candidate withdraw online from a contract concluded on Jobbbox (a Plan's subscription, a Coaching Session) within its withdrawal period, through « Renoncer au contrat ici » (C. conso. L221-18, L221-21 al. 3), refund them, acknowledge the withdrawal on a durable medium, and let Support follow refunds that fail. |
| Legal basis | Legal obligation (GDPR art. 6(1)(c)): the Code de la consommation's withdrawal right, its acknowledgement (D221-5) and the refund within 14 days (L221-24). The contract itself (art. 6(1)(b)) for cancelling it. |
| People concerned | Candidates who withdraw. Human Coaches, told by email that a Coaching Session is cancelled. A third person, when the Candidate has the acknowledgement sent to another address. |
| Data | Per Withdrawal: the Candidate's id, the contract (Plan or Coaching Session, its name or the Human Coach's, when it was concluded), the name the Candidate typed, the address the acknowledgement went to, when the withdrawal was received and when the acknowledgement was sent. Per refund: amount, currency, status, Stripe's failure reason, how many attempts; Stripe's identifiers of the subscription, payment, Checkout Session and refund. The Coaching Session gets the date it was withdrawn. The Human Coach is sent the Candidate's first name and last initial, the day the session was paid and the date it was planned for. |
| Source | The Candidate, on the Withdrawal form (`/abonnement/retractation`); Stripe, for what was paid and each refund's fate (its signed `refund.updated` and `refund.failed` webhooks). |
| Processors | Stripe (subscription cancelled at once, refund `requested_by_customer`; already a processor for payments); Brevo, which sends the acknowledgement and the Human Coach's notice (already a processor for emails). No new processor, no recipient outside the EU beyond those already listed for them. |
| Who can read it | The Candidate, on the confirmation page and in their acknowledgement. Super-admins and Support, on the Back Office's Rétractations section (`/admin/retractations`), with the Candidate's email; Support tries a failed refund again, recorded in the Back Office Audit. Anyone else gets a 404. |
| Storage | The `withdrawal` and `withdrawal_refund` tables, and `coaching_session.withdrawn_at`, in the app's Postgres database (EU). |
| Retention | Until the account is deleted (ON DELETE CASCADE, ADR-0010). Whether to keep withdrawals longer, as evidence or for accounting, is a question for the Juriste (see the « Légal : » issue). |
| Rights | In the Candidate's Data export (`withdrawals`, with their refunds, without Stripe's identifiers); deleted with their account. |
| Security | The form and its API check the signed-in Candidate and the request's origin; one Withdrawal per contract (a double click records one); each refund is sent to Stripe with an idempotency key, a retry with a new one. |

## Quota Reduction notices (#514)

| | |
| --- | --- |
| Purpose | Tell each Candidate paying for a Plan, in advance and on a durable medium, that what their Plan includes goes down (what, why, from when), and let them end their subscription at no cost with a prorata refund (C. conso. L224-25-26); keep the proof that they were told and how their cancellation was refunded. |
| Legal basis | Legal obligation (GDPR art. 6(1)(c)): L224-25-26 of the French Consumer Code; and the performance of the subscription contract (art. 6(1)(b)). |
| People concerned | Candidates paying for a paid Plan when an Administrator schedules a Quota Reduction on it. |
| Data | The Candidate's id, the Quota Reduction they were told of (Plan, what it lowers, reason, effective date), when the e-mail was claimed and sent; if they cancelled over it: when, the Stripe subscription ended, the refund's Stripe id, amount and currency, or why Stripe did not make it and when Support made it in Stripe instead. The e-mail goes to their account's address, in their Interface Language. The Quota Reduction itself names the Administrator who scheduled it (their id and the email they had then). |
| Source | Written by the web app when an Administrator schedules a Quota Reduction (one row per paying subscriber) and when the Candidate cancels over it; the worker's job `quota-reductions.run` sends the e-mails and records them. |
| Recipients | Brevo (e-mail delivery, existing sub-processor, EU); Stripe (cancellation and refund, existing sub-processor). No new sub-processor, no transfer outside the EU beyond the existing ones. |
| Who can read it | The Candidate, on `/abonnement` and `/abonnement/baisse` while the reduction is open to them. Plans managers and super-admins on Offres: counts (subscribers told, e-mails sent, cancellations), and each refund Stripe did not make by its Stripe subscription id, cancellation date and Stripe's error code, for Support to refund in Stripe; never the Candidate's name or e-mail. |
| Storage | The `plan_quota_reduction` and `plan_quota_reduction_notice` tables in the app's Postgres database (EU). |
| Retention | As long as the Candidate's account: deleted with it (`ON DELETE CASCADE`). A Quota Reduction (no personal data but the Administrator's id and email) is kept with the Plan's history. |
| Rights | In the Candidate's data export (`quotaReductionNotices`, without Stripe identifiers); erased with the account. |
| Security | Scheduling and cancelling a Quota Reduction check the Administrator's Back Office Roles and are written to the Back Office Audit; cancelling over one checks the signed-in Candidate. |

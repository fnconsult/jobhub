# Privacy register

Jobbbox's record of processing activities (GDPR art. 30). One entry per processing; each names its purpose, legal basis, people and data concerned, who can read it, where it is stored and how long it is kept. Add an entry with the change that starts a new processing.

Controller: Jobbbox. Hosting: in the EU, on Hostinger's VPS in Paris (ADR-0007, `docs/ops/hosting.md`). **Some recipients are outside the EU** (fixed by #338, after `docs/research/issue-498.md`): every AI task goes by default to Claude's direct API (Anthropic, outside the EU) after Redaction, which leaves pseudonymised personal data (ADR-0007, amendment of 2026-10-28); web search (Perplexity, Brave, Tavily) receives queries outside the EU; Stripe and the Sign-in Providers are outside the EU; Brevo, Kaspr and Fantastic.jobs have a residency not established, counted as outside. The native app's crash reports go to Sentry, a US company, stored in its EU region (Frankfurt), only its account and project metadata in the US (« Crash reports », #703). What stays in the EU: storage, the identity route under EU AI Consent and the `euOnly` tasks (Mistral, `api.eu.mistral.ai`). Each recipient's contracting entity, place and transfer safeguard are in the Tool catalog (`packages/shared/src/tools.ts`, from `docs/research/issue-522.md`) and on the public Recipient list (`/legal/destinataires`, ADR-0064).

## Recipients and their entries (#338)

Every Tool of the catalog that receives personal data, or queries drawn from it, and every Host, with the entries below it serves. A test (`apps/web/src/tools/privacy-register.test.ts`) fails when one has no line here, when a line names an id the catalog does not have, or an entry that does not exist.

| Recipient | Entries |
| --- | --- |
| `hostinger` | Hosting |
| `anthropic` | Master CV, Profiles and CV reading; Applications and their documents; Coach Conversations; Coach Memory and Guardrails; Back Office Assistant; Job Searches, Job discovery and Job Digests; Enriched Contacts; Guest session in the browser extension |
| `anthropic-bedrock` | Master CV, Profiles and CV reading; Applications and their documents; Coach Conversations; Back Office Assistant |
| `anthropic-vertex` | Master CV, Profiles and CV reading; Applications and their documents; Coach Conversations; Back Office Assistant |
| `openai` | Master CV, Profiles and CV reading; Applications and their documents; Coach Conversations |
| `mistral` | EU AI Consent; Email intake; Coach Conversations; Back Office Assistant |
| `perplexity` | Job Searches, Job discovery and Job Digests; Applications and their documents |
| `brave` | Job Searches, Job discovery and Job Digests; Applications and their documents |
| `tavily` | Job Searches, Job discovery and Job Digests; Applications and their documents |
| `france-travail` | Job Searches, Job discovery and Job Digests |
| `fantastic-jobs` | Job Searches, Job discovery and Job Digests |
| `lusha` | Enriched Contacts |
| `kaspr` | Enriched Contacts |
| `apollo` | Enriched Contacts |
| `stripe` | Subscriptions, Plan Quotas and payments; Human Coaches and Coaching Sessions; Orders (#512); Withdrawals (#511) |
| `brevo-api` | Transactional emails |
| `brevo-smtp` | Transactional emails |
| `email-intake` | Email intake |
| `google` | Candidate accounts and sign-in |
| `apple` | Candidate accounts and sign-in |
| `microsoft` | Candidate accounts and sign-in |
| `oidc` | Candidate accounts and sign-in |

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

## Acceptances of the CGU and CGV (#510)

| | |
| --- | --- |
| Purpose | Keep proof that a Candidate accepted a given version of the CGU (on the Acceptance screen after sign-in, ADR-0062) or of the CGV (at a payment, #512): which version, its permanent URL and fingerprint, when, and how. It lets Jobbbox show which terms applied to a Candidate, including after their account is deleted. |
| Legal basis | Legal obligation (GDPR art. 6(1)(c)) for the CGV of a contract of 120 EUR or more (C. conso. L213-1, D213-1: kept 10 years); legitimate interest (GDPR art. 6(1)(f)) in the proof of the CGU accepted and of the CGV under that threshold. Durations assumed without a lawyer (#510); to confirm in the Legal Review. |
| People concerned | Candidates. |
| Data | Per Acceptance: the Candidate's id (while the account lives); a pseudonym (HMAC-SHA256 of their email address under the app's secret, AUTH_SECRET: not derivable from the email without that secret, never a plain hash); the text (CGU or CGV), the version id (its effective date), its permanent URL and the SHA-256 of its French text; the date and time; the channel (`premiere_connexion`, `nouvelle_acceptation`, `paiement_plan`, `paiement_coaching`); for a payment, the Stripe Checkout session id and whether the Candidate asked for immediate performance. After the Account deletion, the day of the deletion. No IP address, no user agent, no name, no email address. A pseudonymised record is still personal data (GDPR recital 26, art. 4(5)). |
| Source | Written by the web app when the Candidate ticks the box and confirms (`POST /api/account/acceptances`), or at a payment. |
| Who can read it | No page shows it; the Jobbbox team reads it in the database to answer a dispute, finding a former Candidate's rows from the email they give, with the secret. |
| Storage | The `legal_acceptance` table in the app's Postgres database (EU). The key that links the pseudonym to an email (AUTH_SECRET) is kept apart, in the hosting's secret manager. Changing AUTH_SECRET leaves earlier rows unlinkable. |
| Retention | While the account lives. At the Account deletion the Candidate's id is set to null and the day recorded; the worker's nightly job `acceptances.purge` deletes the CGU rows 5 years after the deletion and the CGV rows 10 years after (the deletion ends any paid Plan). |
| Rights | In the Candidate's Data export (`acceptances`: version, URL, fingerprint, channel, date, immediate performance; never the pseudonym nor Stripe's id). It is Jobbbox's operations record (`OPERATIONS_RECORD_TABLES` in `apps/web/src/candidate-data`): an erasure request is weighed against the legal obligation and the proof (GDPR art. 17(3)(b) and (e)). |
| Security | Rows are only added, read for the export and purged; the app never edits them. |

## Guest session in the browser extension (ADR-0003, #550)

| | |
| --- | --- |
| Purpose | Let a Guest (the browser extension without an account) get a Match Score for a Job Offer against their CV: the captured Job Offer, the CV read from their file, the Search Criteria read from it, the last Match Score, and their Acceptance of the CGU for guests, kept for their session only. |
| Legal basis | Performance of the service the Guest asks for (GDPR art. 6(1)(b)), within the CGU for guests they accept. The storage in the browser is strictly necessary to the service asked for (ePrivacy art. 5(3), exemption): no consent asked. |
| People concerned | Guests; people named in a CV. |
| Data | The Job Offer (its id, title, text, source address); the CV's content and the Search Criteria read from it; the last Match Score; when the session ends. Since #550, the Acceptance of the CGU for guests: the version accepted (its effective date) and when it was ticked, before the session's first CV, while a CGU version is in effect. |
| Source | The Guest: the page they capture, the CV file they choose, the box they tick in the Side Panel. |
| Who can read it | No one but the Guest, in their browser. The web app reads the CV file to answer it, keeps neither the file nor what it read (ADR-0003); the Job Offer is stored for everyone, without the Guest's identity, and forgotten within 24 hours. The Acceptance is sent to no one: no request carries it, and Jobbbox holds no proof of it. |
| Processors | Hostinger (the web app that reads the CV, in Paris). The Guest's CV is read by rules only, never sent to an AI (`apps/web/src/cv/index.ts`, ADR-0003). The captured Job Offer's public text goes to Claude's direct API (Anthropic, outside the EU) for `offer_analysis` (added by #338, from `docs/research/issue-498.md` § 4, item 12). |
| Storage | The browser's session storage (`chrome.storage.session`, in memory, gone when the browser closes), key `guestSession`. |
| Retention | 23 hours after the session began at most, or until « Effacer mes données maintenant ». Once the Guest saves their work in an account, only where it went is kept, the Acceptance not carried over: the Candidate accepts the CGU on their own screen (#510). |
| Rights | Erased by the Guest at any time (« Effacer mes données maintenant », or by closing the browser). Jobbbox holds nothing of it to give or erase. |
| Security | Readable only by the extension's own pages. |

## Provider Secrets (#208)

| | |
| --- | --- |
| Purpose | Let super-admins replace the third-party keys the app uses (AI providers, France Travail, Fantastic.jobs, contact enrichment, Stripe, Brevo, GitHub) without a deployment, and show who last changed each one. |
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
| Data | What the Administrator types and the assistant's replies, with dates; the AI provider, model and estimated cost of each reply (internal). With each question, the Administrators' Help Articles the search finds for it (#551): texts written by the Jobbbox team, without personal data. What the AI is told is limited to what the Administrator's Back Office Roles may read, and minimised: no email address (Administrators are counted per role, Journal targets are masked, any address left is masked), no Human Coach booking link, and never a Provider Secret or SSO client secret value. |
| Source | The Administrator, in the Back Office Assistant panel; the Back Office's own data. |
| Processors | The AI provider of the `coaching` task: by default Claude's direct API (Anthropic, outside the EU), after Redaction (ADR-0007, amendment of 2026-10-28; corrected by #338, it said « EU endpoints only »); with the Administrator's EU AI consent, what they type that carries identity goes to Mistral, in the EU (#121). Transfer safeguard: the standard contractual clauses of Anthropic's DPA (`docs/research/issue-522.md`). |
| Who can read it | The Administrator who had the conversation, in the panel. Not other Administrators, not Candidates; Back Office routes answer 404 to anyone without a Back Office Role. |
| Storage | The `back_office_assistant_conversation` and `back_office_assistant_message` tables in the app's Postgres database (EU), apart from Candidates' Coach Conversations. |
| Retention | 12 months after the conversation's last message (the worker's nightly job `back-office-assistant.purge`); deleted at once with the Administrator's account, or when they delete the conversation. |
| Rights | In the Administrator's account data export (`backOfficeAssistantConversations`, without AI costs). |
| Security | The API checks the Administrator's Back Office Roles on every request; conversations are scoped to their own account. |

## Unanswered Questions (#344, #551)

| | |
| --- | --- |
| Purpose | Improve Jobbbox's help: keep the questions about using Jobbbox that no Help Article answered, so Help editors write the missing article or synonym (ADR-0035, ADR-0065). |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): improving the help Jobbbox gives its users. |
| People concerned | Candidates who ask the AI Coach a question the help missed; Administrators who click « Demander un tutoriel » in the Back Office Assistant. Neither is identified in the record. |
| Data | The question and the AI's answer (the AI Coach's, or the Back Office Assistant's), redacted: for a Candidate, their known identity and every email address and phone number; for an Administrator, every email address and phone number by its shape. Its audience (`candidate` or `administrator`), the page's route pattern (`/candidatures/[id]`, `/admin/parametres`), never its address or an id; the Interface Language; how many times it was asked, when first and last; its status. No Candidate id, Administrator id, account or conversation id. |
| Source | A Candidate's question is kept automatically when the AI Coach replied, said it was about using Jobbbox, and no Help Article matched it. An Administrator's is kept only when they click « Demander un tutoriel » under a Back Office Assistant reply that no Administrator article covered (#551), never automatically. |
| Processors | None: kept in Jobbbox's own database. The AI calls that produced the answers are the AI Coach's and the Back Office Assistant's, covered by their own entries. |
| Who can read it | Help editors and super-admins (read, mark « Article écrit » or « Écarter »), Support (read), in « Questions sans réponse », filtered by audience, page and language. Not Candidates. |
| Storage | The `unanswered_question` table in the app's Postgres database (EU), which references no other table. |
| Retention | 12 months after it was last asked; 30 days after it was marked written or dismissed (the worker's daily purge). |
| Rights | Not linked to anyone, so in no Data export and untouched by an account deletion: there is nothing to find a person by. |
| Security | Reading and marking check the Administrator's Back Office Roles; a mark is written to the Back Office Audit by the question's id, never its words. « Demander un tutoriel » is answered 404 to anyone without a Back Office Role and passes on no Administrator id. |

## AI Usage (#218)

| | |
| --- | --- |
| Purpose | Follow what AI costs Jobbbox: every AI call (all tasks), the tools its model used and every call to an external tool (France Travail, Fantastic.jobs, the French company register, the job boards and other sites' pages, contact enrichment, Stripe, Brevo, the sign-in providers, the Provider Secrets' connection tests, #234), in the Back Office's AI consumption report, Outils pages and Journal. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)): knowing and controlling what the service costs to run. The rows name no one; for the 30 days its AI Message Log is kept, a call's row can be joined to the Candidate it was made for, and is personal data then; after that it is not. |
| People concerned | Candidates, Administrators (Back Office Assistant) and Guests whose AI calls these are, indirectly and for 30 days through the AI Message Log; after that, none. |
| Data | Per AI call: when, task, provider, endpoint, model, tokens (input, output, cached input), estimated cost, duration, success or failure; per tool used: its name, how many uses, success, cost when billed. Per Coach Action call (#713, a « Routes locales » Tool): its group as provider, the Coach Action's name as operation, its outcome and, refused, its Failure Reason (`invalid_input`); never the Candidate, its arguments nor its result. Per external API call: provider, operation (an API's HTTP method and path, no query string; an SDK's method, such as Stripe's `checkout.sessions.create`; `send` for an email; `token`, `keys`, `userinfo` or `discovery` for a sign-in; `connection_test`; `page_read` and the site's registrable domain alone for a page read on another site, never its URL), HTTP status, duration, cost when known. No Candidate id, no email address, no prompt or reply text, no payload, no key (operations are scrubbed of anything shaped like an email address, a UUID or a credential). |
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
| Data | Per AI call: the system text, the messages and the reply (null when the call failed), as the AI layer sent and received them, with keys and secrets scrubbed before storing (every key in use, and anything shaped like a credential) and each text capped at 200,000 characters; the Candidate's id (none for a Guest; a call whose Candidate no longer exists keeps no log); the call's AI Usage row (task, model, tokens, cost). It can hold anything the call carried: CV content, Profile, Applications, Coach Conversations; for an AI Coach reply with Coach Actions (#713), each turn's tool calls with their arguments and the results given back to the model. |
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
| Data | What the Candidate writes and the AI Coach's replies, with dates; the conversation's title and Subject (kind and id of the object or menu); each reply's Focus (the object or Agenda it was about), its Provenance, and its Job Offer card's Job Offer; when the Candidate closed the conversations' welcome panel for good (#652); Blocked messages, marked as such; the AI provider, model, tokens and estimated cost of each reply and of each Playbook Agent consulted (internal). |
| Source | The Candidate, in the conversation; the AI Coach's replies, written from the Coach context (their own Profiles, Applications, Job Searches, Job Digests, Agenda and Coach Memory) and, while Coach Actions are switched on (the Platform Setting `COACH_ACTIONS_ENABLED`, off by default; ADR-0077, #713), from the objects of the Candidate it reads during a reply through them: the same categories of data (active Profiles' Master CV and Search Criteria, Applications, the Job Offers of their Job Searches, Job Digests, the Agenda, Tailored Documents as a summary), never an Archived Profile's, nor another Candidate's (`not_found`). A Coach Action never writes: what it proposes waits for the Candidate to apply it. |
| Processors | The AI provider of the `coaching` task: by default Claude's direct API (Anthropic, outside the EU), after Redaction (ADR-0007, amendment of 2026-10-28; corrected by #338); with the Candidate's EU AI consent, what carries identity goes to Mistral, in the EU (#121). Transfer safeguard: the standard contractual clauses of Anthropic's DPA. What a Coach Action reads goes to the same provider, by the same route, the identity removed by Redaction; a result carrying the Master CV's Identity block reroutes the rest of the reply to the identity route under the EU AI Consent (#712). The Coach Actions are Jobbbox's own code (the « Routes locales » Tools, in the EU): no new processor. |
| Who can read it | The Candidate, in their conversations. Never Human Coaches (Coach Access covers Profiles and Applications only). Administrators see only each day's cost figures, never a conversation; the text of a call, if needed, is in the AI Message Log. |
| Storage | The `coach_conversation`, `coach_message` and `coach_welcome_closed` tables in the app's Postgres database (EU). |
| Retention | 12 months after the conversation's last message (the worker's nightly job `coach-conversations.purge`); deleted at once with the Candidate's account, when they delete it, or with its object if the object itself is deleted. An archived object keeps its conversation. The conversations saved before Subjects existed (only on staging) were deleted when #600 shipped; the Coach Memory was kept. |
| Rights | In the Candidate's Data export (`coachConversations`: each with its Subject's kind, id and name, every message, each reply's Provenance and Focus; without AI costs; `coachWelcome.closedAt`, when the welcome panel was closed, or null). The welcome panel's closing is erased with the account. |
| Security | Every read and change is scoped to the Candidate: another Candidate's conversation, or a Subject that is not theirs, is « not found ». |

## Préavis des Legal Text Versions (#547)

| | |
| --- | --- |
| Purpose | Tell each Candidate, at least 30 days ahead, of a substantial version of the CGU, the CGV or the privacy policy (ADR-0062): an email naming the text, its effective date, its line in the version history, what happens then, and links to the new version and the version history. Then show once in the app, from its effective date, that the privacy policy changed, and remember that the Candidate closed it. |
| Legal basis | Legal obligation (GDPR art. 6(1)(c)) to inform the Candidate of a change to the contract and to the information on processing, as the issue decided: Code de la consommation L215-1-1 and GDPR art. 12-13. These references are not verified against their primary sources yet (`docs/research/issue-547.md`): the Legal Review of the first noticed version confirms or corrects them. A service email: it goes without any marketing opt-in. |
| People concerned | Candidates with a verified email address. |
| Data | Per notice sent: the Candidate's id, the text and version (its effective date) it told of, when it was sent. Per privacy policy change closed: the Candidate's id, the version, when it was closed. The email itself goes to the Candidate's account address, in their Interface Language; its text is not kept. |
| Source | Written by the worker when it sends each notice (`legal-text-notices.send`: when it starts, then daily, Production only, never the Beta), and by the web app when the Candidate clicks « J'ai compris » (`DELETE /api/privacy-change/<version>`). |
| Processors | Brevo (see « Transactional emails »), which sends the email. The email carries no image and no tracked link: Brevo's open and click tracking must be off on the account for transactional emails, to be checked by the product owner (`docs/research/issue-547.md`, item 3). |
| Who can read it | The Candidate, through their Data export. No Back Office screen shows it. |
| Storage | The `legal_text_notice` and `privacy_change_seen` tables in the app's Postgres database (EU). |
| Retention | As long as the account: deleted with it (`ON DELETE CASCADE`). |
| Rights | In the Candidate's Data export (`legalTextNotices.emailed` and `legalTextNotices.privacyChangesSeen`); erased with the account. |
| Security | One notice per Candidate and per version, claimed in the transaction that sends it. Closing checks the signed-in Candidate and the request's origin, and only the version shown can be closed. |

## Nouveautés email (#566)

| | |
| --- | --- |
| Purpose | Tell the Candidates who asked for it, by email, about a Release Note marked to be announced (`announce: true`): its title, introduction and « Nouveau » lines, with a link to its page on Nouveautés (ADR-0063). At most one email per Candidate in any 7 days, once per Version, only from Production. |
| Legal basis | Consent (GDPR art. 6(1)(a)): the box « Recevoir un e-mail quand Jobbbox annonce une nouveauté » in Mon compte, Préférences, never ticked by default, for new and existing Candidates alike; ticking it records its date. Withdrawn at any time by unticking it or through the email's unsubscribe link (no sign-in, and the one-click List-Unsubscribe header, RFC 8058). |
| People concerned | Candidates with a verified email address who ticked the box. Visitors cannot subscribe: the public Nouveautés page has no form. |
| Data | Per subscription: the Candidate's id, the date of the consent and the unsubscribe link's token. Per email sent: the Candidate's id, the Version it told of and when it was sent. The email goes to the Candidate's account address, in their Interface Language; its text is not kept. |
| Source | The Candidate, in Mon compte (`PUT /api/account/nouveautes-email`); the worker when it sends each email (`nouveautes-emails.send`: when it starts, then daily, Production only, never the Beta). |
| Processors | Brevo (see « Transactional emails »), which sends the email; already a processor for emails. The email carries no image and no tracked link: every link leads straight to Jobbbox. Brevo has no per-message switch for its open and click tracking: it must be off on the account for transactional emails, to be checked by the product owner (`docs/research/issue-547.md`, item 3). No new processor, no recipient outside the EU. |
| Who can read it | The Candidate, in Mon compte and in their Data export. No Back Office screen shows it. |
| Storage | The `nouveautes_email_subscription` and `nouveautes_email_sent` tables in the app's Postgres database (EU). |
| Retention | The subscription until it is withdrawn (its row is deleted) or the account is deleted. The emails sent as long as the account, so none is sent twice: deleted with it (`ON DELETE CASCADE`). |
| Rights | In the Candidate's Data export (`nouveautesEmail`: the choice, its date and the Versions emailed, never the unsubscribe token); erased with the account. |
| Security | The unsubscribe token is random (256 bits), replaced at each new subscription, and names one subscription only. Ticking or unticking checks the signed-in Candidate and the request's origin. Each email is claimed in the transaction that sends it, the subscription locked, so two workers never send two. |

## Withdrawals (#511)

| | |
| --- | --- |
| Purpose | Let a Candidate withdraw online from a contract concluded on Jobbbox (a Plan's subscription, a Coaching Session) within its withdrawal period, through « Renoncer au contrat ici » (C. conso. L221-18, L221-21 al. 3), refund them, acknowledge the withdrawal on a durable medium, and let Support follow refunds that fail. |
| Legal basis | Legal obligation (GDPR art. 6(1)(c)): the Code de la consommation's withdrawal right, its acknowledgement (D221-5) and the refund within 14 days (L221-24). The contract itself (art. 6(1)(b)) for cancelling it. |
| People concerned | Candidates who withdraw. Human Coaches, told by email that a Coaching Session is cancelled. A third person, when the Candidate has the acknowledgement sent to another address. |
| Data | Per Withdrawal: the Candidate's id, the contract (Plan or Coaching Session, its name or the Human Coach's, when it was concluded), the name the Candidate typed, the address the acknowledgement went to, when the withdrawal was received and when the acknowledgement was sent. Per refund: amount, the part kept for the service already provided (a Plan bought with the Immediate Performance Request, #512), currency, status, Stripe's failure reason, how many attempts; Stripe's identifiers of the subscription, payment, Checkout Session and refund. Whether the contract was bought with the Immediate Performance Request is read from its Order (below). The Coaching Session gets the date it was withdrawn. The Human Coach is sent the Candidate's first name and last initial, the day the session was paid and the date it was planned for. |
| Source | The Candidate, on the Withdrawal form (`/abonnement/retractation`); Stripe, for what was paid and each refund's fate (its signed `refund.updated` and `refund.failed` webhooks). |
| Processors | Stripe (subscription cancelled at once, refund `requested_by_customer`; already a processor for payments); Brevo, which sends the acknowledgement and the Human Coach's notice (already a processor for emails). No new processor, no recipient outside the EU beyond those already listed for them. |
| Who can read it | The Candidate, on the confirmation page and in their acknowledgement. Super-admins and Support, on the Back Office's Rétractations section (`/admin/retractations`), with the Candidate's email; Support tries a failed refund again, recorded in the Back Office Audit. Anyone else gets a 404. |
| Storage | The `withdrawal` and `withdrawal_refund` tables, and `coaching_session.withdrawn_at`, in the app's Postgres database (EU). |
| Retention | Until the account is deleted (ON DELETE CASCADE, ADR-0010). Whether to keep withdrawals longer, as evidence or for accounting, is a question for the Juriste (see the « Légal : » issue). |
| Rights | In the Candidate's Data export (`withdrawals`, with their refunds, without Stripe's identifiers); deleted with their account. |
| Security | The form and its API check the signed-in Candidate and the request's origin; one Withdrawal per contract (a double click records one); each refund is sent to Stripe with an idempotency key, a retry with a new one. |

## Orders (#512)

| | |
| --- | --- |
| Purpose | Conclude a contract online on Jobbbox's own page before Stripe Checkout (C. civ. 1127-1, 1127-2): show the summary, record the Acceptance of the CGV version in effect and the Candidate's Immediate Performance Request (« demande expresse », C. conso. L221-25, L221-28 1°); confirm the contract on a durable medium once Stripe confirms the payment (L221-13); and, at a Withdrawal, tell whether the service already provided is paid for. |
| Legal basis | The contract (GDPR art. 6(1)(b)) for the Order; legal obligation (art. 6(1)(c)) for the confirmation on a durable medium and the Immediate Performance Request the Withdrawal reads. |
| People concerned | Candidates who choose a paid Plan or book a Coaching Session. |
| Data | Per Order: the Candidate's id; what was ordered (a Plan or a Coaching Session, with the Plan's name or the Human Coach's), its price, currency and billing interval as the page showed them; the CGV version accepted and its URL (none while no version is in effect); whether the Immediate Performance Request was made; the Interface Language; when it was ordered and when its confirmation was emailed; Stripe's identifiers of the Checkout Session and of the subscription it started. The CGV Acceptance itself is in the Acceptances (above). The confirmation goes to the account's email address. |
| Source | The Candidate, on the Order pages (`/abonnement/commande`, `/coachs/commande`); Stripe's signed `checkout.session.completed` and `checkout.session.async_payment_succeeded` webhooks, for the payment and the subscription. |
| Processors | Stripe (Checkout, already a processor for payments); Brevo, which sends the Order Confirmation (already a processor for emails). No new processor, no recipient outside the EU beyond those already listed for them. |
| Who can read it | The Candidate, on the Order page and in their confirmation. No Back Office page shows it. |
| Storage | The `checkout_order` table in the app's Postgres database (EU). |
| Retention | Until the account is deleted (ON DELETE CASCADE, ADR-0010). The proof that outlives the account is the CGV Acceptance (above, 10 years after the deletion). |
| Rights | In the Candidate's Data export (`orders`: what was ordered, the CGV version, the Immediate Performance Request, when it was ordered and confirmed; without Stripe's identifiers); deleted with their account. |
| Security | The boxes are checked by the server, never only the browser; the form's API checks the signed-in Candidate and the request's origin. One Order per Checkout Session, and one confirmation each, claimed before it is sent. |

## Quota Reduction notices (#514)

| | |
| --- | --- |
| Purpose | Tell each Candidate paying for a Plan, in advance and on a durable medium, that what their Plan includes goes down (what, why, from when), and let them end their subscription at no cost with a prorata refund (C. conso. L224-25-26); keep the proof that they were told and how their cancellation was refunded. |
| Legal basis | Legal obligation (GDPR art. 6(1)(c)): L224-25-26 of the French Consumer Code; and the performance of the subscription contract (art. 6(1)(b)). |
| People concerned | Candidates paying for a paid Plan when an Administrator schedules a Quota Reduction on it. |
| Data | The Candidate's id, the Quota Reduction they were told of (Plan, what it lowers, reason, effective date), when the e-mail was claimed and sent; if they cancelled over it: when, the Stripe subscription ended, the refund's Stripe id, amount and currency, or why Stripe did not make it and when Support made it in Stripe instead. The e-mail goes to their account's address, in their Interface Language. The Quota Reduction itself names the Administrator who scheduled it (their id and the email they had then). |
| Source | Written by the web app when an Administrator schedules a Quota Reduction (one row per paying subscriber) and when the Candidate cancels over it; the worker's job `quota-reductions.run` sends the e-mails and records them. |
| Recipients | Brevo (e-mail delivery, existing sub-processor, EU); Stripe (cancellation and refund, existing sub-processor). No new sub-processor, no transfer outside the EU beyond the existing ones. |
| Who can read it | The Candidate, on `/abonnement` and `/abonnement/baisse` while the reduction is open to them. Plans managers and super-admins on Offres: counts (subscribers told, e-mails sent, cancellations), and each refund Stripe did not make by its Stripe subscription id, cancellation date, Stripe's error code and the amount to refund, for Support to refund in Stripe; never the Candidate's name or e-mail. |
| Storage | The `plan_quota_reduction` and `plan_quota_reduction_notice` tables in the app's Postgres database (EU). |
| Retention | As long as the Candidate's account: deleted with it (`ON DELETE CASCADE`). A Quota Reduction (no personal data but the Administrator's id and email) is kept with the Plan's history. |
| Rights | In the Candidate's data export (`quotaReductionNotices`: each refund with its status, made, still to make or made by the team, and its amount; without Stripe identifiers or error codes); erased with the account. |
| Security | Scheduling and cancelling a Quota Reduction check the Administrator's Back Office Roles and are written to the Back Office Audit; cancelling over one checks the signed-in Candidate. |

## Two-step verification (#663, #664, ADR-0075)

| | |
| --- | --- |
| Purpose | Protect a Candidate's account beyond their mailbox: once they turn it on, every sign-in by magic link asks for a second step (a passkey, a code from their authenticator app, or a backup code) before the session reaches anything. Part of the same authentication processing as the magic link and the Sign-in Providers. |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)), as for signing in: a security measure the Candidate chooses (art. 32). Off by default. |
| People concerned | Candidates who turn it on in Mon compte, « Sécurité ». |
| Data | Per Candidate: the authenticator app's TOTP secret, encrypted (AES-256-GCM under AUTH_SECRET, Better Auth's cipher); the backup codes not used yet, each as its SHA-256 hash only; when it was turned on, when the app and the codes were added and last used, the last 30-second period whose code was accepted, the count of wrong codes in a row and until when codes are refused. Per passkey (#664, Better Auth's passkey plugin): the WebAuthn public key and credential id, the signature counter, the device type (single- or multi-device) and whether it is backed up, the transports, the authenticator model's AAGUID (from which the device's name is shown when it is known, e.g. « Windows Hello »; Apple devices send none), the name the Candidate gave it (a device name such as « iPhone de Marie »), when it was added and last used. Per session: whether it waits for its second step, when its second step was last done, and the passkey challenge asked last (used once). A passkey's private key never leaves the Candidate's device: Jobbbox never has it. Each attempt is counted under the Tool « Vérification en deux étapes » in AI Usage's external API calls (its outcome, no Candidate, never the code). The email telling the account it was turned on or off goes to its address; its text is not kept. |
| Source | The Candidate, in Mon compte (`/api/account/two-step-verification`, and Better Auth's `/api/auth/passkey/*` to add and rename a passkey) and on the second step's page (`/api/two-step-verification/second-step`, `/api/two-step-verification/second-step/passkey`); a passkey's public key comes from their device or security key. |
| Processors | None new: the codes and passkeys are checked within Jobbbox (SimpleWebAuthn, a library); Brevo (see « Transactional emails ») sends the emails, already a processor for emails. No new recipient outside the EU. |
| Who can read it | The Candidate, in Mon compte and in their Data export. No Back Office screen shows it; nobody can read the secret or a backup code back. A passkey's public key is never shown nor exported. |
| Storage | The `two_step_verification` and `passkey` tables and the `session` table's `twoStepPending`, `twoStepVerifiedAt` and `twoStepChallenge` columns in the app's Postgres database (EU). |
| Retention | A passkey until the Candidate removes it. Until the Candidate turns it off, or removes their last factor (the row and every passkey are deleted, and the sessions still waiting for their second step are signed out), or the account is deleted (`ON DELETE CASCADE`). |
| Rights | In the Candidate's Data export (`twoStepVerification`: when it was turned on, each factor's kind, when added and last used, each passkey's name and device when known, the backup codes left; never the secret, a code nor a passkey's public key or credential id); erased with the account. |
| Security | The secret is shown once, as a QR code drawn in the page (never by a QR code service) and as the key to type. Each code serves once; after 5 wrong codes in a row, every code is refused for 15 minutes. Turning it off, removing the last factor or renewing the backup codes takes a second step done less than 10 minutes earlier in the same session. A passkey is checked against the pending session's own account only, on Jobbbox's host (its RP ID); each challenge serves one answer, and a refused passkey counts towards the same lock as a wrong code. Signing in with a passkey alone, without a magic link, is refused. A pending session is refused on the server, by the proxy, on every page and API route but the second step and sign-out. Rotating AUTH_SECRET makes the stored secrets unreadable: the Candidates concerned would have to use a backup code, then set the app up again. |

## Livraison: the delivery status (Back Office)

| | |
| --- | --- |
| Purpose | Show the team what is being built and where it runs (Back Office › Livraison), read live from GitHub's issues, pull requests and deployments. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)) in following the delivery of the product. |
| People concerned | Contributors to the GitHub repository. No Candidate: GitHub receives nothing from Jobbbox, the page only reads it. |
| Data | GitHub logins of the people a ticket is assigned to, with issue and pull request titles and numbers, shown on the page. |
| Source | GitHub's API, read by the web app with a read-only token (Provider Secret `GITHUB_STATUS_TOKEN`); each call is recorded in `external_api_usage` (Tool GitHub) without its answer. |
| Processors | GitHub (outside the EU), which is only read. No new recipient of personal data: `receivesPersonalData` is false. |
| Who can read it | Super-admins, Technique and Support. |
| Storage | Nothing stored: the status is kept in the web app's memory for 5 minutes, then read again. |
| Retention | 5 minutes in memory; the recorded calls as `external_api_usage`. |
| Rights | A contributor's login comes from GitHub: removing them from a ticket there removes them from the page within 5 minutes. |
| Security | A read-only token, encrypted as a Provider Secret; the page checks the Administrator's Back Office Roles, and a refused opening is recorded (#264). |

## Livraison: the delivery status (Back Office and its daily email)

| | |
| --- | --- |
| Purpose | Show the team what is being built and where it runs (Back Office › Livraison), read live from GitHub's issues, pull requests and deployments, and email it each day at 18:00 (Paris) to the addresses of the Platform Setting `DELIVERY_STATUS_EMAIL_TO`. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)) in following the delivery of the product. |
| People concerned | Contributors to the GitHub repository; the email's recipients. No Candidate: GitHub receives nothing from Jobbbox, the app only reads it. |
| Data | GitHub logins of the people a ticket is assigned to, with issue and pull request titles and numbers, shown on the page. The email carries the titles and numbers, not the logins. The recipients' addresses, in a Platform Setting. |
| Source | GitHub's API, read by the web app and the worker with a read-only token (Provider Secret `GITHUB_STATUS_TOKEN`); each call is recorded in `external_api_usage` (Tool GitHub) without its answer. The recipients are set by an Administrator on Paramètres › E-mail. |
| Processors | GitHub (outside the EU), which is only read; Brevo (already a processor for emails, see « Transactional emails »), which sends the daily email with the app's mailer. No new recipient of personal data: GitHub's `receivesPersonalData` is false. |
| Who can read it | Super-admins, Technique and Support on the page; the addresses of `DELIVERY_STATUS_EMAIL_TO` by email. |
| Storage | Nothing stored: the page's status is kept in the web app's memory for 5 minutes; the email is not kept by Jobbbox. |
| Retention | 5 minutes in memory; the recorded calls as `external_api_usage`; the emails in the recipients' mailboxes. |
| Rights | A contributor's login comes from GitHub: removing them from a ticket there removes them from the page within 5 minutes. A recipient is removed by clearing their address from `DELIVERY_STATUS_EMAIL_TO`. |
| Security | A read-only token, encrypted as a Provider Secret; the page checks the Administrator's Back Office Roles, and a refused opening is recorded (#264). Changing the recipients is a Platform Setting change, written to the Back Office Audit. |

## Crash reports (#703)

_The native app's (ADR-0076). Sentry receives them from the device, not from Jobbbox's servers: it is not a Tool of the catalog, so it has no line in « Recipients and their entries »; `apps/mobile/e2e/project.e2e.test.ts` checks this entry instead. The privacy policy's clause is « Légal : politique de confidentialité, Jobbbox app » (#706)._

| | |
| --- | --- |
| Purpose | Know when the native app crashes, and where in its code, to fix it. Nothing else: no product analytics, no sessions, no performance tracing, no replay, no logs, no advertising identifier, and nothing that asks for App Tracking Transparency. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)) in keeping the app working, weighed against people's: a report is cleaned, on the device or by Sentry on receipt (« Security »), of what identifies the person or what they typed or read, and serves no other purpose. |
| People concerned | Users of the native app whose app crashes or reports an error (Candidates, signed in or not). |
| Data | Kept: the error's type, its message and stack trace (URLs in them cleaned, email addresses replaced by `[email]`), the app's release and build, the device's model and system version, the screens navigated (`from` and `to`, cleaned) and the requests the app made (method, status, cleaned URL) before the crash. Removed from JavaScript errors on the device before sending (`apps/mobile/src/crash-reports/clean.ts`): the user (id, email, IP address, username), request bodies, cookies, headers and query strings, credentials in URLs, every path segment of a URL that is not a route word (ids, emails, tokens become `:id`), touch, `ui.*` and console breadcrumbs, the device's id and name, the app's device hash. Native crashes, ANRs and app hangs, caught by the native SDKs, skip that cleaning and carry the installation id as the user's id and the device's id: those, the device's name and the app's device hash are removed by Sentry on receipt, before storage, by the project's Advanced Data Scrubbing rule (« Security »). Never collected: screenshots, the view hierarchy, iOS's native network breadcrumbs (`sendDefaultPii`, `attachScreenshot`, `attachViewHierarchy`, `enableNetworkBreadcrumbs` off). Sentry may see the device's IP address when it receives a report; it is not stored (« Security »), though Sentry still derives a country from it. |
| Source | The app on the device, in release builds only, whose configuration carries a DSN of Sentry's EU region (`EXPO_PUBLIC_SENTRY_DSN`); never in a development build, nor without that DSN, nor with a DSN outside the EU region (`apps/mobile/src/crash-reports/index.ts`). |
| Processors | Sentry (Functional Software, Inc., United States), in its EU data region. A new sub-processor. Transfer safeguard for what Sentry keeps in the US (« Storage ») and for its US staff's access: the standard contractual clauses of Sentry's DPA. |
| Who can read it | Jobbbox's developers with access to the Sentry organization. No Back Office screen shows it. |
| Storage | Sentry's EU data region: error events, releases and source maps stored in Frankfurt (Germany). Sentry keeps the organization's accounts, settings, DSN keys, project metadata and audit logs in the US, whatever the region: no report's content goes there. |
| Retention | Sentry's retention for error events: 90 days on its Team, Business and Enterprise plans, 30 days on its Developer plan. Nothing is kept by Jobbbox. |
| Rights | A stored report carries no user, device id or account identifier (JavaScript errors cleaned on the device, native crashes by the server-side rule in « Security »): Jobbbox cannot tell whose it is (GDPR art. 11), so it is not in the Data export and is not erased with an account; it disappears with Sentry's retention. |
| Security | Cleaned twice. On the device, every JavaScript event and breadcrumb goes through `cleanEvent` and `cleanBreadcrumb` before it leaves, a test checking the cleaning (`apps/mobile/src/crash-reports/crash-reports.test.ts`). Native crash, ANR and app-hang events do not: the native SDKs send them through their own `beforeSend` (`@sentry/react-native`'s `RNSentry.mm` and `RNSentryStart.java`), whatever `sendDefaultPii` says. So, required before any release build gets the DSN, the project has an Advanced Data Scrubbing rule « Remove » on `$user.id`, `contexts.device.id`, `contexts.device.name` and `contexts.app.device_app_hash`, for every event. On Sentry's side too, the project keeps the Data Scrubber and its default scrubbers on (values that look like card numbers, passwords, secrets, tokens are redacted) and has « Prevent Storing of IP Addresses » turned on, set when the project is created (`apps/mobile/.env.example`). Source maps are uploaded with a token kept as an EAS secret. |

## Hosting (ADR-0007)

| | |
| --- | --- |
| Purpose | Run Jobbbox: the web app, the worker, the job queue, Email intake's MTA and the Postgres database that holds every entry of this register. |
| Legal basis | That of each processing it hosts. |
| People concerned | Everyone Jobbbox holds data about. |
| Data | Everything the entries of this register store. |
| Processors | Hostinger International Limited (Cyprus), VPS in its Paris data centre (`docs/ops/hosting.md`); standard contractual clauses in its DPA for its own sub-processors (`docs/research/issue-522.md`). |
| Storage | The VPS in Paris (EU). |
| Retention | That of each processing. |
| Security | Secrets in the hosting's secret manager, Provider Secrets encrypted (ADR-0020); the database is reachable from the VPS only. |

## Candidate accounts and sign-in (ADR-0011)

_Added by #338, from `docs/research/issue-498.md` § 4, item 1._

| | |
| --- | --- |
| Purpose | Create a Candidate's (or an Administrator's, or a Human Coach's) account and sign them in: by a magic link sent by email, or through a Sign-in Provider (Google, Microsoft, Apple, an OpenID Connect issuer configured in Connexion). |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)). |
| People concerned | Candidates, Administrators, Human Coaches. |
| Data | Email address, name (from the Sign-in Provider when one is used), Interface Language, sessions (token, dates, user agent as Better Auth stores it), the Sign-in Provider account's id, the magic links' verification tokens, Back Office Roles. |
| Source | The person, at sign-up and sign-in; the Sign-in Provider, which passes their email address and name (scopes `openid email profile`). |
| Processors | Hostinger; Brevo, which sends the magic link (« Transactional emails »). Google, Microsoft and Apple act as separate controllers of their own accounts, through their Irish entities (`docs/research/issue-522.md`): the person chooses them; their transfers outside the EU rest on the DPF (Google, Microsoft) and the standard contractual clauses (all three). An OpenID Connect issuer is the one an organisation configured: its place is not established. |
| Who can read it | The person, in Mon compte. Super-admins and the Back Office Roles that cover accounts, in the Back Office. |
| Storage | The `candidate`, `session`, `account`, `verification`, `sign_in_provider`, `sign_in_setting` and `administrator_role` tables in the app's Postgres database (EU). The session cookie is set by Better Auth (strictly necessary, no consent). |
| Retention | While the account lives; deleted with it (« Data export and Account deletion »). Sessions end at sign-out or expiry. |
| Rights | In the Data export; erased with the account. |
| Security | HttpOnly session cookie; two-step verification on request (« Two-step verification »). |

## Master CV, Profiles and CV reading (ADR-0006, ADR-0012)

_Added by #338, from `docs/research/issue-498.md` § 4, item 2._

| | |
| --- | --- |
| Purpose | Hold the Candidate's Master CV and Profiles (target role, Search Criteria, seniority), read an uploaded CV with AI into its sections, and compute the ATS Score. |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)). |
| People concerned | Candidates; people a CV names (former employers, referees). |
| Data | The Master CV's versions (identity block, experience, education, skills), the Profiles and their Search Criteria, the ATS Scores. |
| Source | The Candidate (their CV file and what they type). |
| Processors | Claude's direct API (Anthropic, outside the EU) for `cv_parsing` and `scoring`, after Redaction: the CV goes without name, address, email or phone, but with employers, positions, dates and schools, which is **pseudonymised personal data** (ADR-0007 § Redaction). Safeguard: standard contractual clauses of Anthropic's DPA; inputs and outputs deleted within 30 days, no training (`docs/research/issue-522.md`). With EU AI Consent, what carries identity goes to Mistral, in the EU. Another AI provider (OpenAI, Claude on Bedrock or Vertex) only if a super-admin routes a task to it in Paramètres. |
| Who can read it | The Candidate; a Human Coach with Coach Access to that Profile. |
| Storage | The `master_cv_version`, `profile` and `ats_score` tables in the app's Postgres database (EU). |
| Retention | While the account lives; deleted with it. |
| Rights | In the Data export; rectified by the Candidate on their pages; erased with the account. |

## Applications and their documents (ADR-0006, ADR-0028, ADR-0029)

_Added by #338, from `docs/research/issue-498.md` § 4, item 3._

| | |
| --- | --- |
| Purpose | Follow the Candidate's Applications and write what goes with them: Tailored CVs and documents, Follow-ups, Interviews, the Agenda and its reminders, Action Cards, Company Dossiers. |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)). |
| People concerned | Candidates; people the Candidate names (recruiters, interviewers), employers' public contacts. |
| Data | The Applications and their status, the Job Offers they are for, the Tailored CVs and documents, Follow-ups, Interviews, appointment reminders, Action Cards, Company Dossiers. |
| Source | The Candidate; the Job Offer's page; public registers (`recherche-entreprises.api.gouv.fr`) and web search for a Company Dossier. |
| Processors | Claude's direct API (Anthropic, outside the EU) after Redaction, for `writing`, `scoring` and `offer_analysis`; web search (Perplexity, or Brave or Tavily as fallback, outside the EU) on queries only, such as an employer's name (ADR-0007); Brevo for the reminders (« Transactional emails »). |
| Who can read it | The Candidate; a Human Coach with Coach Access to that Application. |
| Storage | The `application`, `tailored_cv`, `tailored_document`, `follow_up_*`, `interview`, `appointment_reminder*`, `action_card` and `company_dossier` tables in the app's Postgres database (EU). |
| Retention | While the account lives; deleted with it, or with the Application. |
| Rights | In the Data export; erased with the account. |

## Coach Memory and Guardrails (ADR-0022, ADR-0036, ADR-0041)

_Added by #338, from `docs/research/issue-498.md` § 4, item 4 (the conversations themselves are « Coach Conversations »)._

| | |
| --- | --- |
| Purpose | Let the AI Coach remember what the Candidate told it across conversations (Coach Memory), keep its replies within what it may say (Guardrails), and record the runs of the Workflow Agents it starts. |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)); for the Guardrail Triggers, legitimate interest (GDPR art. 6(1)(f)) in the safety of the replies. |
| People concerned | Candidates. |
| Data | Coach Memory items; Guardrail Triggers (when, which Guardrail, its reason's code) and the Blocked messages; Workflow Agent runs. |
| Source | The Candidate's conversations; the Guardrails' checks. |
| Processors | Claude's direct API (Anthropic, outside the EU) after Redaction, for `coaching` and `guardrail`; Mistral, in the EU, for what carries identity under EU AI Consent and for `email_guardrail`. |
| Who can read it | The Candidate, through the AI Coach. Administrators see Guardrail Triggers counted, never a message. |
| Storage | The `coach_memory_item`, `guardrail_trigger`, `guardrail_message` and `workflow_agent_run` tables in the app's Postgres database (EU). |
| Retention | Coach Memory while the account lives; Guardrail Triggers 24 months (`guardrail-triggers.purge`). |
| Rights | Coach Memory in the Data export; everything erased with the account. |

## EU AI Consent (#121, ADR-0007)

_Added by #338, from `docs/research/issue-498.md` § 4, item 5._

| | |
| --- | --- |
| Purpose | Record a Candidate's consent that what carries their identity is sent to an AI model in the EU (Mistral), unredacted, and route it there. |
| Legal basis | Consent (GDPR art. 6(1)(a)), separate, specific and withdrawable at any time in Mon compte. |
| People concerned | Candidates who give it. |
| Data | Whether the consent is given, when, and when it was withdrawn. |
| Source | The Candidate. |
| Processors | Mistral AI SAS (France), `api.eu.mistral.ai`: inference in the EU and EFTA (#528, `docs/research/issue-522.md`). Mistral's training option for the API must stay off in its Admin console: to be checked by the product owner. |
| Who can read it | The Candidate. |
| Storage | The `eu_ai_consent` table in the app's Postgres database (EU). |
| Retention | While the account lives; deleted with it. |
| Rights | In the Data export; withdrawn by the Candidate at any time, with effect on the next calls. |

## Job Searches, Job discovery and Job Digests (ADR-0031, ADR-0043, ADR-0044)

_Added by #338, from `docs/research/issue-498.md` § 4, item 6 (the runs' own record is « Job discovery runs »)._

| | |
| --- | --- |
| Purpose | Find Job Offers that match the Candidate's Search Criteria (Job Searches, Target Companies), score them, and send the Job Digests they subscribe to. |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)). |
| People concerned | Candidates. |
| Data | Job Searches and their Search Criteria, Target Companies, Job Digests and their subscriptions, the Job Offers found and their Match Scores. |
| Source | The Candidate's Search Criteria; job boards, ATS and sites read for offers. |
| Processors | Queries drawn from the Search Criteria (a job, a place, an employer's name), never the Candidate's identity, go to web search (Perplexity, Brave or Tavily: outside the EU; Brave keeps queries 90 days and its DPA excludes them; Tavily may reuse queries and has no public DPA, `docs/research/issue-522.md`), to France Travail (France) and to Fantastic.jobs (Amsterdam; place of processing not published, counted as outside the EU). Claude's direct API scores the offers after Redaction. Brevo sends the Job Digests. |
| Who can read it | The Candidate. |
| Storage | The `job_search`, `job_digest`, `job_digest_subscription`, `target_company`, `target_company_refresh` and `job_offer` tables in the app's Postgres database (EU). |
| Retention | While the account lives; deleted with it. Job Offers no Candidate keeps are shared and name no Candidate. |
| Rights | In the Data export; erased with the account; a Job Digest's email has an unsubscribe link. |

## Email intake (ADR-0050 to ADR-0052)

_Added by #338, from `docs/research/issue-498.md` § 4, item 7. ADR-0051 asks for this entry and for a DPIA before Email intake opens in production: the DPIA is #453._

| | |
| --- | --- |
| Purpose | Read the offer emails a Candidate forwards to their Forwarding address (job alerts, recruiters' emails) to add their offers to Jobbbox. |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)) for the Candidate; legitimate interest (GDPR art. 6(1)(f)) for the third parties an email names (recruiters, senders). |
| People concerned | Candidates; senders and people named in the emails. |
| Data | The Forwarding address; each Received offer email (its sender, subject and text, encrypted), the offers read from it, the recognised and switched-off senders; Activité's counts, without the Candidate. |
| Source | The emails the Candidate forwards, received by Jobbbox's own MTA (Haraka, on the VPS, #580). |
| Processors | Hostinger (the MTA and the app). Mistral, in the EU, reads the text (`offer_email_reading`, `email_guardrail`: `euOnly` tasks, ADR-0055). |
| Who can read it | The Candidate. Administrators see Activité › Emails reçus, without the Candidate nor the text. |
| Storage | The `forwarding_address`, `received_offer_email`, `received_offer_email_offer`, `received_email_activity`, `candidate_recognised_sender`, `candidate_switched_off_sender`, `recognised_sender` and `linked_mailbox_event` tables in the app's Postgres database (EU). |
| Retention | An email's text 72 hours after it arrived; the Received offer email 12 months; Activité's rows 24 months (`email-intake.purge`). Deleted with the account. |
| Rights | In the Data export; erased with the account. |
| Security | The text is encrypted at rest; the MTA accepts mail for the Email intake domains only and keeps nothing on disk. |

## Enriched Contacts (ADR-0015)

_Added by #338, from `docs/research/issue-498.md` § 4, item 8. Switched off until a data processing agreement is signed (`CONTACT_ENRICHMENT_DPA_SIGNED`)._

| | |
| --- | --- |
| Purpose | Find, at the Candidate's request (Premium), the work contact details of a person at an employer they apply to. |
| Legal basis | Legitimate interest (GDPR art. 6(1)(f)) for the third party found, to be weighed by the product owner before it is switched on (ADR-0015); performance of the contract for the Candidate. |
| People concerned | Candidates; **third parties** whose details are found. |
| Data | The contact's name, position, work email and phone, LinkedIn address; the Application it is for. |
| Source | The contact-enrichment provider chosen (Lusha, Kaspr or Apollo), which receives an employer's name or domain, job titles, a country, and returns the details. |
| Processors | The provider chosen: Lusha Systems, Inc. (Israel, adequacy; SCC), KASPR SAS (France; place not established, SCC on request) or ZenLeads Inc., Apollo.io (United States; DPF and SCC). Each is also a controller of its own database. Claude's direct API sees only the contact's name and position, in a Tailored document. |
| Who can read it | The Candidate. |
| Storage | The `enriched_contact` table in the app's Postgres database (EU). |
| Retention | While the Application lives; deleted with the account. |
| Rights | In the Data export. A third party's request is answered by the Jobbbox team (GDPR art. 14: the source is the provider). |

## Subscriptions, Plan Quotas and payments (ADR-0014, ADR-0032)

_Added by #338, from `docs/research/issue-498.md` § 4, item 9 (Orders and Withdrawals have their own entries)._

| | |
| --- | --- |
| Purpose | Sell and run the paid Plans: the subscription, its payments and invoices, and the Plan Quotas counted each week. |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)); legal obligation (GDPR art. 6(1)(c)) for the accounting records. |
| People concerned | Candidates. |
| Data | The Plan, the Stripe customer and subscription ids, the Plan Quotas' use; Stripe receives the email address and the Candidate's id. Card details are entered on Stripe Checkout and never reach Jobbbox. |
| Source | The Candidate; Stripe's webhooks. |
| Processors | Stripe Payments Europe, Limited (Ireland), with transfers to Stripe, LLC (United States) on the DPF and the SCC; also a controller for fraud and anti-money-laundering (`docs/research/issue-522.md`). |
| Who can read it | The Candidate (Abonnement); super-admins and the `plans-manager` Back Office Role. |
| Storage | The `candidate_plan`, `quota_usage`, `plan` and `plan_quota` tables in the app's Postgres database (EU); payments at Stripe. |
| Retention | While the account lives; the accounting records 10 years (C. com. L123-22), at Stripe. |
| Rights | In the Data export; erasure weighed against the accounting obligation. |

## Human Coaches and Coaching Sessions (ADR-0016, ADR-0027)

_Added by #338, from `docs/research/issue-498.md` § 4, item 10._

| | |
| --- | --- |
| Purpose | List the Human Coaches, sell and run Coaching Sessions, give a Human Coach the Coach Access a Candidate grants, and keep their Coach Reviews. |
| Legal basis | Performance of the contract (GDPR art. 6(1)(b)). |
| People concerned | Candidates; Human Coaches. |
| Data | The Human Coach's name, email, bio and booking link; Coaching Sessions (date, status, payment), Coach Access, Coach Reviews and reschedulings. |
| Source | The Jobbbox team (the Human Coach's details); the Candidate. |
| Processors | Stripe for the payment. Cal.com: the Candidate books on the Human Coach's own Cal.com account; Jobbbox sends it nothing and only stores the link. Brevo sends the notices. |
| Who can read it | The Candidate; the Human Coach in their space; super-admins and the `coach-manager` Back Office Role. |
| Storage | The `human_coach`, `coaching_session`, `coach_access`, `coach_review` tables in the app's Postgres database (EU). |
| Retention | While the account lives; a Retired Human Coach's past sessions are kept. |
| Rights | In the Data export; erased with the account. |

## Transactional emails (ADR-0058)

_Added by #338, from `docs/research/issue-498.md` § 4, item 11._

| | |
| --- | --- |
| Purpose | Send Jobbbox's service emails: magic links, Job Digests, reminders, notices, confirmations. |
| Legal basis | That of the processing each email serves; the Nouveautés email has its own entry. |
| People concerned | Candidates, Human Coaches, Administrators. |
| Data | Email address, first name, the email's content. |
| Source | The processing that sends it. |
| Processors | Brevo SAS (France), by its API or SMTP relay: hosting at OVH (France) and Google Cloud (Belgium), CDN Cloudflare (United States and EU), support by group companies in the United States (DPF and SCC) and India (SCC) (`docs/research/issue-522.md`). Its residency is counted as not established in the catalog: outside the EU. Open and click tracking must be off on the account. |
| Storage | Not kept by Jobbbox; Brevo's logs per its DPA. |
| Retention | Brevo's, per its DPA (not read). |
| Rights | Through the processing each email serves. |

## Data export and Account deletion (ADR-0010)

_Added by #338, from `docs/research/issue-498.md` § 4, item 13._

| | |
| --- | --- |
| Purpose | Let a Candidate download their data and delete their account, and answer the other GDPR requests. |
| Legal basis | Legal obligation (GDPR art. 6(1)(c), art. 15 to 20). |
| People concerned | Candidates. |
| Data | What the other entries hold of the Candidate; the day of a deletion where an operations record keeps it (« Acceptances of the CGU and CGV »). |
| Source | The Candidate's request, in Mon compte. |
| Processors | Hostinger. |
| Who can read it | The Candidate (their export). |
| Storage | The export is built on request and not kept. |
| Retention | Nothing kept but what the operations records say (`OPERATIONS_RECORD_TABLES` in `apps/web/src/candidate-data`). |
| Rights | This entry is how they are exercised. |

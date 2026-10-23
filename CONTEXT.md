# Jobbbox

A coaching platform that helps senior job seekers (40+) in France land a job: it builds their candidate positioning, finds and analyses job offers, prepares tailored application material and follows up on applications.

## Language

### People

**Candidate**:
A person with an account who is looking for a job. Owns one or more Profiles.
_Avoid_: User (in domain discussions), applicant, job seeker

**Account deletion**:
The Candidate deletes their own account, confirmed by typing their email address. It takes effect at once and ends any paid subscription first. Everything tied to the Candidate goes; Job Offers stay.
_Avoid_: Account closure, deactivation

**Data export**:
One JSON file the Candidate downloads holding all their personal data, what they made and what Jobbbox worked out or obtained about them (GDPR art. 15 and 20): their account (sign-in methods and sessions), Plan and Plan Quota use, EU AI Consent, Follow-up Delays and Appointment Reminder setting; their Profiles (Search Criteria, every Master CV Version, ATS Score, Job Searches, Job Digest settings and the Job Digests sent); their Applications (Job Offer, Interviews with their Reschedule history, Match Score, Tailored Documents, Follow-ups sent, Coach Reviews, Enriched Contacts, Company Dossier); their Coach Conversations with every message, the Provenance of each of these results, Coach Memory, Action Cards, Coach Access and Coaching Sessions (with their date, who last changed it, video link and Reschedule history); their AI Message Log. It leaves out secrets (sign-in tokens and passwords, the Job Digest unsubscribe link), Human Coaches' email addresses and booking links, Stripe's and the contact data providers' identifiers, and the Coach Message Cost. Every table tied to a Candidate must land in it.
_Avoid_: Backup, data dump

**EU AI Consent**:
A Candidate's explicit, dated consent that AI calls carrying their identity go to an EU AI provider (Mistral). They can withdraw it at any time. Without it, such calls use the provider configured for their task.
_Avoid_: AI opt-in, privacy setting

**Identity block**:
The part of a CV that identifies the Candidate: name, postal address, phone and email.
_Avoid_: Contact details, header

**Redaction**:
What the AI layer takes out of every AI call, generation and web search, before it leaves for a provider: every email address and phone number found by its shape, and what Jobbbox knows of the Candidate's identity (their account's name and email, their latest Master CV's Identity block: full name, last name, postal address, phone, email), each replaced by a placeholder such as « [NOM] » or « [E-MAIL] ». The first name stays. A text task's reply gets the values back, so a Cover Letter still signs with the name; the AI Message Log keeps what was sent, redacted. It replaced the rule that personal data only goes to EU-resident endpoints: names Jobbbox does not know go through, and the rest of a CV (employers, dates, career) stays in the call.
_Avoid_: Anonymisation, masking, scrubbing (that is for keys and secrets)

**Organisation**:
An outplacement firm, APEC or corporate HR department that pays for its beneficiaries' Candidate accounts and whose advisors can follow their progress. Not in the MVP: Candidates pay for themselves first.
_Avoid_: Company, client, tenant, B2B customer

**Administrator**:
A member of the Jobbbox team who runs the Back Office. Signs in like a Candidate and holds one or more Back Office Roles; those listed in `ADMIN_EMAILS` are permanent super-admins.
_Avoid_: Admin user, operator, superuser, staff

**Guest**:
A person using the browser extension without an account. Their CV and captured Job Offer are temporary.
_Avoid_: Anonymous user, visitor, lead

**Guest session**:
The browser-held, time-limited holding of a Guest's captured Job Offer and CV: at most 23 hours, deleted on request. When the Guest creates an account or signs in, the CV becomes a Profile and the Job Offer an Application, then both leave the session.
_Avoid_: Temporary account, trial

### Coaching

**AI Coach**:
The AI agent persona that guides the Candidate through onboarding, CV improvement, job search, application preparation and follow-up. It always says it is an AI and not a person (AI Act art. 50(1)): a fixed first message in every Coach Conversation, a « Coach IA » badge by the message box and as the Coach Panel's title, and a truthful answer when asked. Its replies show no author name; each is followed by its Provenance.
_Avoid_: Bot, assistant, agent (in user-facing language)

**Human Coach**:
A real HR professional, selected by Jobbbox, whom a Candidate can book for paid sessions on top of the AI Coach.
_Avoid_: Advisor, consultant, recruiter

**Coaching Session**:
A booked, paid video meeting between a Candidate and a Human Coach. Recorded when its payment is confirmed, without a date: the Candidate then books a time on the Human Coach's Cal.com page, and that time reaches Jobbbox only when the Candidate or the Human Coach enters it (date and time in French time, optional duration, video link and note; the note is the Candidate's alone, a Human Coach never sees or changes it). It keeps who last entered or changed its date, the Candidate or the Human Coach, and the Agenda says « modifié par le coach » when it was the coach. Until then it is an Unscheduled Coaching Session. Never deleted by the Candidate.
_Avoid_: Appointment, call, meeting

**Unscheduled Coaching Session**:
A paid Coaching Session with no date entered yet, or whose date was cleared by a cancellation. Shown at the top of the Agenda as « À planifier », with the Human Coach's booking link; not in the week or month views. One a Coach manager marked as refunded in the Back Office leaves the Agenda.
_Avoid_: Pending session, draft session

**Coach Access**:
The Candidate's explicit consent allowing a Human Coach to read their Profiles and Applications.
_Avoid_: Sharing, permission

**Coach Review**:
A Human Coach's feedback on one Tailored Document of an Application. The Candidate keeps it even after revoking Coach Access.
_Avoid_: Comment, annotation

**Coach space**:
A Human Coach's pages: the Candidates who granted Coach Access, their Profiles and Applications (read-only), the form for Coach Reviews, and their own Coaching Sessions (the Candidate shown as first name and last initial, no Coach Access needed), whose date, duration and video link they can enter or correct. They see no Agenda.
_Avoid_: Coach dashboard

**Retired Human Coach**:
A Human Coach no longer listed to Candidates and who can no longer read anything. Past Coaching Sessions and Coach Reviews are kept.
_Avoid_: Deleted coach

**Coach Panel**:
The side panel, available from every page, where the Candidate talks with the AI Coach. On wide screens it sits beside the page, and the Candidate can widen it into a drawer over the page; on phones it takes the whole screen. Its one menu, the conversation's title, holds a new conversation, the saved Coach Conversations and the Coach Memory.
_Avoid_: Chat, chatbot, sidebar

**Coach context**:
What the AI Coach is told before each reply: always the Candidate summary and the Coach Memory, plus the item In view, plus summaries of the rest (onboarding answers, latest Applications, top Job Offers, the next three Agenda Items from now on, none of them cancelled), within a size cap. Summaries are trimmed before the item In view.

**Candidate summary**:
The Candidate's first name and, for each active Profile, its target role, Search Criteria and seniority (from years of experience). Never the rest of the Identity block.

**Coach Conversation**:
A saved conversation between a Candidate and the AI Coach in the Coach Panel. A Candidate has several, each attached to the Profile in view when it started. The Candidate can name, reopen and delete it. Kept 12 months after its last message, then purged; deleted with the account. Human Coaches never see it. In the Data export with every message, without the Coach Message Cost.
_Avoid_: Chat, thread, session

**Coach Memory**:
The key facts (goals, constraints, decisions) the AI Coach keeps about a Candidate across Coach Conversations. The AI Coach proposes them from a Coach Conversation; an item is saved only once the Candidate confirms it, one by one. The Candidate sees, edits and deletes items in the Coach Panel. At most 30 items of 300 characters each. Sent with every AI Coach message. Kept when a Coach Conversation is deleted; deleted with the account. Human Coaches never see it. In the Data export.
_Avoid_: Profile notes, chat history

**Coach Message Cost**:
What one AI Coach reply cost, the Playbook Agent choice, every Playbook Agent consulted and Guardrail checks included: provider, model, input, output and cached input tokens, and the estimated cost in euros at list prices, fixed when the reply is saved. Kept with the reply, so it goes when the Coach Conversation does. Its euros are seen by Administrators only, as a median and p90 per day, never by Candidates; the Candidate sees only the reply's Provenance (model, tokens, time).
_Avoid_: Bill, price

**Coach cost target**:
EUR 0.03 per AI Coach reply, judged on the daily median and p90 of the Coach Message Cost.

**Cached input**:
Input tokens the AI provider reads from its prompt cache rather than processing again; priced apart from the rest of the input.

**In view**:
The Profile, Application, Job Offer, Job Search or Job Digest the page the Candidate is on shows, or, on the Agenda, the Agenda Items of the next 30 days. The Coach Panel and AI Coach use it as context, and only if it belongs to the Candidate.
_Avoid_: Focus, current item, selected

**Action Card**:
A proposal from the AI Coach placed inside a page (e.g. "3 ATS Fixes proposées", "Relance suggérée") that the Candidate accepts or dismisses. Pending until decided or withdrawn, then accepted or dismissed, never decided twice. The AI Coach withdraws a pending card it no longer proposes (e.g. an ATS Fix the new ATS Score no longer calls for): it leaves the page as if never proposed, is not recorded as accepted or dismissed, and a decided card is never withdrawn. Accepting it carries out the change it proposes; if that fails, the card stays pending.
_Avoid_: Notification, suggestion, prompt

**Coaching Playbook**:
A versioned set of coaching rules for one coaching topic, each rule citing its Sources, together with the Playbook Agent that applies it. Written and updated in the Back Office by Playbook editors. Not a Task Playbook, which an AI task follows and the AI Coach never consults.
_Avoid_: Guide, script, prompt

**Playbook Agent**:
The specialist AI agent of one Coaching Playbook, on its own provider, model and effort, set with the playbook in the Back Office from every text provider configured (one outside the EU is marked so; every call is redacted). It is given the Coach context and its Coaching Playbook and advises on it; the AI Coach writes the reply itself. A "when to consult it" text says what it is for; the Playbook Agent choice picks which to consult, at most two per reply. A Task Playbook's Playbook Agent is the AI running that task instead: it has no "when to consult it", and its effort may be the model's own.
_Avoid_: Sub-coach, sub-agent, worker, tool, bot

**Playbook Version**:
One saved state of a Coaching Playbook (its rules and its Playbook Agent's model, effort and when to consult it), Core Digest or Sources list. Changing a Human-validated version makes a new one. A version of a Coaching Playbook can be Human-validated only after an Eval Run on it, which its validator reads beside the served version's; no score blocks it. Production serves the latest Human-validated version; other environments serve the latest. Kept forever, so Playbooks used can always be traced back.
_Avoid_: Revision, draft

**Archived Coaching Playbook**:
A Coaching Playbook no longer served to the AI Coach. Its Playbook Versions are kept. A Coaching Playbook is never deleted.
_Avoid_: Deleted playbook

**Source**:
A numbered reference (`[S12]`) to a study or official publication that backs a coaching rule. Listed once, in the Sources list shared by all Coaching Playbooks.
_Avoid_: Citation, reference, link

**Core Digest**:
The short set of cross-cutting coaching rules the AI Coach always applies, whatever the topic. Validated like a Coaching Playbook.
_Avoid_: Summary, system prompt

**Playbook Agent choice**:
The small AI call that picks, for a reply, at most two Playbook Agents of Coaching Playbooks (never of a Task Playbook) from their "when to consult it" texts, the conversation and what is In view. Each chosen agent advises on its playbook; the AI Coach reply draws on that advice. An agent that fails is left out of the reply.
_Avoid_: Routing, playbook selection, Playbook table

**Playbooks used**:
The Core Digest and Coaching Playbooks, with their versions, that an AI Coach reply drew on, recorded with the message. Empty when none is served.
_Avoid_: Sources used, citations

**Human-validated**:
A Playbook Version (of a Coaching Playbook, the Core Digest or a Task Playbook) or Guardrail message a named Administrator, not one of its authors, has reviewed and approved, with the date. A review by an AI never counts. In production, only Human-validated coaching knowledge, Task Playbooks and Guardrail messages are served.
_Avoid_: Approved, QA'd, reviewed

**Eval Case**:
A fictional scenario (a Coach context, a message, possibly an item In view) with its expected outcome: for a Guardrail, the exact verdict (let through, block or flag); for a Coaching Playbook, criteria in plain words that an AI judge scores. Never copied from a real Coach Conversation; one may be rewritten from it only once nothing of a real person is left. The AI Coach's own Eval Cases and the Guardrails' are written by developers and change with a release; a Coaching Playbook's belong to it, not to a Playbook Version, and are written in the Back Office by its Playbook editors, with no validation, in French like it, in each environment beside its Coaching Playbook; each change is in the Audit trail.
_Avoid_: Test case, golden

**Eval Run**:
One pass of a set of Eval Cases on one configuration (a Playbook Version with its Playbook Agent's model and effort, a Guardrail setting, or the AI Coach as released), with each case's result and an overall score, cost and response time, dated and kept. A Coaching Playbook's Eval Run plays the AI Coach's whole reply, made to consult that playbook, the others served as they are; Playbook editors compare models and efforts by running a draft version once per choice. Only Playbook editors and super-admins start one, and it counts in AI Usage. Scored by an AI judge Jobbbox fixes, never chosen per Coaching Playbook. An Eval Run helps a person decide; it never makes anything Human-validated.

**Guardrail**:
A named check on a Candidate's or Administrator's message to the AI Coach or Back Office Assistant (input), or on the reply of the AI Coach, a Playbook Agent or the Back Office Assistant (output), that lets it through, blocks it or flags it, by fixed rules or by asking an AI model (any configured provider, every call redacted). It guards against direct and indirect prompt injection, personal data leaks, disclosure of prompts, Coaching Playbook rules or secrets, out-of-scope or harmful advice, and distress. The set of Guardrails is fixed in code; Administrators only tune each one in the Back Office. A new setting is saved only once the Guardrail's Eval Cases have been played on it, and is refused if it lets through a case that the distress, personal data leak or secret disclosure Guardrail must block; those three can never be switched off. Other AI tasks keep their own rules and have no Guardrails. Content the Candidate did not write (a Job Offer, a Company Dossier, a CV) always reaches the AI Coach and Playbook Agents marked as data, never as instructions; a Playbook Agent's reply reaches the AI Coach the same way. Only the final reply is checked on output, not each Playbook Agent's. When the AI model cannot be reached, the message or reply goes through and the fixed rules still apply; distress words always bring the distress Guardrail message. The Back Office Assistant has only the prompt injection, personal data leak and secret disclosure Guardrails.
_Avoid_: Filter, moderation, safety layer

**Blocked message**:
A Candidate message a Guardrail stops before the AI Coach sees it, or an AI Coach reply a Guardrail stops before the Candidate does. A blocked message is answered by the Guardrail message; a blocked reply is written again once, told what was wrong, then replaced by the Guardrail message if still blocked (a leak or a secret is replaced at once). Both stay in the Coach Conversation, marked as blocked without naming the Guardrail; a distress Guardrail's answer is never shown as a block. A Guardrail set to flag only lets everything through and records it.
_Avoid_: Rejected message, filtered reply

**Guardrail message**:
The fixed text, in French and in English, a Guardrail answers with instead of the AI Coach (for distress, the 3114 helpline). Changed by super-admins in the Back Office; reaches Candidates in production only once Human-validated, each language apart. Until then, a default text written by Jobbbox applies.
_Avoid_: Error message, refusal

### Positioning

**Profile**:
One professional positioning of a Candidate (e.g. "Directeur Financier" vs "Consultant transformation"), made of a Master CV and Search Criteria.
_Avoid_: Account, persona, CV version

**Archived Profile**:
A Profile the Candidate has set aside: it keeps its Master CV and Search Criteria but no longer appears in the Profile switcher or counts toward the Plan Quota. It can be restored. A Profile that is not archived is active. A duplicated Profile starts from the original's Search Criteria and current Master CV version, which becomes version 1 of the copy.
_Avoid_: Deleted Profile, inactive Profile

**Profile switcher**:
The control in the sidebar of the Candidate's pages where the Candidate moves between their active Profiles and, while the Plan Quota allows, adds another.
_Avoid_: Profile menu, account switcher

**CV**:
The content of a Master CV or a Tailored CV (summary, jobs, skills, location), as opposed to the stored document that holds it.
_Avoid_: Resume, document

**Master CV**:
The reference CV of a Profile, from which every Tailored CV is derived. Versioned: each accepted change creates a new Master CV Version.
_Avoid_: Base CV, main CV, original CV

**Master CV Version**:
One saved state of a Master CV, numbered from 1. Saving without changes creates none.
_Avoid_: Revision, snapshot, draft

**Save bar**:
Where edits made to the Master CV on the Profile page wait until the Candidate saves them as one Master CV Version or cancels them. If a newer Master CV Version arrives first (for example an accepted ATS Fix), the edits are kept and saving is refused as a conflict, never merged or dropped.
_Avoid_: Draft, autosave

**Restore**:
Making an earlier Master CV Version current by saving its content as a new version, so the history is kept and nothing is overwritten.
_Avoid_: Rollback, revert, undo

**CV Template**:
One of a small set of ATS-safe layouts used to export a CV.
_Avoid_: Theme, design, model

**Application export**:
Downloading an Application's saved Tailored CV or Cover Letter as a PDF or Word file, using a CV Template. Only saved documents are exported, never a proposal or unsaved edits. A Cover Letter is dated the day of the export, carries the Master CV's contact details once (the Candidate is named in the sender block only) and is addressed to the employer; only the letter's body comes from the stored text.
_Avoid_: Download, print

**Search Criteria**:
The job-search parameters of a Profile: one target role, one minimum salary, and any number of locations (up to five, entered as chips: chosen from Place suggestions or typed, kept as text, two being the same when they match without case or accents), contract types, remote-work options, Sectors, Subsectors and Domains (kept as codes); none chosen means no preference. A Job Offer meets a criterion as soon as it meets one of its values. Sectors, Subsectors and Domains steer Job discovery only: the Match Score does not compare them. Search Criteria saved or sent before they existed read as none chosen. The Candidate can change them on an active Profile, each change saving as soon as it is made; this never renames the Profile, and Match Scores and Tailored CVs already kept are not recomputed. An Archived Profile's Search Criteria are read-only until it is restored.
_Avoid_: Filters, preferences

**Sector**:
A kind of employer the Search Criteria look for: a section of INSEE's NAF rév. 2 nomenclature (A to U, e.g. C, Industrie manufacturière), kept as its code and shown by its label from the Reference data. A Sector chosen without any of its Subsectors searches all of them. Not the sector the AI reads on a Job Offer, which is free text.
_Avoid_: Industry, activity, NAF code (alone)

**Subsector**:
A division of NAF rév. 2 (two digits, e.g. 29, Industrie automobile), within one Sector. Only the Subsectors of the Sectors chosen are offered; choosing one chooses its Sector, and removing a Sector removes its Subsectors. Said in words in place of its Sector.
_Avoid_: Sub-sector, division (alone)

**Domain**:
A kind of work the Search Criteria look for: a ROME 4.0 professional domain of France Travail (a letter and two digits, e.g. M13, Direction d'entreprise, under its grand domain M), kept as its code and shown by its label from the Reference data. Sent to the France Travail search; web search queries do not name it.
_Avoid_: Field, ROME code (which names one job), grand domain (the letter above it)

**Reference data**:
The labels of the Sectors, Subsectors and Domains, from public nomenclatures: NAF rév. 2 from INSEE (French and English) and the ROME 4.0 professional domains from France Travail's open data (French only), each source a Tool sent no data. Kept in the database, fetched on first need and refreshed monthly by the worker; a source that fails keeps the labels it had; a code with no label yet is shown as its code in the inputs and left out of the criteria in words. Which codes the Search Criteria accept, and which Sector each Subsector belongs to, is fixed in the code, not reference data. Tied to no Candidate: not in the Personal Data Export. NAF 2025 replaces NAF rév. 2 in January 2027.
_Avoid_: Référentiel (in code and English), lookup table

**Place suggestion**:
A commune, département or région offered while the Candidate types a location, from the French public geographic API. Choosing one only fills in its name; the location stays plain text, and typing a place not suggested is fine.
_Avoid_: Autocomplete (alone)

**Onboarding Questionnaire**:
The guided interview, one question at a time, that builds a Master CV when the Candidate has no CV to upload. Scripted, so it cannot invent facts; its result is reviewed like an uploaded CV.
_Avoid_: Form, survey

### Job offers

**Job Offer**:
A job posting, captured by the extension, read from a Job Offer link or found by the AI Coach's search. One Job Offer can be referenced by many Candidates. Carries a Job Offer Summary and, read by the AI with it, its employer's sector and sub-sector (or domain).
_Avoid_: Job, posting, ad, vacancy, offer (alone)

**Job Offer Summary**:
Two or three sentences on a Job Offer (the role, its scope, what is expected), written by the AI from the offer's own text and in its language, inventing nothing, as its Task Playbook says. Shown, labelled as written by the AI, at the top of the Application's page. None is written, nor the sector, while that Task Playbook has no version served (in production: none Human-validated).
_Avoid_: Abstract, description

**Capture**:
The act of the browser extension turning the job page the person is viewing into a Job Offer, either detected automatically or triggered manually.
_Avoid_: Scrape, import, clip

**Job Offer link**:
A link to one job posting the Candidate pastes in a Coach Panel message. Once the Guardrails let the message through, Jobbbox reads the page the way Job discovery reads one (robots rules, as itself, giving up at bot protection or a sign-in), takes its JobPosting data or has the AI read its text as data, and stores it as a Job Offer like a Capture. The AI Coach answers with a set reply and a Job Offer card instead of its own reply. A Forbidden site is never read: the reply sends the Candidate to the extension, as it does for a page that cannot be read.
_Avoid_: URL import, scrape

**Job Offer card**:
The card in an AI Coach reply to a Job Offer link: the Job Offer's title and employer and a link to its page. "À traiter" until the Candidate follows it (saves it as an Application), which gives it its Match Score and At a glance; then "Suivie". Not an Action Card: nothing is accepted or dismissed. Saved with the Coach Conversation; never given to the AI Coach.
_Avoid_: Action Card, preview, link card

**Job discovery**:
The AI Coach's search of the web for Job Offers matching a Profile's Search Criteria. Contrast with Capture, which starts from a page the person is viewing. URLs named in the search provider's answer are read like its sources, but the answer itself never makes a Job Offer.
_Avoid_: Scraping, crawling (alone)

**Listing page**:
A result page that lists several postings (a job board's search results, a careers site's openings) rather than describing one. Job discovery reads up to 5 of its postings on the same site, each checked like any result page. It is never a Job Offer itself.
_Avoid_: Results page, index page

**Job Search**:
One run of Job discovery that a Candidate starts for a Profile, and its outcome: searching, done, failed or stopped. Started from the Recherches d'offres page, for one Profile or for all their active Profiles at once (one Job Search each); the Coach Panel and "Relancer une recherche" on a Job Search's page start one for a single Profile. A Profile's page does not offer it. With several locations it searches each of them within the one Job discovery budget. It counts one against the Plan Quota, and the use is given back if the search fails, times out or is stopped without keeping a Job Offer. The Candidate can stop it from AI Activity; a stopped or failed search keeps, and links, the Job Offers it had already found. A search nobody has finished after 15 minutes is failed. Its page shows the Match Scores against the Profile's current Search Criteria; a Job Search keeps no copy of the criteria it was run with.
_Avoid_: Search (alone, ambiguous with Search Criteria)

**Job Search Notification**:
A message shown on every workspace page when a Job Search stops being searching: how many published Job Offers it found, or why it failed (and that it does not count toward the Plan Quota). In-app only, no email. It stays until the Candidate closes it or opens that Job Search, and is hidden on that Job Search's own page.
_Avoid_: Alert, toast, Action Card

**Job Search query**:
One job title (the Search Criteria title or a Job title variant) worded in French or English, with the Search Criteria's places, contract types, remote-work options, minimum salary and Sectors (by their labels, in the query's language where NAF has it); a Job Search has up to 6. Each gets its first page of results, and a next page only while the last gave a New readable posting.

**Job title variant**:
Another title for the same job, suggested by an AI step given the Search Criteria title only (no other Candidate data). Used to word more Job Search queries.

**New readable posting**:
A Job Offer a results page gave that the run had not found yet. It is what lets a Job Search query get its next page.

**Job discovery budget**:
The limits that end one run of Job discovery (a Job Search or a Job Digest top-up), whichever comes first: a number of Job Offers found (new or already stored), an estimated spend in euros, or a duration. Defaults: 30 Job Offers, EUR 0.08, 90 seconds. The result page being read when a limit is reached is finished, so a run can go slightly past it.

**France Travail search**:
The first source of a Job discovery run when France Travail is configured: the official job-offer API of France Travail, searched with the Search Criteria: by their contract types, Subsectors (with every Subsector of a Sector chosen without any) and Domains, any of which will do. Its Job Offers count toward the Job discovery budget; when they fill it, the Fantastic.jobs search, the AI plan and web search are skipped. Losing access is a normal outcome, never a failed run.

**France Travail status**:
How the France Travail search went in one run, part of the Discovery metrics: off (not configured), searched, refused (access withdrawn or credentials rejected) or failed (any other error).

**Fantastic.jobs search**:
The source of a Job discovery run after the France Travail search when Fantastic.jobs' key is set: its `active-ats` API, the postings of employers' own career pages (their ATS), searched once a run by the Search Criteria title and first location, even when they name several. Each Job Offer is captured at its ATS page and dated by its posting, so it deduplicates with those already stored. Its Job Offers count toward the Job discovery budget; when they fill it, the web search is skipped. Every job returned is charged, so one search asks for no more than a set maximum (10 by default) and none once a quota is spent, until it is renewed (ADR-0031). A refusal is a normal outcome, never a failed run.
_Avoid_: Fantastic.jobs feed, job board search

**Fantastic.jobs status**:
How the Fantastic.jobs search went in one run, part of the Discovery metrics with its calls, Job Offers kept and estimated cost: off (no key or the source disabled), searched, refused (key rejected, or its Jobs credits or API requests spent) or failed (any other error).

**ROME code**:
France Travail's code for a job, derived from the Search Criteria title; a title naming no known job is searched by keywords instead.

**Discovery metrics**:
What one run of Job discovery (a Job Search or a Job Digest top-up) measured: how many Job Offers each step kept (provider URLs, pages read, Job Offers extracted, already stored, left after deduplication, with a Match Score of 60 or more), the pages skipped by Skip reason, and the estimated cost in euros. Costs are estimates from list prices, not billed amounts. Duration is the Candidate's wait (start to outcome) for a Job Search, and the worker's run time for a Job Digest.

**Skip reason**:
Why a result page gave no Job Offer (for example a Forbidden site, robots.txt, an unreadable page, a closed posting, a posting too old, or a disabled Job discovery site).

**Job discovery source**:
Where Job discovery finds Job Offers: the France Travail search, the Fantastic.jobs search, the web search, or the public APIs of the ATS postings are read through (Greenhouse, Lever, Ashby). Administrators enable or disable each from the Back Office; a disabled one is skipped by Job Searches and Job Digest top-ups (France Travail or Fantastic.jobs then counts as off, and an ATS posting is read from its page). All are enabled when the Back Office cannot be read.
_Avoid_: Provider (alone), channel

**Job discovery site**:
A domain Administrators list in the Back Office for Job discovery. While enabled, it is searched on purpose: one web search of the run, the plan's first Job Search query, restricted to it. While disabled, a result page on it (or a subdomain) is skipped. Never a Forbidden site. Removing one never removes a Job Offer found on it.
_Avoid_: Source (alone), whitelist, blacklist

**Job Site**:
A site where the browser extension shows its "Analyser cette offre" badge, as a match pattern (e.g. `https://*.gestmax.fr/*`), optionally with the pattern of its posting pages. Built-in Job Sites are in the extension's manifest and can only be disabled; Administrators add others in the Back Office, where they get the badge only for people who allowed the extension on every site. A disabled Job Site gets no badge, but Capture from the popup still works there. The extension reads the list from the web app, keeping the last one read, or its built-in Job Sites before any.
_Avoid_: Job board (for the setting), watched site

**Posting date**:
When a Job Offer was first published, as its source states it. Sources, strongest first: the public JSON API of Greenhouse, Lever or Ashby, or a France Travail offer's creation date, the page's JobPosting `datePosted`, then the search provider's date for that page (weakest, as it may be a last-updated date). A date in the future or before 2000 counts as unknown. Never taken from a Candidate or the extension. Job discovery skips a posting first published more than 30 days ago (Skip reason "too old"), including a stored Job Offer found again, and the Job Digest leaves it out. A Job Offer with no known date is kept, labelled "date unknown", and listed after dated offers with an equal Match Score.
_Avoid_: Publication date (when unknown), created date

**Forbidden site**:
A site whose terms forbid crawling (LinkedIn, Indeed, Glassdoor). Job discovery never fetches it, it can never be a Job discovery site, and a Job Offer link to it is never read; only Capture covers it.

**Expired Job Offer**:
A Job Offer that is no longer published at its source: two re-checks in a row found it gone (404/410, past its closing date, or sent away from its page). Only Job Offers an ongoing Application follows (not at Acceptée, Refusée or Abandonnée) are re-checked. A live re-check in between starts the count again, and an expired offer found published again stops being expired. Its Applications are flagged, but their Application Status is never changed automatically. Left out of Job Digests and Job Search results.
_Avoid_: Closed, dead, archived offer

**Reported Unavailable**:
An Application whose Candidate reported its Job Offer as no longer published, which they can undo. It flags that Application only, the same way as an Expired Job Offer ("signalé par vous"); the shared Job Offer and other Candidates' Applications are untouched, and the Application Status is kept.
_Avoid_: Reported expired, closed by the Candidate

**Presumed Employer**:
The AI Coach's guess at the real employer behind a Job Offer posted by a recruiting agency. It becomes the employer, and gets a Company Dossier, only once the Candidate confirms it. It is a company name; when the posting only describes the client, there is no name to confirm and the Candidate names the employer.
_Avoid_: Hidden employer, client

**Job Digest**:
A recurring email and in-app summary of new Job Offers matching a Profile's Search Criteria. Opted into per Profile, at a frequency the Candidate picks within the Plan Quota; it goes out at 07:00 Paris time (weekly ones on Monday). Its Job Offers come first from those already stored, Job discovery only topping them up. Only holds Job Offers never shown before for that Profile (in a Job Digest or a Job Search) and without an Application; nothing is sent when there are none. Stops for an Archived Profile; unsubscribing needs no sign-in. Never counts against the Candidate's other Plan Quotas.
_Avoid_: Alert, newsletter, feed

**Company Dossier**:
The research compiled about the employer behind a Job Offer from public data only: legal identity, address, financials and Suggested Contact Roles. Built from the French company register for a French employer; for a foreign one, from the web and marked less reliable. Never names a private person. Built only for a confirmed employer, and refused when the employer is not a company (e.g. a sole trader), in which case the Candidate is asked to name the hiring company. Holds the employer's Company News.
_Avoid_: Company info, company profile

**Company News**:
Up to five articles about a Company Dossier's employer from the last twelve months, found by web search when the dossier is built, worded as its Task Playbook says: each one's title, outlet, date and link, never its text, and none whose title names a private person. Part of building the dossier, counted against no Plan Quota.
_Avoid_: Press review, feed

**Suggested Contact Role**:
A job title the Candidate should look for and contact at the employer (e.g. "DRH"), given without naming a private person.
_Avoid_: Lead, target

**Enriched Contact**:
A named person at the employer, with contact details, obtained from a licensed data provider. Premium Plan only. It exists once a found person has been revealed.
_Avoid_: Lead, prospect

**Found person**:
A person a contact-enrichment provider found at the employer, from the Company Dossier's Suggested Contact Roles, before any contact details. Finding is not counted and is not yet an Enriched Contact.
_Avoid_: Lead, prospect

**Reveal**:
Getting a found person's contact details, which makes them an Enriched Contact and counts one against the Plan Quota. Revealing the same person again is free; a reveal that fails or brings back nothing is not counted.

**Contact-enrichment provider**:
The licensed data provider (Lusha, Kaspr or Apollo) that supplies Enriched Contacts. Chosen on Paramètres or by configuration (or "none", which turns Enriched Contacts off over env) and enabled only once its data-processing agreement is signed and its key is set; with the agreement unsigned the feature is off whatever the provider and key, and with it signed but no key it is off rather than failing. A super-admin marking the agreement signed on Paramètres, or « Rétablir » falling back to an environment value of signed, must confirm it first; until then nothing is saved or recorded.

### Applications

**Application**:
The link between one Profile and one Job Offer, created when the Candidate saves the offer. A Candidate has at most one Application per Job Offer: saving the same offer again returns the existing one. The Candidate can switch its Profile later. Holds the Match Score, the Tailored Documents, the Application Status and the Follow-ups.
_Avoid_: Job entry, candidature (in code), opportunity

**Application Status**:
The stage an Application is at: À postuler → Postulée → Relancée → Entretien → Offre reçue → Acceptée, or the end states Refusée / Abandonnée. Changed manually by the Candidate.
_Avoid_: State, stage

**Archived Application**:
An Application at an end state (Acceptée, Refusée, Abandonnée) or whose Profile is archived. Kept, but left out of Mes candidatures until the Candidate asks to see them.
_Avoid_: Closed application, old application

**Interview**:
One dated interview round within an Application: date and time in French time (Europe/Paris), optional duration, format (video, phone or on site), place or link, and a note. Entered by the Candidate, from the Application or from the Agenda, never detected or imported. Added only while the Application is at "Entretien": adding one from the Agenda to an Application at another status offers to move it to "Entretien", which the Candidate confirms. Kept if the Application moves on, archived ones included. It can be edited, Rescheduled or Cancelled at any status; deleting it is for an entry made by mistake and leaves no trace.
_Avoid_: Meeting, call

**Follow-up**:
A follow-up email draft the AI Coach proposes when an Application has stayed "Postulée" or "Relancée" too long without change. Sending one moves the Application to "Relancée". Nothing is sent to the employer (ADR-0005): the Candidate sends it themselves and marks it as sent; the only email Jobbbox sends is a notice to the Candidate.
_Avoid_: Reminder, relance (in code), nudge

**Follow-up sent**:
A Follow-up the Candidate marked as sent. A "Relancée" status set by hand counts as one. At most two per Application.

**Abandonnée suggestion**:
The AI Coach's Action Card proposing "Abandonnée" after two Follow-ups sent without an answer.

**Follow-up Delay**:
How long an Application must stay unchanged before a Follow-up is proposed (by default 7 working days after "Postulée", then 10 more after each Follow-up sent), adjustable per Candidate from 1 to 60 working days. Working days are French ones: weekends and public holidays excluded.
_Avoid_: Timeout, reminder interval

**Tailored CV**:
A copy of a Profile's Master CV adapted to one Job Offer, stored on its Application. Contains only facts present in the Master CV or confirmed by the Candidate.
_Avoid_: Custom CV, adapted CV

**Tailored CV Review**:
The step where the Candidate checks a Tailored CV proposed by the AI Coach before it is saved: its questions about requirements the Master CV does not cover, its changes against the Master CV, and the Match Score of both. Each change is accepted or rejected on its own, and only accepted changes are saved; a rejected change keeps what the Master CV says. Until saved, the Tailored CV is only a proposal; a requirement is added only if the Candidate confirms it.
_Avoid_: Preview, approval, diff

**Flagged Change**:
A change in a Tailored CV Review that rephrases a text with Job Offer words the Master CV lacks. It starts neither accepted nor rejected and is never saved without the Candidate's explicit accept. Common words of job offers and elision fragments ("jusqu" from "jusqu'à") are not flagged.
_Avoid_: Suspicious change, warning

**Refusal Reason**:
Why an AI Coach reply is not a usable proposal: no JSON in it, unreadable JSON, the wrong shape, or no CV in it. A refused Tailored CV reply is retried once before the Candidate is told the proposal is unavailable. Logged with the reply's length and the provider and model, never its content.
_Avoid_: Parse error

**Document Language**:
The language Tailored Documents are written in. Defaults to the Job Offer's language, independent of the Candidate's interface language.
_Avoid_: Locale (for documents)

**Cover Letter**:
A motivation letter written for one Job Offer, stored on its Application. Only the letter's body, from salutation to closing, in plain text; the sender block, recipient, place and date, and name belong to the Application export.
_Avoid_: Motivation letter, lettre (in code)

**Outreach Message**:
A short email or LinkedIn InMail draft to a contact at the employer, stored on its Application. It may name one chosen Enriched Contact as recipient; the other Tailored Documents name no one.
_Avoid_: Mail, InMail, message (alone)

**Tailored Documents**:
The collective term for an Application's Tailored CV, Cover Letter and Outreach Message.

### Agenda

**Agenda**:
The Candidate's page « Entretiens et rendez-vous », in the Sidebar after Mes candidatures: their Agenda Items as a list (the default: upcoming ones grouped by day, past ones on request, newest first), a week (Monday to Sunday, one column per day) or a month, each view and period with its own address. Unscheduled Coaching Sessions sit at the top. Past Agenda Items stay, shown dimmed; nothing is removed automatically.
_Avoid_: Calendar, planning, schedule

**Day the Agenda is on**:
The day an Agenda address names along with its view. In the month it is also the chosen day, whose Agenda Items are listed below the grid. « Précédent » and « Suivant » go to the 1st of the previous or next month (or a week back or forward), « Aujourd'hui » to today. An unknown view or invalid day falls back to the list on today.

**Remembered view**:
The last view a Candidate picked, kept in that browser. The Agenda's own links always name their view, so only the Sidebar link (the Agenda with no view) restores it; the past list stays a list.

**Past Agenda Item**:
An Agenda Item dated before today in French time, shown dimmed in every view. Earlier today is not past. In the month an Interview is marked by a disc and a Coaching Session by a hollow diamond, so they differ by shape and not only by colour.

**Agenda Item**:
An Interview or a dated Coaching Session, as the Agenda shows it. An Interview links to its Application's Interviews Section, a Coaching Session to its Human Coach. Not a thing of its own: the two keep their own rules.
_Avoid_: Appointment, event, meeting

**Reschedule**:
A change of an Agenda Item's date and time made more than an hour after it was entered or last changed; a change within that hour is a correction and leaves no trace. Each Reschedule is kept in the item's Reschedule history (previous date, new date, by whom, when), and the item shows « Reporté », with the date first planned.
_Avoid_: Move, edit (for a date change)

**Cancelled Agenda Item**:
An Agenda Item the Candidate (or, for a Coaching Session, the Human Coach) marked as cancelled. A Cancelled Interview stays on the Agenda struck through, with the date of cancellation. A Cancelled Coaching Session goes back to Unscheduled, the cancellation kept in its Reschedule history; refunds are handled outside Jobbbox. No Appointment Reminder and no Calendar file for it.
_Avoid_: Deleted appointment

**Appointment Reminder**:
The email Jobbbox sends the Candidate at 18:00 French time the day before an Agenda Item still planned, in their Interface Language. On by default, switched off in Mon compte's Rappels Section; on every Plan, against no Plan Quota. None for an Agenda Item whose date was entered or last changed (Rescheduled included) after that time. One email per Candidate for the whole next day; a Rescheduled Agenda Item gets a new one for its new date. A Cancelled Agenda Item gets none; an Archived Application's Interview or a Retired Human Coach's Coaching Session still does. A late run still reminds items not yet started. The email links to the Rappels Section to switch reminders off. The Human Coach gets none.
_Avoid_: Notification, alert, Follow-up

**Calendar file**:
One Agenda Item as a downloadable .ics file (« Ajouter à mon calendrier »), in French time. Jobbbox offers no calendar subscription or sync: a later change needs a new download.
_Avoid_: Calendar sync, feed

### Scoring

**Match Score**:
A 0–100 measure of how well a CV (Master or Tailored) fits a Job Offer, with an explained breakdown (skills covered/missing, seniority, location, salary, contract type).
Each breakdown item is a match, partial, mismatch or unknown (the Job Offer or the Search Criteria give nothing to compare); unknown items do not count in the score. Seniority compares the years of experience the Job Offer asks for with the span of dated jobs on the CV.
With no known item it is not computable (never shown as 0); when its known items weigh less than half the score (skills weigh 40, seniority 20, location and contract type 15, salary 10) it is a Partial Match Score.
A Match Score the Candidate or Guest asks for comes in two phases, counted once against the Plan Quota: first from what the Job Offer states in structured form; if that is not a reliable 70 or more and the Job Offer lacks a detail a criterion needs, an AI reads the Job Offer's text (never the CV) for it, the details found are kept on the Job Offer (once per Job Offer, never replacing a stated one) and the CV is scored again by the same rules. If the AI cannot read it, the first-phase score is shown, saying so.
On a Job Offer's page, a signed-in Candidate sees the Match Score against the Profile picked in the save form (the one the Job Search or Job Digest link named first), or, once the Job Offer is an Application, the Application's Profile, archived or not. Showing it never counts against the Plan Quota.
_Avoid_: Fit, compatibility, relevance

**Partial Match Score**:
A Match Score whose known items weigh less than half the score (e.g. seniority alone): shown with "partiel" and how many of the 5 items could be compared, never as a confident score.
_Avoid_: Low-confidence score

**"Pourquoi N ?"**:
The reasons behind a Match Score of N, shown on each Job Offer of a Job Search or Job Digest: one line per breakdown item with its verdict.

**Kept Match Score**:
The last Match Score held in the extension's session, with the Job Offer and the Profile (signed-in Candidate) or CV (Guest) it was computed for. Shown again, not recomputed, until the Job Offer changes, the Candidate chooses another Profile or CV, or asks to rescore; forgotten with the session. A refused score is never kept.

**Chosen Profile**:
The Profile a signed-in Candidate last chose in the extension to score Job Offers against. It is used for the next offers while it stays active; otherwise the first active Profile is used. Separate from the Profile switcher, which follows the open Profile page.

**ATS Score**:
A 0–100 measure of how well a Master CV would pass applicant tracking systems, combining Readability and keyword coverage for the Profile's target role. Independent of any Job Offer.
_Avoid_: CV score, parse score

**ATS Fix**:
A minimal, single change to a Master CV proposed by the AI Coach to raise its ATS Score, accepted or rejected individually. Computing the ATS Score again refreshes the pending ATS Fixes to match the new score; a dismissed ATS Fix is never proposed again.
_Avoid_: Suggestion, correction, improvement

**Senior Advice**:
A category of ATS Fix targeting age-related bias (birth date, photo, very old experience, "30 ans d'expérience" phrasing). The Candidate may ignore it.
_Avoid_: Age fix, anti-discrimination tip

### Preferences

**Interface Language**:
The language the Jobbbox interface is shown in. French by default. Independent of the Document Language.
_Avoid_: Locale (in domain discussions), UI language

**Text Size**:
The Candidate's choice of how large all interface text is shown, on a four-step slider in Mon compte's Préférences: Petit, Standard, Moyen, Grand (16, 17, 18 and 20px body text). Petit sits on the body-text floor, so no step shrinks text below it. Remembered on that device; the pages read without signing in keep a select for it.
_Avoid_: Zoom, font setting

**Sidebar**:
The menu down the side of the Candidate's pages: Profile switcher, links to their pages, and at its foot the Usage Meter, Mon compte and signing out. The Candidate can hide it, and the choice is remembered in that browser. On narrow screens it becomes a drawer opened from the Top Bar's Menu button.
_Avoid_: Navigation bar, workspace header

**Top Bar**:
The bar above every page beside the Sidebar: the page's title, the Menu button when the Sidebar is hidden, and the Coach Panel's button while the panel is closed.
_Avoid_: Header, navbar

**Section**:
One part of a long page, with its own address: Mon compte's Profils, Abonnement, Relances, Rappels or Mes données, a Profile's or an Application's parts, a Back Office section. On wide screens a page's Sections are listed beside it, or in the Sidebar in place of its links when the page has no room (the main menu one arrow away); on phones the list is the page and each Section opens as a drawer, its title in the Top Bar leading back to the list.
_Avoid_: Tab, sub-page, panel

### Delivery

**Agent Run**:
One run of an AI agent by a delivery workflow (e.g. implementing, testing or reviewing a GitHub issue), recorded with the time, tokens and verification round it used so delivery cost per issue can be followed up. Internal to the team building Jobbbox; unrelated to the AI Coach.
_Avoid_: Job, task, session, AI call

### Billing

**Coaching Session Price**:
The single price Jobbbox sets for a Coaching Session, discounted on Plans with the Coaching Session discount Plan Feature.
_Avoid_: Coach rate, fee

**Plan**:
The subscription tier a Candidate is on, defined by Administrators in the Back Office: a permanent key, a name in each Interface Language, a rank, offered or hidden, one Stripe product, fixed once set (every price of that product is the Plan's), its Plan Quotas and Plan Features. Free is built in: always ranked first and offered, with no Stripe product. A Plan is never deleted; a hidden Plan is not in the plan comparison, at checkout or in an Upgrade Prompt, and its subscribers keep it. Jobbbox started with Free, Standard and Premium. Coaching Sessions are paid separately.
_Avoid_: Tier, package, offer (ambiguous with Job Offer)

**Plan Feature**:
Something a Plan has or not, from a fixed set in code, switched on or off per Plan by Administrators; a countable limit is a Plan Quota instead. The first and only one so far: the Coaching Session discount.
_Avoid_: Entitlement, perk, add-on, feature flag

**Paid Plan History**:
Whether a Candidate has ever been charged for a Plan, even if they are back on Free. It decides whether the invoices entry is offered on the subscription page. A Coaching Session payment alone does not count.
_Avoid_: Billing history, customer status

**Scheduled Cancellation**:
A paid Plan the Candidate cancelled in the Stripe customer portal for a later date, usually the end of the paid period. The Candidate keeps the Plan until then, the subscription page shows "<Plan> jusqu'au <date>", and renewing removes the date. An immediate cancellation drops to Free at once.
_Avoid_: Pending cancellation, expiry

**Plan Price**:
What a Plan costs each billing interval, shown in the plan comparison: the default price of the Plan's Stripe product, which checkout sells. Read from Stripe, never set by us; Free costs 0. Left out when Stripe cannot give it.
_Avoid_: Tariff, fee

**Plan Quota**:
A configurable usage limit attached to a Plan: Profiles held at once, Match Scores, ATS Scores, Job Searches and Enriched Contacts per week (from Monday 00:00, French time), and the Job Digest frequency. A quota can be unlimited or not included at all. Changed by Administrators; a change applies at once to every Candidate on the Plan. Administrators who may change them can also reset the week's usage of every Candidate, giving a reason the Back Office Audit records.
_Avoid_: Limit, allowance, credits, monthly quota

**Usage Meter**:
The bar at the foot of the Sidebar showing how much of the week's Plan Quotas the Candidate has used: every use over every use the Plan grants, so each quota weighs what the Plan grants of it; unlimited and not-included quotas weigh nothing. Its button shows each quota's use and the Job Digest frequency, and leads to the subscription page.
_Avoid_: Credits bar, usage gauge

**Coupon**:
A code a Candidate types at Plan checkout, or brings in a shared link (`/abonnement?code=…`), for a discount on a Plan: a percentage, or a fixed amount in euros, off once, for N months or for as long as the subscription lasts, on the Plans it names, with an optional expiry, maximum redemptions and an optional first-payment-only restriction (Stripe's: refused to anyone who has already paid anything, a Coaching Session included; not "first subscription"). A Stripe coupon and its promotion code, created by Plans managers in the Back Office's Codes promo section; Stripe counts its redemptions. Its terms never change; deactivated, it can no longer be redeemed, while discounts already given run their course. A code brought to checkout that does not apply (another Plan, expired, refused by Stripe, not checkable) is refused with the reason, never dropped silently: the Candidate may go on without it. A 100 % Coupon subscribes without a card; when its free period ends with no card, the Candidate is back on Free at once. A fixed amount for as long as the subscription lasts must stay below the Plans' prices. The subscription page shows the discount a subscription is getting. Coaching Sessions take no Coupon.
_Avoid_: Promo code, voucher, discount code

**Upgrade Prompt**:
What a Candidate is shown when a Plan Quota stops them: what they reached and the lowest-ranked offered Plan above theirs that would let them go on, or when the quota renews if no Plan offers more.
_Avoid_: Paywall, upsell, upgrade popup

**Payment Failed Notice**:
What a Candidate is shown while their subscription is past due: Stripe is retrying a failed payment and the Plan is kept. It sends them to the Stripe customer portal to update their payment method, and disappears once payment succeeds. Shown only in the Candidate's sidebar layout.
_Avoid_: Dunning banner, billing alert

### Operations

**Back Office**:
The internal pages where Administrators manage Plans, Plan Quotas, Coupons, Human Coaches, Coaching Playbooks, Core Digest and Sources, Guardrails, Provider Secrets, Platform Settings, Sign-in Providers, Job Sites, Job discovery sources and Job discovery sites and the team's Back Office Roles, and follow AI Usage, Guardrail Triggers and the state of the Tools.
_Avoid_: Admin panel, dashboard, console

**Back Office Role**:
What an Administrator may see and change in the Back Office: super-admin (everything, including roles, Guardrails, Provider Secrets, Platform Settings, SSO providers, Job Sites, Job discovery sources, Job discovery sites and the AI Message Log), Plans manager (Plans, Plan Quotas, Plan Features, Coupons), Coach manager (Human Coaches, read Coach Message Cost), Playbook editor (Coaching Playbooks, Core Digest and Sources: edit, validate, archive; Eval Cases and start Eval Runs) or Support (read-only, including Eval Runs, Tools and Platform Settings, no secrets, no AI Message Log). Super-admins also start Eval Runs. Fixed in code; only super-admins grant or revoke them.
_Avoid_: Permission level, admin type

**Provider Secret**:
A third-party key (an AI provider's, France Travail's, Fantastic.jobs', the contact-enrichment provider's, Stripe's, Brevo's API key or SMTP credentials) that super-admins enter in the Back Office's Clés section. Stored encrypted in our database and used over the environment variable of the same name, which it falls back to once cleared. Never shown again once saved: only its source, last 4 characters, and who changed it when.
_Avoid_: API key setting, credential, config secret

**Platform Setting**:
A non-secret setting of the platform that the code gives a default and the environment can override: where Claude is reached and in which region, each AI task's provider and model, the identity model, OpenAI's data residency, the web search provider and model, `MAIL_FROM`, the Job Digest's thresholds, the Job discovery budget, the contact-enrichment provider and whether its DPA is signed, and the extension's store page. Super-admins change it in the Back Office's Paramètres section (under Plateforme), which wins over the environment variable of the same name, which wins over the code's default; « Rétablir » clears the Back Office's value. So far only AI routing, the email sender (`MAIL_FROM`), the Job Digest's thresholds, the Job discovery budget, Enriched Contacts' provider and DPA (marking it signed asks for a confirmation) and the extension's store page (an https URL) can be changed there; the other groups stay read-only until their own issue. A change takes effect within seconds in the web app and the worker, without a restart. An AI routing change, « Rétablir » included, is checked as the AI layer would build it and refused if wrong: a key or route missing, a personal-data task or the identity route reaching an endpoint outside the EU, or a model it newly names failing its **test call** (one request of a single token, or one search, no retry). A problem the configuration already had does not block it. The refusal is recorded in the Back Office Audit with its Failure Reason (`key_missing`, `route_missing`, `data_residency` or `test_failed`). Paramètres shows every one with its effective value, source and code default, and flags a value from the environment that differs from the default; it also shows, read-only, the bootstrap settings that only the environment holds (`DATABASE_URL` without its password, `AUTH_SECRET` and `SECRETS_MASTER_KEYS` only as set or missing, `APP_URL`, `ADMIN_EMAILS`, `JOBHUB_TARGET`, `AI_FAKE`, `MAIL_TRANSPORT`) and links the settings that have their own section (Plan Quotas, Guardrails, Coach Message Cost, Provider Secrets). Not a Provider Secret: its value is shown and recorded in the Back Office Audit.
_Avoid_: Config, env var, default, setting override

**Tool**:
An external service the application calls at runtime, from the web app or the worker: an AI model, web search, a job board API, the company register, a contact-enrichment provider, a source of Reference data or of Place suggestions, Stripe, Brevo or a Sign-in Provider. Each is registered in one catalog with its purpose, the keys it needs, where its calls are recorded and its data residency (in the EU, outside the EU, or not established), and the Platform Settings it depends on; a provider missing from the catalog fails the tests. The Back Office's Outils section shows each Tool's state (configured, key missing, setting missing, off, not configured), its Platform Settings read-only with their source (linked to Paramètres, flagged when one comes from the environment and differs from its default) and its last 30 days of calls, failures and cost, and its latest calls without any payload. Every external call is recorded, whatever the Tool (AI models, Stripe, Brevo emails, sign-in, connection tests of Provider Secrets, and the Job Site pages read, named by their domain only, under the Tool Job Site), and never carries an address, a Candidate, a URL, an answer or a secret. Super-admins and Support read it. Not a tool an AI model uses during a call (a web search it runs), which is only counted in AI Usage.
_Avoid_: Integration, connector, service

**Sign-in Provider**:
An identity provider, besides the magic link, that people sign in with: Google, Apple, Microsoft or a generic OIDC provider. Super-admins configure them in the Back Office's Connexion section; each is enabled only after a test sign-in, and is shown to Candidates, allowed for Administrators, or both. Trusted for linking, it signs a person into the existing account with the same email; otherwise they sign in by magic link first and link it from Mon compte. Its client secret (Apple: its Team ID, Key ID and .p8 key) is a Provider Secret.
_Avoid_: SSO provider, identity provider, social login, auth connector

**Require SSO for Administrators**:
A super-admin setting, off by default: the Back Office asks an Administrator signed in by magic link to sign in again with a Sign-in Provider allowed for Administrators. Their Candidate pages are unaffected, and `ADMIN_EMAILS` super-admins are exempt.
_Avoid_: Enforced SSO, mandatory SSO

**Back Office Audit**:
The record of every change an Administrator makes in the Back Office (roles, Plans, Plan Quotas, Coupons, Human Coaches, Coaching Playbooks, their Eval Cases, Core Digest and Sources, including validated, archived and restored, Guardrails, Provider Secrets, Platform Settings (changed or restored to default, with the value and its source, Back Office, environment or code default, before and after), Sign-in Providers, Job Sites, Job discovery sources and Job discovery sites): who, when, what and the values before and after; and of every AI Message Log a super-admin opens. Secret values are never recorded, only that they were replaced (possibly despite a failed connection test) or cleared. It also records every attempt that failed or was refused, with its Outcome and Failure Reason: a connection or sign-in test that failed, a save or validation refused by a business rule (a Playbook not validated, a Guardrail setting refused by its Eval Run, the last super-admin, Stripe refusing a Plan or Coupon, a Platform Setting value out of its bounds or of the wrong type), and an Administrator opening a section outside their Back Office Roles (action « Accès refusé », Failure Reason `role_missing`, target the page tried, at most once per Administrator, section and minute, in UTC; those sections can hold only such entries: Eval Runs, Coût coach, Consommation IA, Sites de recherche, Pages Outils, Paramètres, Journal; a visitor with no role is not recorded); a form field left empty or too long is only shown on the page. A refused attempt never keeps the values entered, only what was tried, on which target, and the field at fault. Kept for 3 years, then purged. Jobbbox's own record, so it survives the Administrator's account deletion (their id is cleared, their email at the time stays) and is not part of their data export.
_Avoid_: Audit log, history, activity feed

**Outcome**:
How an AI call or a Back Office action ended: ok (succeeded), warning (an AI call that worked while its feature ran degraded, such as a Task Playbook falling back to its built-in text, Redaction by shape alone or a Playbook Agent left out of a reply) or failed (an AI call that failed or was never sent, a Back Office attempt refused or failed). The Back Office Audit only uses succeeded and failed.
_Avoid_: Status, result code

**Failure Reason**:
Why something failed or warned, in two parts. The functional reason is a stable code from one catalog fixed in the code (`provider_unavailable`, `key_missing`, `data_residency`, `guardrail_timeout`, `invalid_verdict`, `provider_error`, `test_failed`, `eval_refused`, `last_super_admin`, `role_missing`, `invalid_value`, `stopped` (the Candidate stopped the action), …), each with a French wording an Administrator understands; the three Guardrail codes (`guardrail_timeout`, `invalid_verdict`, `provider_error`) are used only by a Guardrail Trigger that could not check, and `provider_error` there is the check's own failure, not the AI call's classification (that stays in the call's AI Usage entry); an unknown error is `other` (« Erreur inattendue »), and so is a failed or warned call recorded with no code or with a code no longer in the catalog. The technical reason is the error's class, the provider, the HTTP status and its message, scrubbed of keys and secrets, passed through Redaction and cut at 500 characters. The code goes where counts are kept (AI Usage, Guardrail Triggers, 24 months, Support reads them); the technical reason only goes with the text it explains (the AI Message Log, 30 days) or in the Back Office Audit (3 years), both read by super-admins only.
_Avoid_: Error message, error code, cause

**AI call warning**:
A degraded path of a feature recorded on the AI call it concerns, with a code from the Failure Reason catalog and a technical detail: a Task Playbook that fell back to its built-in text, was unreadable or lacked its section, a Playbook Agent or search not offered or left out, identity unavailable or undeclared to Redaction, job title variants or Company News unavailable, CV reading by fallback, a Tailored CV reply refused, a Match Score text unread or too slow. A call that worked with warnings has Outcome warning and its first warning as its reason; a failed call keeps its own reason and carries its warnings beside it. The codes go with AI Usage (24 months, counted per reason); the details stay with the AI Message Log (30 days, super-admins only). The Data export lists each warning's code and wording, never its detail. Paths with no call to carry them stay on the console.
_Avoid_: Console warning, degraded call

**Journal**:
The Back Office page where Administrators read the Back Office Audit, newest first, filterable by section and by Outcome (succeeded or failed). A failed entry shows its Failure Reason in French, its technical detail behind « Détail technique ». Those allowed to read the Tools also have the Outils section, which lists the Tools' calls beside the entries.
_Avoid_: Audit page, changelog

**AI Usage**:
What every AI call cost Jobbbox, whatever its task (not only AI Coach replies): when, task, provider, endpoint, model, input, output and cached input tokens, estimated cost in euros at list prices (the same prices as the Coach Message Cost), duration, Outcome (ok, warning or failed) and the Failure Reason's code, also for a call stopped before it was sent (missing configuration, data residency); with each tool its model used (a web search, priced per search) and every call to an external API (France Travail, the French company register, the job boards, contact enrichment: provider, operation, HTTP status, cost when known). No Candidate and no text: aggregates of no one, so outside the Data export and kept 24 months whatever happens to accounts. Super-admins and Support read it on the Back Office's Consommation IA page, per period, with failures and warnings counted per Failure Reason (also on Outils).
_Avoid_: AI bill, token log, metering

**AI Message Log**:
What one AI call said, as sent: its system text and messages after Redaction, and the reply as it came (none when the call failed, or was not sent), keys and secrets scrubbed, with the Candidate it was made for (none for a Guest), and the call's Outcome with its Failure Reason, technical detail included. Kept 30 days for quality and debugging, then purged; deleted with the account and in the Candidate's Data export. The Candidate's Data export holds each failed call's Failure Reason code and French wording, never its technical detail. Only super-admins read it, on the Back Office's Journaux IA page, filterable by Outcome and Failure Reason, and every log they open is written to the Back Office Audit.
_Avoid_: Prompt log, transcript, chat history

**Provenance**:
What served one piece of content a Candidate sees (a Job Search, a Job Offer's reading and summary, a Tailored CV or Tailored Document, a Company Dossier, a Master CV Version read from a file, an Action Card, a Job Digest, an AI Coach reply), fixed when it is made and kept with it: its steps, each with its Activity, its AI task or Tool, for an AI step the provider, where it ran (endpoint and region) and the model that actually served, tokens in and out, and its duration, start time and Outcome (stopped included); its Provenance sites; and its start time and wall-clock duration. No Candidate, no cost, no text. Lives and is deleted with its content, so it is in the Data export with it. Content made before it existed, or whose Provenance was not kept, shows « modèle non enregistré » and counts in no total; nothing is estimated. Not AI Usage, which counts calls for Jobbbox and names no one, and never linked to it.
_Avoid_: Metadata, trace, lineage, usage

**Provenance site**:
A site whose pages a piece of content was built from, kept in its Provenance with the links read: an offer page, a job board, the company register, the Candidate's own Master CV and Profile. Shown to the Candidate under « Sources »; a link never points to a LinkedIn profile, a page naming a person, an Enriched Contact, an address inside Jobbbox other than the Candidate's own pages, a signed or tokenised address or a query string. Not a coaching Source (`[S12]`).
_Avoid_: Source (alone), citation, reference

**Activity**:
What one step of an AI action is doing, fixed in the code per step and by default per AI task or Tool, never per Playbook: think, think then write, write, search, web search, read or compute (rules, no AI). It picks the glyph AI Activity shows while the step runs.
_Avoid_: Status, phase, stage

**AI Activity**:
The button in the Candidate's top bar, left of « Mon coach », and the pane it opens, « Cette page »: which models (with tokens and time), Provenance sites and Tools produced what the page shows, summed for the page and listed per element, read from each element's Provenance; the AI Coach replies given while the page's object was in view count with the page. While an AI action of the Candidate runs (on this page or « En cours ailleurs »), it shows each step live with its Activity's glyph and a stop icon; a stopped or failed action is shown in light red, in words, with its finished steps. Never in the Back Office, never cost, prompts, the Playbook Agent, Back Office settings or internal identifiers; tokens are labelled a technical measure, not counted against Plan Quotas, and never appear in the Usage Meter. Models are named for people (« Claude Opus 5 »), with where they ran (« AWS Bedrock · UE ») and the EU AI Consent or outside-the-EU route when that served the call; providers are named in text, with a logo only where its owner allowed it in writing.
_Avoid_: Session pane, sources bar, tasks panel

**Guardrail Trigger**:
One time a Guardrail blocked, flagged or could not check a message or reply: which Guardrail, its setting, what it did, for which agent, and when; when it could not check, why, as a Failure Reason code only (timeout, a verdict that was not valid, the provider's error). No Candidate, no Coach Conversation and no text: aggregates of no one, so outside the Data export and kept 24 months. Super-admins and Support read them per day in the Back Office; the text, if needed, is in the AI Message Log. No one is alerted when a Candidate expresses distress.
_Avoid_: Guardrail log, incident, alert

**Back Office Assistant**:
The AI Coach panel shown to Administrators in the Back Office. Answers questions about Back Office data and settings within the asking Administrator's Back Office Roles; read-only, never sees Provider Secrets nor email addresses. Its conversations are the Administrator's own, kept apart from Coach Conversations and counted against no Plan Quota: kept 12 months after their last message, deleted with the account, in their Data export.
_Avoid_: Admin bot, admin copilot

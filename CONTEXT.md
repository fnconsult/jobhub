# Jobbbox

A coaching platform that helps senior job seekers (40+) in France land a job: it builds their candidate positioning, finds and analyses job offers, prepares tailored application material and follows up on applications.

## Language

### People

**Candidate**:
A person with an account who is looking for a job. Owns one or more Profiles.
_Avoid_: User (in domain discussions), applicant, job seeker

**Account deletion**:
The Candidate deletes their own account, confirmed by typing their email address. It takes effect at once and ends any paid subscription first. Everything tied to the Candidate goes, their Private Job Offers included; shared Job Offers stay.
_Avoid_: Account closure, deactivation

**Data export**:
One JSON file the Candidate downloads holding all their personal data, what they made and what Jobbbox worked out or obtained about them (GDPR art. 15 and 20): their account (sign-in methods and sessions), Plan and Plan Quota use, EU AI Consent, Follow-up Delays and Appointment Reminder setting; their Private Job Offers; their Profiles (Search Criteria, every Master CV Version, ATS Score, Job Searches, Job Digest settings and the Job Digests sent); their Applications (Job Offer, Interviews with their Reschedule history, Match Score, Tailored Documents, Follow-ups sent, Coach Reviews, Enriched Contacts, Company Dossier); their Coach Conversations with every message, the Provenance of each of these results, Coach Memory, Action Cards, Coach Access and Coaching Sessions (with their date, who last changed it, video link and Reschedule history); their AI Message Log; their Signalements (with their context, status and the team's reply with when it was saved and last changed, never which Administrator changed the status or replied, nor when their Signalement notification was closed). It leaves out secrets (sign-in tokens and passwords, the Job Digest unsubscribe link), Human Coaches' email addresses and booking links, Stripe's and the contact data providers' identifiers, and the Coach Message Cost. Every table tied to a Candidate must land in it.
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

**Visitor**:
A person reading Jobbbox's public site without being signed in: the Help Centre, the legal texts, Nouveautés. Leaves no CV and no Job Offer. The role follows the surface and the sign-in, not the person: the same person is a Guest in the extension and a Visitor on the site, and a signed-out Candidate is a Visitor.
_Avoid_: Anonymous user, prospect, lead, Guest (for someone on the site)

### Coaching

**AI Coach**:
The AI agent persona that guides the Candidate through onboarding, CV improvement, job search, application preparation and follow-up. It always says it is an AI and not a person (AI Act art. 50(1)): a fixed first message in every Coach Conversation, a « Coach IA » badge by the message box, and a truthful answer when asked. Its replies show no author name; each is followed by its Provenance.
_Avoid_: Bot, assistant, agent (in user-facing language)

**AI disclosure**:
The AI Coach's fixed first message in a new Coach Conversation, saying it is an AI and not a person and that a Human Coach can be booked. Shown at the top of the conversation, not sent by the AI Coach: no AI call, no Plan Quota use, no Coach Message Cost, and not in the Coach context. A Coach Conversation made before it was introduced has none.
_Avoid_: Welcome message

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
The side panel where an Administrator talks with the Back Office Assistant. Retired from the Candidate's pages by the conversation-first design (ADR-0070): there the conversation is the page (see Coach Conversation, Fiche, Work Pane), and « Aide et coach » is gone from the Top Bar.
_Avoid_: Chat, chatbot, sidebar, help menu

**Coach context**:
What the AI Coach is told before each reply: always the Candidate summary and the Coach Memory, plus the item In view, plus summaries of the rest (onboarding answers, latest Applications, top Job Offers, the next three Agenda Items from now on, none of them cancelled), within a size cap. Summaries are trimmed before the item In view.

**Candidate summary**:
The Candidate's first name and, for each active Profile, its target role, Search Criteria and seniority (from years of experience). Never the rest of the Identity block.

**Coach Conversation**:
A saved conversation between a Candidate and the AI Coach, and on the Candidate's pages the page itself (ADR-0070), with its box at the foot. Each has a Subject. An object or a Sidebar menu has at most one, created at its first message; until then the page shows the Introduction and suggestions. A Free conversation is attached to the active Profile and can be named. « Effacer », after a confirming Dialog, deletes every message of an object's or menu's conversation (the object and Coach Memory stay), and a Free conversation itself: the page becomes a new conversation and the Sidebar stops listing it. An archived object keeps its conversation; a deleted one takes it along. An object's conversation is attached to that object's Profile, a menu's to none. Kept 12 months after its last message, then purged; deleted with the account. Human Coaches never see it. In the Data export with every message and its Subject, without the Coach Message Cost.
_Avoid_: Chat, thread, session

**Subject**:
What a Coach Conversation is about, fixed when it starts: one object (an Application, a Profile, a Job Search or a Job Digest), one Sidebar menu (Mes candidatures, Recherches d'offres, Job Digests, Agenda, Mes coachs humains; one conversation per Candidate each), or none for a Free conversation. A Job Offer's page starts a Free conversation with the Job Offer In view.
_Avoid_: Focus (that is per reply), owner, topic

**Introduction**:
The first message of a conversation page, shown until the Candidate sends one: the AI disclosure, the page's own text and, while it applies, the note that the page is under construction.

**Free conversation**:
A Coach Conversation with no object or menu as its Subject, started from « Nouvelle conversation » or « Coach » in the Sidebar, where it is listed. The home page is a new Free conversation.
_Avoid_: General chat, scratch conversation

**Coach Memory**:
The key facts (goals, constraints, decisions) the AI Coach keeps about a Candidate across Coach Conversations. The AI Coach proposes them from a Coach Conversation; an item is saved only once the Candidate confirms it, one by one. The Candidate sees, edits and deletes items from « Mémoire du coach » under « Coach » in the Sidebar, opened in the Work Pane. At most 30 items of 300 characters each. Sent with every AI Coach message. Kept when a Coach Conversation is deleted; deleted with the account. Human Coaches never see it. In the Data export.
_Avoid_: Profile notes, chat history

**Coach Message Cost**:
What one AI Coach reply cost, the Playbook Agent choice, every Playbook Agent consulted and Guardrail checks included: provider, model, input, output and cached input tokens, and the estimated cost in euros at list prices, fixed when the reply is saved. Kept with the reply, so it goes when the Coach Conversation does. Its euros are seen by Administrators only, as a median and p90 per day, never by Candidates; the Candidate sees only the reply's Provenance (model, tokens, time).
_Avoid_: Bill, price

**Coach cost target**:
EUR 0.03 per AI Coach reply, judged on the daily median and p90 of the Coach Message Cost.

**Cached input**:
Input tokens the AI provider reads from its prompt cache rather than processing again; priced apart from the rest of the input.

**In view**:
The Profile, Application, Job Offer, Job Search or Job Digest the page the Candidate is on shows, or, on the Agenda, the Agenda Items of the next 30 days. The Coach Conversation and AI Coach use it as context, and only if it belongs to the Candidate.
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
A named check on a Candidate's or Administrator's message to the AI Coach or Back Office Assistant (input), or on the reply of the AI Coach, a Playbook Agent or the Back Office Assistant (output), that lets it through, blocks it or flags it, by fixed rules or by asking an AI model (any configured provider, every call redacted). It guards against direct and indirect prompt injection, personal data leaks, disclosure of prompts, Coaching Playbook rules or secrets, out-of-scope or harmful advice, and distress. The set of Guardrails is fixed in code; Administrators only tune each one in the Back Office. A new setting is saved only once the Guardrail's Eval Cases have been played on it, and is refused if it lets through a case that the distress, personal data leak or secret disclosure Guardrail must block; those three can never be switched off. Other AI tasks keep their own rules and have no Guardrails, except Email intake's reading of an email: its input goes through the « Contenu piégé dans un email » Guardrail (tunable, can be switched off) and its output through fixed rules that are always on (no email, phone or person's name from the email, each link found in the email, at most 30 offers) (ADR-0052). Content the Candidate did not write (a Job Offer, a Company Dossier, a CV) always reaches the AI Coach and Playbook Agents marked as data, never as instructions; a Playbook Agent's reply reaches the AI Coach the same way. Only the final reply is checked on output, not each Playbook Agent's. When the AI model cannot be reached, the message or reply goes through and the fixed rules still apply; distress words always bring the distress Guardrail message. The Back Office Assistant has only the prompt injection, personal data leak and secret disclosure Guardrails.
_Avoid_: Filter, moderation, safety layer

**Blocked message**:
A Candidate message a Guardrail stops before the AI Coach sees it, or an AI Coach reply a Guardrail stops before the Candidate does. A blocked message is answered by the Guardrail message; a blocked reply is written again once, told what was wrong, then replaced by the Guardrail message if still blocked (a leak or a secret is replaced at once). Both stay in the Coach Conversation, marked as blocked without naming the Guardrail; a distress Guardrail's answer is never shown as a block. A Guardrail set to flag only lets everything through and records it. A question the Candidate stops before the input Guardrails let it through is not blocked, and stays in the Coach Conversation unmarked, but is never sent to the AI Coach; a check the Stop ends records no Guardrail Trigger.
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

**Private Job Offer**:
A Job Offer only one Candidate can see, read, keep as an Application or find in their Job Searches, Job Digests and Coach context (ADR-0049). It never merges with a shared Job Offer nor with another Candidate's, even from the same URL; with no signed-in reader (a Guest, a pasted Job Offer link, Job discovery) only shared Job Offers are seen. Deleted with its Candidate's account; part of their Data export.
_Avoid_: Personal offer, confidential offer

**Job Offer Summary**:
Two or three sentences on a Job Offer (the role, its scope, what is expected), written by the AI from the offer's own text and in its language, inventing nothing, as its Task Playbook says. Shown, labelled as written by the AI, at the top of the Application's page. None is written, nor the sector, while that Task Playbook has no version served (in production: none Human-validated).
_Avoid_: Abstract, description

**Capture**:
The act of the browser extension turning the job page the person is viewing into a Job Offer, either detected automatically or triggered manually.
_Avoid_: Scrape, import, clip

**Job Offer link**:
A link to one job posting the Candidate pastes in a Coach Conversation message. Once the Guardrails let the message through, Jobbbox reads the page the way Job discovery reads one (robots rules, as itself, giving up at bot protection or a sign-in), takes its JobPosting data or has the AI read its text as data, and stores it as a Job Offer like a Capture. The AI Coach answers with a set reply and a Job Offer card instead of its own reply. A Forbidden site is never read: the reply sends the Candidate to the extension, as it does for a page that cannot be read.
_Avoid_: URL import, scrape

**Job Offer card**:
The card in an AI Coach reply to a Job Offer link: the Job Offer's title and employer and a link to its page. "À traiter" until the Candidate follows it (saves it as an Application), which gives it its Match Score and At a glance; then "Suivie". Not an Action Card: nothing is accepted or dismissed. Saved with the Coach Conversation; never given to the AI Coach.
_Avoid_: Action Card, preview, link card

**Job Offer result**:
A Job Offer in a list of Job Offers (a Job Search, a Job Digest, « Reçues par email »): its title, employer, contract and remote work, its Match Score and the actions to save it as an Application or read it. Not the Job Offer card, which is the AI Coach's.
_Avoid_: Job Offer card, result card

**Quick actions**:
The suggestions above the box of the home page's empty conversation that start the usual next steps: search for Job Offers, add an Application, plan an Interview, ask how the page works.
_Avoid_: shortcuts

**Job discovery**:
The AI Coach's search of the web for Job Offers matching a Profile's Search Criteria. Contrast with Capture, which starts from a page the person is viewing. Its web searches go through the active Search provider, or its fallback for the rest of a run when the active one fails; a run also visits the Profile's Target Companies.
_Avoid_: Scraping, crawling (alone)

**Listing page**:
A result page that lists several postings (a job board's search results, a careers site's openings) rather than describing one. Job discovery reads up to 5 of its postings on the same site, each checked like any result page. It is never a Job Offer itself.
_Avoid_: Results page, index page

**Job Search**:
One run of Job discovery that a Candidate starts for a Profile, and its outcome: searching, done, failed or stopped. Started from the Recherches d'offres page, for one Profile or for all their active Profiles at once (one Job Search each); the Coach Conversation and "Relancer une recherche" on a Job Search's page start one for a single Profile. A Profile's page does not offer it. With several locations it searches each of them within the one Job discovery budget. It counts one against the Plan Quota, and the use is given back if the search fails, times out or is stopped without keeping a Job Offer. The Candidate can stop it from its page or from AI Activity (a Stop request); a stopped or failed search keeps, and links, the Job Offers it had already found. A search nobody has finished after 15 minutes is failed. Its page shows the Match Scores against the Profile's current Search Criteria; a Job Search keeps no copy of the criteria it was run with.
_Avoid_: Search (alone, ambiguous with Search Criteria)

**Stop request**:
The Candidate's request to stop a searching Job Search. The worker applies it between steps (within about a second; an AI call in flight is cancelled, a page already being read is finished), then records the Job Search as stopped. A Job Search stopped before the worker picked it up runs nothing. Only the Candidate who owns the Job Search can make one, and only while it is searching.

**Job Search Notification**:
A message shown on every workspace page when a Job Search stops being searching: how many published Job Offers it found, or, for a stopped search, when it was stopped (and that it does not count toward the Plan Quota when it kept none), or, for a failed one, when and during which step it failed, why, and the Job Offers it kept. Times are Paris time. In-app only, no email. It stays until the Candidate closes it or opens that Job Search, and is hidden on that Job Search's own page.
_Avoid_: Alert, toast, Action Card

**Search provider**:
A web search Tool that returns pages for a query, with their dates when it knows them, and never writes text: Perplexity (its Search API), Brave or Tavily. It receives only queries built from Search Criteria or an employer's name. One is active for web search (the `web_search` route), another may be its **Fallback Search provider** (none by default, never the active one; a run switches to it for its remainder on a failure and records the switch in the Discovery metrics), and a search Task Playbook may name its own. Every Search provider has the same **Search contract**: queries per call, pages, and for each filter whether the provider sends it (handled) or the adapter applies it to the returned pages (emulated). It honours the same filters (included and excluded domains, country, maximum age, number of results), applying itself those it lacks on the pages it returns. Without the key of the active one, web search is unavailable (Failure Reason `key_missing`): Job discovery skips it like a disabled source, and a foreign employer's Company Dossier is refused, while a French employer's is still built from the register with no Company News.
_Avoid_: Search engine, search LLM, web search tool

**Careers site**:
Where a Target Company publishes its postings: its careers page or an ATS board (Greenhouse, Lever, Ashby, Welcome to the Jungle). Found once, from the web results for the job and the company, and kept for the company so every Profile reuses it; public facts only, tied to no Candidate (ADR-0046).
_Avoid_: Career page

**Target Company**:
A company Job discovery aims at for one Profile (« Entreprise cible »): one La Bonne Boite gives as likely to hire for the Profile's job and area, or one the Candidate adds by name. Job discovery reads its careers site or ATS when one is known, else searches the web for the job title and its name, once the company register lists it as a company: a sole trader's name, a private person's, is never searched (ADR-0007), and one the register says is not a company is no longer visited; at most 5 per run, the Candidate's own first, then by hiring score, none visited again within 7 days. The Candidate sees them on the Profile, can open their Company Dossier, look for Enriched Contacts, prepare a spontaneous application, or set one aside for good. Part of the Candidate's Data export.
_Avoid_: Prospect, lead, high-potential company

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
How the France Travail search went in one run, part of the Discovery metrics: off (not configured), searched, refused (access withdrawn, credentials rejected, or the Offres d'emploi scope refused by `invalid_scope`) or failed (any other error).

**France Travail API access**:
The state of each France Travail API (La Bonne Boite, Offres d'emploi, ROMEO) from the latest connection test of its Provider Secret: ok, accès refusé or erreur. Each API is asked for its own token with only its own scopes (ADR-0044). Holds no secret and no Candidate data; deleted when the key is cleared. Shown on France Travail's sheet in Paramètres (formerly the Clés page); an Offres d'emploi refusal puts the France Travail source and Tool in « En attente d'accès ».

**Fantastic.jobs search**:
The source of a Job discovery run after the France Travail search when Fantastic.jobs' key is set: its `active-ats` API, the postings of employers' own career pages (their ATS), searched once a run by the Search Criteria title and first location, even when they name several. Each Job Offer is captured at its ATS page and dated by its posting, so it deduplicates with those already stored. Its Job Offers count toward the Job discovery budget; when they fill it, the web search is skipped. Every job returned is charged, so one search asks for no more than a set maximum (10 by default) and none once a quota is spent, until it is renewed (ADR-0031). A refusal is a normal outcome, never a failed run.
_Avoid_: Fantastic.jobs feed, job board search

**Fantastic.jobs status**:
How the Fantastic.jobs search went in one run, part of the Discovery metrics with its calls, Job Offers kept and estimated cost: off (no key or the source disabled), searched, refused (key rejected, or its Jobs credits or API requests spent) or failed (any other error).

**ROME code**:
France Travail's code for a job, derived from the Search Criteria title; a title naming no known job is searched by keywords instead.

**Discovery metrics**:
What one run of Job discovery (a Job Search or a Job Digest top-up) measured: how many Job Offers each step kept (provider URLs, pages read, Job Offers extracted, already stored, left after deduplication, with a Match Score of 60 or more), the pages skipped by Skip reason, and the estimated cost in euros. Costs are estimates from list prices, not billed amounts. Duration is the Candidate's wait (start to outcome) for a Job Search, and the worker's run time for a Job Digest.

**Discovery run**:
One run of Job discovery (a Job Search or a Job Digest top-up) as the Back Office's Recherches tab lists it, failed and stopped ones included: its Discovery metrics, its web searches (kind: plan, Target Company or site) with the query texts they actually sent, how many **new Job Offers** it stored for the first time, and its **Stop reason**. Its figures name no one and are kept 24 months; its Profile pseudonym, Search Criteria, query texts and link to the Job Search are kept 30 days, are part of the Candidate's Data export and go with their account or Profile (ADR-0047). A failure to record a run never stops the Job Search or Job Digest.

**Stop reason**:
Why a Discovery run ended, one of six: Job Offer limit, spend, duration (the first limit of the whole Job discovery budget it reached), searches done, stopped by the Candidate, or failed. Shown on the Back Office Dashboard and in Activité.

**Profile pseudonym**:
A Discovery run's label for a Profile, « Profil # » and 4 characters taken from a hash of the Profile's id: the same on every run of that Profile, never naming the Candidate. Gone with the other 30-day details, when the row reads « Effacé après 30 jours ».

**Run cost item**:
Where a Discovery run's cost went: page reading, plan, web search or Target Companies (everything spent while visiting the Target Companies). Kept in its Discovery metrics; the Back Office Dashboard averages it.

**New Job Offer (of a run)**:
A Job Offer a Discovery run stored for the first time; the Dashboard's cost per new Job Offer divides the runs' cost by them.

**Skip reason**:
Why a result page gave no Job Offer (for example a Forbidden site, robots.txt, an unreadable page, a closed posting, a posting too old, or a disabled Job discovery site).

**Job discovery source**:
Where Job discovery finds Job Offers: the France Travail search, the Fantastic.jobs search, the web search, the public APIs of the ATS postings are read through (Greenhouse, Lever, Ashby), or Email intake, the one fed by the Candidate's mail rather than by a run. Administrators enable or disable each on the Sources tab of Paramètres; a disabled one is skipped by Job Searches and Job Digest top-ups (France Travail or Fantastic.jobs then counts as off, and an ATS posting is read from its page). All are enabled when the Back Office cannot be read.
_Avoid_: Provider (alone), channel

**Email intake**:
The Job discovery source that turns the offer emails a Candidate receives in a Linked mailbox (job-board alerts, a careers site's alerts, a recruiter's message) into Job Offers, as they arrive rather than during a run: outside the Job discovery budget, counted against no Plan Quota, capped per Linked mailbox per day. An offer already there for the Candidate (from a Job Search, a Job Digest, an earlier email or an Application) is not shown again and counts as already seen. Each other Job Offer goes to the Profile whose Match Score for it is highest (rules, no AI), or to « Non classées » under 60, and shows in that Profile's « Reçues par email » section on the Recherches d'offres page (newest first, scored against the Profile, with the count of « nouvelles » that arrived this week, counted from Monday 00:00 Paris time like Plan Quotas) and in its Job Digest (taken by when the email was read, however long ago the Job Offer was stored); it starts no Job Search and no Job Search Notification. The page also lists « Non classées », the emails ignored this week (other, unrecognised sender, guardrail, failed: reason, sender's domain and date, never content) and a « Filtre trop large » notice, linking to the setup wizard, when on any day this week (Paris time) at least `EMAIL_INTAKE_BROAD_FILTER_THRESHOLD` emails arrived (Gmail's confirmation not counted). Its Posting date is the email's date unless the offer states one. An offer from a recruiter's message is private to that Candidate (ADR-0049); one from an alert is shared and deduplicated like any Job Offer. An alert offer that links to a Forbidden site makes no Job Offer: it is listed « À capturer », inviting the Candidate to open it and use Capture. Administrators enable or disable it on the Sources tab of Paramètres (on by default; the switch is recorded in the Back Office Audit), and the Email intake sheet opens from that tab. While it is off, every email that arrives is discarded unread, with no Received offer email row and nothing queued (ADR-0060). Each Received offer email is listed, without its content and naming no Candidate (kept 24 months), on the « Emails reçus » tab of the Back Office's Activité (Administrators, Support and Technique), and each Linked mailbox event in the Journal's « Boîtes reliées » filter.
_Avoid_: Email import, mail scraping, inbox source

**Recognised sender**:
A sender of offer emails whose emails Email intake reads (« Expéditeur reconnu »): a job board's or a careers site's alert address, recognised by its authenticated domain, or by its full address when the domain sends for many (a shared sending platform such as `jobs2web.com`). Administrators keep the platform's list on the Email intake sheet of Paramètres, each with a label naming the job board or company and its site for reading only; they can disable one (it stays listed but is not read) or remove it, and each change is recorded in the Back Office Audit (section « Expéditeurs reconnus »). A Candidate can add one for themselves alone, from an email set aside as unrecognised or by pasting the address in the setup wizard; it then counts from their next email, and is proposed to Administrators (domain and number of Candidates, no names), who alone add it to the platform's list. The Email intake sheet lists them under « Expéditeurs proposés » (Proposed senders). A Candidate's own sender is kept by the domain of its « De : » address, or by the full address on a shared sending platform (the fixed list `jobs2web.com`, `mjt.lu`, `sendgrid.net`; pasting only the platform's domain is refused); it is recognised only when it passes DMARC, up to 50 per Candidate, and one the platform list already reads is refused as « already recognised ». A Candidate can also add a sender Administrators disabled (read for them alone) and switch a platform sender off for themselves only (and back on); that choice goes in their Data export. Nothing a Candidate does changes what another Candidate's emails read.
_Avoid_: Whitelist, allowed sender, trusted source

**Email intake MTA**:
Jobbbox's own receiving server for Email intake (« MTA Jobbbox », Tool `email-intake`): one for every environment, it accepts mail only for the Email intake domains of its Routes, checks SPF, DKIM and DMARC, and hands each email to the right environment's app without keeping it (ADR-0069).
_Avoid_: Mail server, inbound parser

**Route**:
One Email intake domain mapped to one environment's app and its shared secret, in the Email intake MTA's configuration. A recipient on any other domain is refused.

**MTA stamp**:
The Authentication-Results the Email intake MTA writes on each email it passes on: the only authentication Email intake trusts. One found inside the message itself is ignored.

**Linked mailbox**:
A Candidate's own mailbox Jobbbox reads for Email intake (« Boîte reliée »): reached either by connecting it, or by the Candidate forwarding its offer emails to their Forwarding address. The Candidate can unlink it at any time.
_Avoid_: Inbox, email account, mail connector

**Forwarding address**:
The address Jobbbox gives one Candidate (« Adresse de transfert ») to which they forward offer emails, by hand or by a filter in their own mailbox. It makes a Linked mailbox without Jobbbox holding any password or access; the Candidate can replace it with a new one, or switch Email intake off: the old address then stops at once, and what reaches it is discarded unread. Switching it on is recorded with its date (ADR-0051).
_Avoid_: Alias, inbound address

**Forwarding setup wizard**:
The steps (« Assistant de transfert ») that take a Candidate from choosing their mailbox (Gmail, Outlook.com, iCloud, Orange or other) to forwarding to their Forwarding address: switch Email intake on, copy the address, follow that mailbox's guide, then wait for the first email, which ends it. For Gmail it shows the **Gmail forwarding confirmation code** from Google's confirmation email, with its link as a fallback since Google documents no fixed format. The **first email** is any email that reached the address in use since it was given, except Gmail's confirmation, even from an unrecognised sender: it proves forwarding works. Outlook.com and iCloud guides carry a notice that their steps are unconfirmed; Orange and other mailboxes get the manual forwarding guide only, until automatic forwarding is tested on real accounts.
_Avoid_: Onboarding, setup flow

**Received offer email**:
One email Email intake took from a Linked mailbox, its kind (alerte, recruteur or autre) and its outcome: offers found, « autre » (not an offer: a newsletter, a profile view, an application's news; an alert with no precise offer is « autre » but keeps its kind), « échec » (read and tried again twice, 10 minutes apart; the third failure, or any try after 72 hours, records it), set aside as from an unrecognised sender (discarded unread), set aside as « plafond atteint » (the Linked mailbox's daily cap was already reached: discarded unread, not queued), or set aside by a Guardrail. When it arrives, an email waits as « en attente de lecture » with its text kept encrypted until read; Gmail's forwarding confirmation is kept the same way for the setup wizard, and counts against no cap. The cap's day is the Paris calendar day; an email to a Forwarding address no longer in use is dropped with no row. Each offer in an email is listed with how it turned out: new (with its Profile, or none, and its Match Score; a Match Score under 60 files it under « Non classées »), « déjà vue » (already one of the Candidate's Applications, Job Searches, Job Digests or earlier emails), « À capturer » (it links to a Forbidden site, so no Job Offer; an email whose offers all do counts as offers found) or too old (stated or email date over 30 days ago, no Job Offer). Only an email from a Recognised sender, or one the Candidate forwarded by hand from one of their own addresses, is read, and only its text: never its headers, images or attachments. Its text is never kept once read (on a failure, at most 72 hours, encrypted, to try again); Received offer emails are kept 12 months; what is kept is the outcome, the sender's domain and the Job Offers it gave, whose Provenance has its steps (reading the email with the Email intake Tool, the AI step that read the offers, deduplication and Match Score by rules) and the sender's domain as a Provenance site.
_Avoid_: Imported email, parsed email

**Linked mailbox event**:
What happens to a Linked mailbox's Email intake, kept without naming the Candidate for 24 months: switched on, replaced (the Forwarding address), switched off, or « plafond atteint » (the daily cap reached: once per Linked mailbox per Paris day, at the first email set aside). Shown in the Journal's « Boîtes reliées » filter, and counted « Réussi » there. Like a Received offer email's row in Activité, it survives the Candidate's deletion and is not in their Data export (ADR-0059).
_Avoid_: Mailbox log

**Job discovery site**:
A domain Administrators list in the Back Office for Job discovery. While enabled, it is searched on purpose: one web search of the run, the plan's first Job Search query, restricted to it. While disabled, a result page on it (or a subdomain) is skipped. Never a Forbidden site. Removing one never removes a Job Offer found on it.
_Avoid_: Source (alone), whitelist, blacklist

**Job Site**:
A site where the browser extension shows its "Analyser cette offre" badge, as a match pattern (e.g. `https://*.gestmax.fr/*`), optionally with the pattern of its posting pages. Built-in Job Sites are in the extension's manifest and can only be disabled; Administrators add others in the Back Office, where they get the badge only for people who allowed the extension on every site. A disabled Job Site gets no badge, but Capture from the Side Panel still works there. The extension reads the list from the web app, keeping the last one read, or its built-in Job Sites before any.
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

**Sending address**:
One of the Candidate's own email addresses, from which an email they forward by hand is read as theirs: their account's, always, plus up to 10 they add. Not the Forwarding address, which is the one jobbbox gives them to forward to; a Forwarding address that is replaced or switched off is kept, so it is never given to anyone again.
_Avoid_: Sender, from address

**Company Dossier**:
The research compiled about the employer behind a Job Offer from public data only: legal identity, address, financials and Suggested Contact Roles. Built from the French company register for a French employer; for a foreign one, from the pages the Search provider returns for the employer's name, whose facts the company-facts Task Playbook's agent reads, and marked less reliable. Never names a private person. Built only for a confirmed employer, and refused when the employer is not a company (e.g. a sole trader), in which case the Candidate is asked to name the hiring company. Holds the employer's Company News. Keeps the Provenance of every step of its build (the offer read, the register, the web and news searches); a dossier built after the Candidate confirms a Presumed Employer joins the reading that presumed it.
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
The menu down the side of the Candidate's pages: Profile switcher, « Nouvelle conversation », « Coach » with the Free conversations and « Mémoire du coach », then links to their pages, each a Coach Conversation that unfolds into its 5 to 10 most recent objects and « Tout voir »; at its foot the Usage Meter, Mon compte and signing out. The Candidate can hide it, and the choice is remembered in that browser. On narrow screens it becomes a drawer opened from the Top Bar's Menu button.
_Avoid_: Navigation bar, workspace header

**Fiche**:
The column beside an object's Coach Conversation that shows the object: its card, then three groups the Candidate can fold, its Sections, its Activity (AI Activity and the Context bar) and its Results. Opened and closed only by the Top Bar's « Fiche » (« Activité » opens it on its Activity); never over the conversation.
_Avoid_: Details panel, sidebar, record pane

**Work Pane**:
The column beside a Coach Conversation where one item opens to be acted on: a Result (shown in the Viewer when it is a document), a Section, a Help Article or a form (a Signalement, an Interview…). One item at a time, with its actions in its header (modify, download, send, stop, « Demander au coach ») and its ✕ to close it; never over the conversation. On phones it takes the whole screen.
_Avoid_: Drawer (Back Office and the Sidebar on phones), document pane, modal

**Result**:
What an AI action of the Candidate produced and kept with its object: a Tailored CV, a Cover Letter, an Outreach or Follow-up message, an interview preparation. Listed in the Fiche's Results and in the reply that produced it; opened in the Work Pane.
_Avoid_: Output, artefact, deliverable

**Context bar**:
The bar in Activity showing how much of a Coach Conversation the AI Coach reads: its messages out of the 40 it reads and the jetons of its context out of the ceiling. From 80 % it says that the AI Coach reads only the latest messages and offers « Effacer la conversation ».
_Avoid_: Memory gauge, quota bar (that is the Usage Meter)

**Top Bar**:
The bar above every page beside the Sidebar: the page's title, the Menu button when the Sidebar is hidden, and on the Candidate's pages « Fiche » and « Activité », which alone open and close those columns beside the conversation, and « Effacer » for the page's Coach Conversation; a page without a conversation (Mon compte) has « Aide », which opens its Help Article in the Work Pane. Nothing else for help or Signalements goes there.
_Avoid_: Header, navbar

**Section**:
One part of a long page, with its own address: Mon compte's Profils, Abonnement, Relances, Rappels, Mes signalements or Mes données, a Profile's or an Application's parts, a Back Office section. An object's Sections are listed in its Fiche and each opens in the Work Pane (ADR-0070). On wide screens a page's Sections are listed beside it, or in the Sidebar in place of its links when the page has no room (the main menu one arrow away); on phones the list is the page and each Section opens as a drawer, its title in the Top Bar leading back to the list.
_Avoid_: Tab, sub-page, panel

**Design System**:
The one set of colours, type, spacing and components every Jobbbox surface is drawn with: the Candidate's pages, the Back Office, the extension's Side Panel and the emails. It has a light and a dark theme and two Densities. Its look follows Mercury's; its finish follows the Paramètres prototype.
_Avoid_: Theme, style guide, UI kit

**Density**:
How tightly a surface of the Design System is set. Confort on the Candidate's pages, the extension and the emails, with the 16 px body-text floor and the Text Size. Compact in the Back Office, for Administrators, with smaller text and tighter rows. Never chosen by the person. A Density applies to the part of a page that declares it (the Back Office's whole page is Compact), while the Text Size still scales from the page's root.
_Avoid_: Compact mode, zoom

**Email layout**:
The one frame every email Jobbbox sends is written in (« Mise en page des emails »): a header (the « Jobbbox » wordmark), a title, text, Job Offer cards and at most one primary button, the signature, and a footer giving the reason the person got the email, an unsubscribe or settings link where there is one, and the sender address. It follows the Confort Density and carries no image and no web font. The plain-text part and the HTML part say the same thing.
_Avoid_: Email template, newsletter design

**Design System page**:
The Back Office page, under Plateforme, that shows every component and colour of the Design System, in both Densities and both themes, as the reference that screens are checked against. Every Back Office Role can read it.
_Avoid_: Storybook, style guide

**Back Office page in the Design System**:
A Back Office section already drawn in the Compact Density look of the Design System (tabs, tables, status dots, cards, filters, side panels); every section now is, each row's own page included.
_Avoid_: Redesigned page, new theme

**Properties**:
The Design System's read-only list of terms and values, for what a page shows without letting the person edit it.
_Avoid_: Definition list, key-value table

**FilterLinks**:
The Design System's filters that live in the page's address, drawn as chips, so a filtered view can be shared and reloaded.
_Avoid_: Filter bar, tabs

**Drawer**:
The Design System's panel that slides in from the side over the page, for anything the person fills in or reads in detail in the Back Office, and for the Sidebar's menu on phones. On the Candidate's pages a form opens in the Work Pane instead (ADR-0070). It holds focus while open and « Fermer » or Escape returns focus to what opened it.
_Avoid_: Modal, popup, dialog (a Dialog only confirms)

**ConfirmDialog**:
The Design System's small centred box that asks the person to confirm or cancel one action before it happens, with focus starting on « Annuler ». Forms never use it; they open in a Drawer.
_Avoid_: Modal, popup, confirmation page

**Toast**:
The Design System's short message that appears briefly at the screen's edge to say an action worked or failed, without moving focus. Not a place for text the person must act on.
_Avoid_: Alert, snackbar, banner

**File upload**:
The Design System's component for sending a file: a drop zone, the chosen file's row (name, size, remove), the steps while it is read with « Arrêter », and its errors. A file over 10 MB or of another format is refused as soon as it is chosen; the server still decides.
_Avoid_: Dropzone, uploader

**Viewer** (PDF / DOCX Viewer):
The Design System's component that shows a document's pages as paper, with page thumbnails, « Page x sur y », zoom, « Ajuster » and « Télécharger ». A Word document is shown through the PDF drawn from the same content.
_Avoid_: Preview, reader

**Document aside**:
The column beside a Tailored Document on « Documents adaptés »: its Job Offer, the Match Score of a Tailored CV, the note of what changed from the Master CV, the PDF and Word downloads and the saved date.
_Avoid_: Side Panel (the extension's pane)

**Components page**:
The page at `/design-system/composants` that shows every component of the Design System in Confort, or in Compact with `?densite=compact`, for the tests. Only e2e and development builds serve it; the Design System page of the Back Office replaces it for readers.
_Avoid_: Storybook, Design System page

**Design System page**:
The Back Office page at `/admin/design-system`, under Plateforme and open to every Back Office Role, that shows every token and every component with its states. Its theme and Density toggles apply to the page only, through an OverlayScope.
_Avoid_: Components page, Storybook

**OverlayScope**:
A part of a page that sets its own theme and Density, inside which the Drawers and Dialogs it opens keep that theme and Density instead of the page's.

**Screenshot baseline**:
A reference image of a screen, drawn in the pinned Playwright image and compared with the screen in CI. A difference fails the check until someone redraws the baseline on purpose.

**Side Panel**:
The extension's pane docked to the right of the browser's page, beside the job posting the person is reading, where Capture, the Match Score and the extension's other functions live. It replaces the popup and is opened by the toolbar icon or a Job Site's badge; the badge's Capture lands in the Guest session the panel reads. Once open, it follows the **Posting in view**.
_Avoid_: Popup, sidebar (that is the web app's Sidebar)

**Posting in view**:
What the page in the active tab of the Side Panel's window reads as: a Job Site's posting, a page to capture by hand, or no posting. The Side Panel follows it from tab to tab and offers « Offre détectée sur cette page ».

### Delivery

**Agent Run**:
One run of an AI agent by a delivery workflow (e.g. implementing, testing or reviewing a GitHub issue), recorded with the time, tokens and verification round it used so delivery cost per issue can be followed up. Internal to the team building Jobbbox; unrelated to the AI Coach.
_Avoid_: Job, task, session, AI call

**Version**:
The one number `X.Y.Z` (SemVer) that names what the web app and the worker serve. It exists once it is Promoted: until then, `main` carries the next Version and the Beta shows it with its commit (« X.Y.Z (main·sha) »); Production shows it bare. No suffix such as `-beta`. Not the Extension Version, nor the API Version.
_Avoid_: Release, build, tag

**Beta**:
The environment `main` is deployed to (staging.jobbbox.ai): the next Version, before its Promotion. Agents deploy it; Candidates of Production never see it.
_Avoid_: Staging (in product discussions), preview, preprod

**Promotion**:
The step, run by the product owner alone, that turns what the Beta serves into a Version in Production: it checks that the version numbers agree, CI passed, the Beta serves that commit and, unless nothing a Candidate can see changed, its Release Note exists in French and in English, then tags the Version and deploys it. `main` then moves on to the next Version. No agent may Promote.
_Avoid_: Release, go-live, prod deploy

**Extension Version**:
The extension's own number `X.Y.Z` (only digits, as the browser stores require), published on two store listings: the public one, tied to Production, and an unlisted beta one, tied to the Beta. It moves apart from the Version, since a store review can hold it back and an extension change needs no web change.
_Avoid_: Version (for the extension)

**API Version**:
A whole number (1, 2, …) naming the contract between the extension and the web app, raised only when a change breaks an extension already installed. The extension states the API Version it speaks; the web app serves the current one and the one before. An older extension is asked to update itself (« Mettez à jour l'extension »). Payment and email providers' webhooks are outside it.
_Avoid_: API release, endpoint version

**Release Note**:
What one Version or Extension Version brings, written for Candidates in French and in English (the French text prevails): a title, a short introduction, its Nouveautés tags and its « Nouveau », « Amélioré » and « Corrigé » lines, with an optional image. Written before the Promotion and never changed after it. A Version with nothing a Candidate can see has none; it still gets its tag and a technical GitHub Release. Its GitHub Release carries the French text, the English text, then the list of changes. The first one, 0.1.0, sums up what already existed.
_Avoid_: Changelog entry, patch notes

**Nouveautés**:
The public page (`/nouveautes`) listing the Release Notes, newest first, filtered by tag. On the Beta it also shows the next Version's Release Note under « Version bêta, pas encore publiée ». It has no subscription form.
_Avoid_: Changelog, What's new, blog

**Nouveautés email**:
The email that tells a Candidate about a Release Note marked to be announced, at most once a week, in their Interface Language: its title, introduction and « Nouveau » lines, with a link to Nouveautés, without tracking. Only Candidates receive it, and only once they have ticked it themselves in Mon compte (never ticked by default), with the date they did. Unsubscribing needs no sign-in; the choice is in their Data export. A Visitor cannot subscribe.
_Avoid_: Newsletter, changelog email

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
The bar at the foot of the Sidebar showing how much of the week's Plan Quotas the Candidate has used: every use over every use the Plan grants, so each quota weighs what the Plan grants of it; unlimited and not-included quotas weigh nothing. Titled « Hebdomadaire » ("Weekly"), with a line under the bar saying the quota renews Monday at midnight. Its button opens a card above the meter (Escape closes it) showing each quota's use and the Job Digest frequency, and leading to the subscription page.
_Avoid_: Credits bar, usage gauge

**Coupon**:
A code a Candidate types at Plan checkout, or brings in a shared link (`/abonnement?code=…`), for a discount on a Plan: a percentage, or a fixed amount in euros, off once, for N months or for as long as the subscription lasts, on the Plans it names, with an optional expiry, maximum redemptions and an optional first-payment-only restriction (Stripe's: refused to anyone who has already paid anything, a Coaching Session included; not "first subscription"). A Stripe coupon and its promotion code, created by Plans managers in the Back Office's Codes promo section; Stripe counts its redemptions. Its terms never change; deactivated, it can no longer be redeemed, while discounts already given run their course. A code brought to checkout that does not apply (another Plan, expired, refused by Stripe, not checkable) is refused with the reason, never dropped silently: the Candidate may go on without it. A 100 % Coupon subscribes without a card; when its free period ends with no card, the Candidate is back on Free at once. A fixed amount for as long as the subscription lasts must stay below the Plans' prices. The subscription page shows the discount a subscription is getting. A Candidate on Free can type and check a code on that page before choosing a Plan. Coaching Sessions take no Coupon.
_Avoid_: Promo code, voucher, discount code

**Upgrade Prompt**:
What a Candidate is shown when a Plan Quota stops them: what they reached and the lowest-ranked offered Plan above theirs that would let them go on, or when the quota renews if no Plan offers more.
The plan comparison marks that same Plan « Conseillée » (recommended Plan) beside the Candidate's own, « Votre offre ».
_Avoid_: Paywall, upsell, upgrade popup

**Payment Failed Notice**:
What a Candidate is shown while their subscription is past due: Stripe is retrying a failed payment and the Plan is kept. It sends them to the Stripe customer portal to update their payment method, and disappears once payment succeeds. Shown only in the Candidate's sidebar layout.
_Avoid_: Dunning banner, billing alert

**Withdrawal**:
A Candidate renouncing a contract concluded online, without a reason and at no cost (« rétractation », C. conso. L221-18): a Plan's subscription, or a paid Coaching Session not held yet. Made on Jobbbox's own page, « Renoncer au contrat ici » (`/abonnement/retractation`), reached from the subscription page and from the Coaching Session in the Agenda, never from the Stripe customer portal. « Confirmer la rétractation » ends the contract at once (a subscription is cancelled now, never a Scheduled Cancellation; a Coaching Session is cancelled and its Human Coach told) and refunds everything paid for it in full through Stripe, automatically (ADR-0071). The acknowledgement (« accusé de réception ») is emailed with its date and time and the amount refunded, whatever happens to the refund. A refund that fails, at once or days later, shows as « Échoué » in the Back Office's « Rétractations », where Support retries it. A contract a 100 % Coupon left free is withdrawn all the same, with nothing to refund. Each Withdrawal is the Candidate's: in their Data export, deleted with their account.
_Avoid_: Cancellation (that is a Scheduled Cancellation or an immediate one, with no refund), refund request, renunciation

**Withdrawal period**:
How long a contract can be withdrawn from: 14 days from the day after it was concluded (a subscription's start, a Coaching Session's payment), to the end of the 14th day, French time. A period whose 14th day is a Saturday, a Sunday or a public holiday of metropolitan France runs on to the end of the next working day (L221-19): the 15th day is then still in it. A Plan changed in the customer portal is the same contract and opens no new period.
_Avoid_: Cooling-off period, grace period, 14-day window

### Legal texts

**Legal Text**:
One of Jobbbox's public legal documents: the CGU, the CGV (with the withdrawal form), the privacy policy (with its cookies and « IA dans Jobbbox » sections) and the legal notice. One set for every role, with a section per role; French is binding, English is a translation.
_Avoid_: Terms page, policy page, legal page

**Legal Text Version**:
One dated, immutable wording of a Legal Text, named by its effective date and marked substantial or minor, with the product owner who approved it and its line in the version history. Its id is its effective date, the same in French and English; its permanent address is `/legal/<text>/<date>`. Never served as the one in effect before its effective date: a substantial version of the CGU, the CGV or the privacy policy still to come is readable only at its permanent address, marked « Version à venir », where the email telling Candidates of it links (#547); a minor one is not served before its effective date. Once in effect, never edited: a correction is a new version, and earlier versions stay readable, marked « Version archivée ». A Legal Text with no version in effect shows « Ce texte n'est pas encore publié ».
_Avoid_: Revision, edition, draft

**Préavis**:
The email telling a Candidate, 30 days before it takes effect, that a substantial version of the CGU, the CGV or the privacy policy is coming. Sent once per Candidate and version, in Production only, to a verified address; it names the text, its effective date and the next step, and links to the version still to come. Never sent for the legal notice.
_Avoid_: Legal Notice (already means mentions légales), notification, newsletter

**Privacy change notice**:
The one-time line atop a Candidate's workspace announcing the privacy policy's latest substantial version in effect, closed with « J'ai compris ». It blocks nothing and is not shown to a Candidate who signed up on or after that version's effective date.
_Avoid_: Banner, consent, Acceptance

**Legal Review**:
The legal AI's evaluation of one Legal Text Version, recorded with it, before the product owner signs its effective date. A minor version is reviewed on its changes only; the English translation is checked for fidelity, not reviewed. There is no lawyer at this stage: a lawyer is called only on a listed trigger.
_Avoid_: Counsel review, lawyer review, validation

**Acceptance**:
A Candidate agreeing to one Legal Text Version of the CGU or the CGV, kept as proof. Only the CGU and the CGV are accepted: the privacy policy and the legal notice are information, never accepted. A Guest ticks the short CGU in the extension, held only in the Guest session.
_Avoid_: Consent (that is the EU AI Consent), agreement, opt-in

### Operations

**Back Office**:
The internal pages where Administrators manage Plans, Plan Quotas, Coupons, Human Coaches, Coaching Playbooks, Core Digest and Sources, Guardrails, Provider Secrets, Platform Settings, Sign-in Providers, Job Sites, Job discovery sources and Job discovery sites, the Unanswered Questions, the Candidates' Signalements (in the « Candidats » group, with the count of those « à traiter »), the Candidates' Withdrawals and their refunds (« Rétractations ») and the team's Back Office Roles, and follow AI Usage, Guardrail Triggers and the state of the Tools; its home page is the Back Office Dashboard and what happened is on its Back Office Activity page.
_Avoid_: Admin panel, dashboard, console

**Back Office Dashboard**:
The Back Office's home page: figures and charts of what the platform consumes and how Job discovery does (web search spend against its monthly alert threshold, cost of a run and per new Job Offer, runs that fell back, stop reasons, where a run's cost goes), each block shown only to the roles that read its section.
_Avoid_: Home, overview

**Back Office Activity**:
The Back Office page « Activité » (Plateforme group) where Administrators see what happened, one tab each: Recherches (every Job discovery run, its searches, Discovery metrics, Skip reasons, stop reason and fallback), Appels IA (the AI Message Log) and Actions des administrateurs (the Back Office Audit). Each tab keeps its own retention and readers; a run's query texts and link to its Job Search are kept 30 days (in the Candidate's Data export, deleted with the account), its figures 24 months; super-admins, Technique and Support read Recherches, only super-admins open the Job Search behind a run. Not the Activity of an AI step, nor the Candidate's « Activité IA ».
_Avoid_: Logs, journal, history

**Explainable label**:
The dotted-underlined label of a setting, source, warning or Dashboard figure in the Back Office; it opens the Back Office Assistant asking it to explain that item in context: what it does, its value and where it comes from, why it is unavailable, what a change would do. A page's intro is one muted line followed by an « En savoir plus » Explainable label that carries the longer explanation.
_Avoid_: Tooltip, help icon

**Back Office Role**:
What an Administrator may see and change in the Back Office: super-admin (everything, including roles, Guardrails, Provider Secrets, Platform Settings, SSO providers, Job Sites, Job discovery sources, Job discovery sites and the AI Message Log), Plans manager (Plans, Plan Quotas, Plan Features, Coupons), Coach manager (Human Coaches, read Coach Message Cost), Playbook editor (Coaching Playbooks, Core Digest and Sources: edit, validate, archive; Eval Cases and start Eval Runs), Help editor (Unanswered Questions: read, mark written or dismissed; Signalements: read the Questions only, without the Candidate's email or Plan) Technique (every Platform Setting, Job discovery source, site and Job Site and the prices of Tools, but never a Provider Secret, which it sees only by its source and last 4 characters; reads the Dashboard and the Recherches and Actions des administrateurs tabs of Back Office Activity) or Support (changes Signalements: reads every one with the Candidate's email and Plan, changes its status and replies; reads everything else read-only, including Eval Runs, Tools and Platform Settings, no secrets, no AI Message Log). Nobody deletes a Signalement from the Back Office. Super-admins also start Eval Runs. Fixed in code; only super-admins grant or revoke them.
_Avoid_: Permission level, admin type

**Provider Secret**:
A third-party key (an AI provider's, France Travail's, Fantastic.jobs', the contact-enrichment provider's, Stripe's, Brevo's API key or SMTP credentials) that super-admins enter on its provider's sheet in Paramètres (formerly the Clés section); Brave's and Tavily's keys included. Stored encrypted in our database and used over the environment variable of the same name, which it falls back to once cleared. Never shown again once saved: only its source, last 4 characters, and who changed it when.
_Avoid_: API key setting, credential, config secret

**Platform Setting**:
A non-secret setting of the platform that the code gives a default and the environment can override: where Claude is reached and in which region, each AI task's provider and model, the identity model, OpenAI's data residency, the web search provider and model, `MAIL_FROM`, the Job Digest's thresholds, the Job discovery budget, the contact-enrichment provider and whether its DPA is signed, and the extension's store page, and « Conversation au centre » (`CONVERSATION_FIRST`, a true/false value, off by default: when on, the Candidate's home page is a new Free conversation; changed on Paramètres' Environnement tab). Super-admins change it in the Back Office's Paramètres section (under Plateforme), which wins over the environment variable of the same name, which wins over the code's default; « Rétablir » clears the Back Office's value. So far only AI routing, the email sender (`MAIL_FROM`), the Job Digest's thresholds, the Job discovery budget, Enriched Contacts' provider and DPA (marking it signed asks for a confirmation) and the extension's store page (an https URL) can be changed there; the other groups stay read-only until their own issue. A change takes effect within seconds in the web app and the worker, without a restart. An AI routing change, « Rétablir » included, is checked as the AI layer would build it and refused if wrong: a route missing, a personal-data task or the identity route reaching an endpoint outside the EU, or a model it newly names failing its **test call** (one request of a single token, or one search, no retry). A problem the configuration already had does not block it. The refusal is recorded in the Back Office Audit with its Failure Reason (`route_missing`, `data_residency` or `test_failed`). Paramètres shows every one with its effective value, source and code default, and flags a value from the environment that differs from the default; it also shows, read-only, the bootstrap settings that only the environment holds (`DATABASE_URL` without its password, `AUTH_SECRET` and `SECRETS_MASTER_KEYS` only as set or missing, `APP_URL`, `ADMIN_EMAILS`, `JOBHUB_TARGET`, `AI_FAKE`, `MAIL_TRANSPORT`) and links the settings that have their own section (Plan Quotas, Guardrails, Coach Message Cost, Provider Secrets). Not a Provider Secret: its value is shown and recorded in the Back Office Audit. Paramètres is laid out in tabs, one per kind of Tool (web search, AI, Sources, contact enrichment, email, payment, sign-in), then Extension and, last, Environnement (what only the environment holds, read-only, each with why): each tab shows the active provider and its settings, then every possible provider with its Provider Secrets, connection test, tools and prices, linked to its Outils page; one « + Ajouter » adds any of them. Technique and super-admins change it; a provider with no key can be chosen, with a warning (a text task routed to one fails only its own calls, recorded `key_missing`, and its model is not test-called). A provider's **sheet** (side panel, `&fournisseur=`) shows its keys with their last connection test and lets a super-admin replace, clear or test them; « Rendre actif » makes it the tab's active provider. Environnement also lists the environment variables the code no longer reads that an environment still sets.
_Avoid_: Config, env var, default, setting override

**Web search settings**:
The eight bounded Platform Settings of Paramètres' Recherche web tab: the country, the maximum age of a posting in days, the results per query, the titles per language and the query languages of Job discovery's searches, the Target Companies visited per run and their revisit delay, and the monthly web search alert in euros (0 is no alert). A value out of its bounds is refused with the reason. A **country** is a two-letter code, kept in upper case.
_Avoid_: Search config

**Search AI tasks**:
The four AI tasks of web search (Job Search queries, Job Offer reading, company facts, company news), each a Task Playbook shown in Recherche web with its provider, model, effort and key state.

**Draft Playbook Version**:
The version a change to a Playbook Agent's model or effort makes from Paramètres: saved as a draft to validate in Playbooks, so the served version stays unchanged until then. A route change (provider and model of an AI task) is instead a Platform Setting, applied from the next call.

**Tool**:
An external service the application calls at runtime, from the web app or the worker: an AI model, web search, a job board API, the company register, a contact-enrichment provider, a source of Reference data or of Place suggestions, Stripe, Brevo or a Sign-in Provider. Each is registered in one catalog with its purpose, the keys it needs, where its calls are recorded and its data residency (in the EU, outside the EU, or not established), and the Platform Settings it depends on; a provider missing from the catalog fails the tests. The Back Office's Outils section shows each Tool's state (configured, key missing, setting missing, off, not configured, or en attente d'accès: configured but refused by its provider), its Platform Settings read-only with their source (linked to Paramètres, flagged when one comes from the environment and differs from its default) and its last 30 days of calls, failures and cost, and its latest calls without any payload. Every external call is recorded, whatever the Tool (AI models, Stripe, Brevo emails, sign-in, connection tests of Provider Secrets, and the Job Site pages read, named by their domain only, under the Tool Job Site), and never carries an address, a Candidate, a URL, an answer or a secret. Super-admins, Technique and Support read it. Not a tool an AI model uses during a call (a web search it runs), which is only counted in AI Usage.
_Avoid_: Integration, connector, service

**Recipient list**:
The public page, « Destinataires des données », that names each Tool switched on in production which receives personal data or queries drawn from it: what it is for, what it is sent, where it processes it (in the EU or outside it; not established counts as outside) and the safeguard of a transfer. Read from the Tool catalog, so it always matches AI Activity; the privacy policy and its « IA dans Jobbbox » section point to it rather than naming providers.
_Avoid_: Processor list, sub-processor list (sign-in providers and Stripe are not all processors), vendor list

**Sign-in Provider**:
An identity provider, besides the magic link, that people sign in with: Google, Apple, Microsoft or a generic OIDC provider. Super-admins configure them in the Back Office's Connexion section; each is enabled only after a test sign-in, and is shown to Candidates, allowed for Administrators, or both. Trusted for linking, it signs a person into the existing account with the same email; otherwise they sign in by magic link first and link it from Mon compte. Its client secret (Apple: its Team ID, Key ID and .p8 key) is a Provider Secret.
_Avoid_: SSO provider, identity provider, social login, auth connector

**Require SSO for Administrators**:
A super-admin setting, off by default: the Back Office asks an Administrator signed in by magic link to sign in again with a Sign-in Provider allowed for Administrators. Their Candidate pages are unaffected, and `ADMIN_EMAILS` super-admins are exempt.
_Avoid_: Enforced SSO, mandatory SSO

**Back Office Audit**:
The record of every change an Administrator makes in the Back Office (roles, Plans, Plan Quotas, Coupons, Human Coaches, Coaching Playbooks, their Eval Cases, Core Digest and Sources, including validated, archived and restored, Guardrails, Provider Secrets, Platform Settings (changed or restored to default, with the value and its source, Back Office, environment or code default, before and after), Sign-in Providers, Job Sites, Job discovery sources and Job discovery sites, an Unanswered Question marked written or dismissed, named by its id, never its words, and a Job Search opened from a Discovery run by a super-admin (section `discovery_runs`, named by its id), a Signalement's status changed or its reply written or changed, named by its id with the status before and after or whether the reply was written or changed, never the message's or the reply's words): who, when, what and the values before and after; and of every AI Message Log a super-admin opens. Secret values are never recorded, only that they were replaced (possibly despite a failed connection test) or cleared. It also records every attempt that failed or was refused, with its Outcome and Failure Reason: a connection or sign-in test that failed, a save or validation refused by a business rule (a Playbook not validated, a Guardrail setting refused by its Eval Run, the last super-admin, Stripe refusing a Plan or Coupon, a Platform Setting value out of its bounds or of the wrong type, a Question marked « traité » before it was replied to (`reply_required`), a Signalement's reply written once it is « traité » (`already_handled`)), and an Administrator opening a section outside their Back Office Roles, Signalements included (action « Accès refusé », Failure Reason `role_missing`, target the page tried, at most once per Administrator, section and minute, in UTC; those sections can hold only such entries: Eval Runs, Coût coach, Consommation IA, Sites de recherche, Pages Outils, Paramètres, Activité; a visitor with no role is not recorded); a form field left empty or too long is only shown on the page. A refused attempt never keeps the values entered, only what was tried, on which target, and the field at fault. Kept for 3 years, then purged. Jobbbox's own record, so it survives the Administrator's account deletion (their id is cleared, their email at the time stays) and is not part of their data export.
_Avoid_: Audit log, history, activity feed

**Outcome**:
How an AI call or a Back Office action ended: ok (succeeded), warning (an AI call that worked while its feature ran degraded, such as a Task Playbook falling back to its built-in text, Redaction by shape alone or a Playbook Agent left out of a reply) or failed (an AI call that failed or was never sent, a Back Office attempt refused or failed). The Back Office Audit only uses succeeded and failed.
_Avoid_: Status, result code

**Failure Reason**:
Why something failed or warned, in two parts. The functional reason is a stable code from one catalog fixed in the code (`provider_unavailable`, `key_missing`, `data_residency`, `guardrail_timeout`, `invalid_verdict`, `provider_error`, `test_failed`, `eval_refused`, `last_super_admin`, `role_missing`, `invalid_value`, `reply_required`, `already_handled`, `stopped` (the Candidate stopped the action; for an AI call, no tokens and no cost, and not sent if stopped before it left), …), each with a French wording an Administrator understands; the three Guardrail codes (`guardrail_timeout`, `invalid_verdict`, `provider_error`) are used only by a Guardrail Trigger that could not check, and `provider_error` there is the check's own failure, not the AI call's classification (that stays in the call's AI Usage entry); an unknown error is `other` (« Erreur inattendue »), and so is a failed or warned call recorded with no code or with a code no longer in the catalog. The technical reason is the error's class, the provider, the HTTP status and its message, scrubbed of keys and secrets, passed through Redaction and cut at 500 characters. The code goes where counts are kept (AI Usage, Guardrail Triggers, 24 months, Support reads them); the technical reason only goes with the text it explains (the AI Message Log, 30 days) or in the Back Office Audit (3 years), both read by super-admins only.
_Avoid_: Error message, error code, cause

**AI call warning**:
A degraded path of a feature recorded on the AI call it concerns, with a code from the Failure Reason catalog and a technical detail: a Task Playbook that fell back to its built-in text, was unreadable or lacked its section, a Playbook Agent or search not offered or left out, identity unavailable or undeclared to Redaction, job title variants or Company News unavailable, CV reading by fallback, a Tailored CV reply refused, a Match Score text unread or too slow. A call that worked with warnings has Outcome warning and its first warning as its reason; a failed call keeps its own reason and carries its warnings beside it. The codes go with AI Usage (24 months, counted per reason); the details stay with the AI Message Log (30 days, super-admins only). The Data export lists each warning's code and wording, never its detail. Paths with no call to carry them stay on the console.
_Avoid_: Console warning, degraded call

**Journal**:
The Back Office page where Administrators read the Back Office Audit, newest first, filterable by section and by Outcome (succeeded or failed). A failed entry shows its Failure Reason in French, its technical detail behind « Détail technique ». Those allowed to read the Tools also have the Outils section, which lists the Tools' calls beside the entries.
_Avoid_: Audit page, changelog

**AI Usage**:
What every AI call cost Jobbbox, whatever its task (not only AI Coach replies): when, task, provider, endpoint, model, input, output and cached input tokens, estimated cost in euros at list prices (the same prices as the Coach Message Cost; a Tool's billed units at its Price), duration, Outcome (ok, warning or failed) and the Failure Reason's code, also for a call stopped before it was sent (missing configuration, data residency); with each tool its model used (a web search, priced per search) and every call to an external API (France Travail, the French company register, the job boards, contact enrichment: provider, operation, HTTP status, cost when known). No Candidate and no text: aggregates of no one, so outside the Data export and kept 24 months whatever happens to accounts. Super-admins and Support read it on the Back Office's Consommation IA page, per period, with failures and warnings counted per Failure Reason (also on Outils).
_Avoid_: AI bill, token log, metering

**Billed unit**:
What a Tool charges for: a Perplexity Search API call (1 to 5 queries), a Brave request, a Tavily credit (2 for an advanced search). A call that bills several units is counted once per unit.
_Avoid_: search count

**Price (of a Tool)**:
A Platform Setting giving a Tool's cost per Billed unit; its code default is the list price, with its source URL and date, and Technique and super-admins may override it on the Tool's sheet in Paramètres (the EUR/USD rate on the Recherche web tab). It applies from the next call. Token prices are not Platform Settings. A billed use with no known Price is recorded with no cost, counts 0 and shows « prix inconnu » with its number of uses. Job discovery's budget sums the same recorded cost as AI Usage.

**Web search alert**:
One email per month to super-admins, and a banner in Consommation IA, when the Paris-time month's web search spend (recorded cost at list price, no free allowance deducted) reaches `WEB_SEARCH_MONTHLY_ALERT_EUR`; 0 sends nothing. It never cuts a search.

**AI Message Log**:
What one AI call said, as sent: its system text and messages after Redaction, and the reply as it came (none when the call failed, or was not sent), keys and secrets scrubbed, with the Candidate it was made for (none for a Guest), and the call's Outcome with its Failure Reason, technical detail included. Kept 30 days for quality and debugging, then purged; deleted with the account and in the Candidate's Data export. The Candidate's Data export holds each failed call's Failure Reason code and French wording, never its technical detail. Only super-admins read it, on the Appels IA tab of the Back Office Activity page, filterable by Outcome and Failure Reason, and every log they open is written to the Back Office Audit.
_Avoid_: Prompt log, transcript, chat history

**Call facts**:
What every AI call result carries about the call itself: the endpoint with its region, the duration and the Outcome (ok or warning), the same values written to AI Usage, so Provenance can keep them. A call the Candidate stops fails with Failure Reason `stopped`; a Company News search is the only search that otherwise never fails, and it now fails when stopped, so the Company Dossier is not built without news.
_Avoid_: Metadata, usage

**Provenance**:
What served one piece of content a Candidate sees (a Job Search, a Job Offer's reading and summary, a Tailored CV or Tailored Document, a Company Dossier, a Master CV Version read from a file, an Action Card, a Job Digest, an AI Coach reply), fixed when it is made and kept with it: its steps, each with its Activity, its AI task or Tool, for an AI step the provider, where it ran (endpoint and region) and the model that actually served, tokens in and out, and its duration, start time and Outcome (stopped included); its Provenance sites; and its start time and wall-clock duration. No Candidate, no cost, no text. Lives and is deleted with its content, so it is in the Data export with it. A Tailored CV's lives in its proposal and is copied when the Candidate saves it; a Tailored Document's survives the Candidate's edits. Content made before it existed, or whose Provenance was not kept, shows « modèle non enregistré » and counts in no total; nothing is estimated. Not AI Usage, which counts calls for Jobbbox and names no one, and never linked to it.
_Avoid_: Metadata, trace, lineage, usage

**Provenance line**:
The quiet line under each saved AI Coach or Back Office Assistant reply: the models by display name and where they ran, the « consentement IA UE » or « hors UE » chip when that route served a call, tokens, time, Tools, and the Provenance sites behind a disclosure button. Never cost, prompt, AI task, Playbook Agent or identifier. A reply made before Provenance existed shows what its saved provider, model and tokens allow (a partial Provenance, time unknown and so not shown), or « modèle non enregistré » when no model was saved.
_Avoid_: Footer, metadata line, usage line

**Focus**:
The object a Coach reply was about: the Subject's object, else the Agenda for the Agenda menu, else the item In view when it was asked: an Application, a Job Offer, a Profile, a Job Search, a Job Digest or the Agenda (which has no id). Kept with the reply so AI Activity can count the reply with that page, and in the Data export.
_Avoid_: Context, subject, target

**Joined Provenance**:
The one Provenance of a content made by two actions (an offer found by a Job Search then read, or read then summarized later): the steps of both in order, each site once with the links of both, the first start, and the wall-clock times summed, never the time between the actions. A Job Offer found by a Job Search keeps the search step that found it, the listing page that led to it, its ATS API or page read and the reading model. A capture that fills the summary of an existing Job Offer keeps the Provenance the offer already has. A Job Offer captured by the browser extension has none.
_Avoid_: Merged trace

**Provenance site**:
A site whose pages a piece of content was built from, kept in its Provenance with the links read: an offer page, a job board, the company register (its page for the company), the news articles and web pages a Company Dossier's facts come from, the Candidate's own Master CV (a site with no link) and Profile. Shown to the Candidate under « Sources »; a link never points to a LinkedIn profile, a page naming a person, an Enriched Contact, an address inside Jobbbox other than the Candidate's own pages, a signed or tokenised address or a query string. Not a coaching Source (`[S12]`). Either a website (by domain, `www.` removed) or the Candidate's own pages, kept as relative paths (Profils, Candidatures, Recherches, Offres, Job Digests). Steps that ran the same Activity, task or Tool, provider, endpoint, model and Outcome are shown folded into one, with a count.
_Avoid_: Source (alone), citation, reference

**Activity**:
What one step of an AI action is doing, fixed in the code per step and by default per AI task or Tool, never per Playbook: think, think then write, write, search, web search, read or compute (rules, no AI). It picks the glyph AI Activity shows while the step runs.
_Avoid_: Status, phase, stage

**Step label**:
What AI Activity calls a running step: its Activity, or « check » for a Guardrail's check. Worded in French and English.
_Avoid_: Step name, status

**Live action**:
An AI action of the Candidate running now, or stopped or failed lately, as AI Activity shows it: running, stopping, stopped or failed. A finished action leaves, its result counting with the page. A stopped or failed action stays in the pane until the next Coach reply replaces it or, for a Job Search, until its notification is dismissed; only a Job Search this browser saw running is shown so. Only an action this browser saw start is announced as starting (a Job Search found running after a page reload is not). Its start and its end are announced once, by one polite live region above every Candidate page, so a page change neither loses nor repeats them; the Coach Conversation and a Job Search's notification announce their own end.
_Avoid_: Task, job, process

**Stop**:
The Candidate ends an AI Coach reply on its way with « Arrêter » (the « Envoyer » button, no confirmation). Every AI call of the reply is aborted (AI Usage `stopped`). The question is kept in the Coach Conversation, no reply is saved, and « Réponse arrêtée » shows the tokens and time spent. A stopped reply counts against no Plan Quota. It also ends a Tailored CV proposal and the drafting of a Cover Letter or Outreach Message from the Candidate's documents page: the request is aborted (AI Usage `stopped`), nothing is kept (the saved Tailored CV, the proposal under review or the stored draft stays as it was), and the page says « Arrêtée à HH:MM » in light red with the tokens and time spent. No Plan Quota is involved in these actions. Stop also ends a Company Dossier being built (the facts found are kept, the news is marked not searched; stopped earlier, nothing changes) and the reading of an uploaded CV (nothing is drafted, not even the rule-based outline, so no Master CV Version is created). Neither counts against a Plan Quota.
_Avoid_: Cancel, abort

**Run progress**:
The live steps of an AI action that runs in the worker (a Job Search), kept on its row only while it searches: the latest event of each step, an ended step replacing its start. It feeds AI Activity's live steps, including « En cours ailleurs », through the page's poll (every 1.5 s while an action runs). Cleared when the action finishes or times out, so it is never in the Data export; the Provenance, kept with the result, is.
_Avoid_: Status, log

**Part**:
One Job Offer's search and reading inside a Job Search. It has its own Provenance (the Job Offer's), and its steps and sites are also recorded on the Job Search's run.
_Avoid_: Sub-search, task

**Provenance rule**:A step of Provenance with no AI call and no Tool, done by the code's own rules: Match Score (one step of a Job Search's Provenance, scoring every Job Offer found), ATS Score, ATS fixes, offer freshness and offer deduplication. Its Activity is compute. A Guardrail check is not one: it is an AI call (think).
_Avoid_: Computation, script, algorithm

**Rules Provenance**:
The Provenance of content made by Jobbbox's rules alone: one compute step, no model, naming the Candidate's own pages it read. ATS Score, an ATS Fix card and a Job Digest's Match Scores have one; AI Activity shows it as « Calcul » where a model would be named. An ATS Score's is not stored: it is read from when the score was computed, with its time unknown, so an ATS Score from before Provenance still shows « Calcul », not « modèle non enregistré ». A Job Digest's Provenance is its Match Scores step, joined with the run of Job discovery that topped it up, if one did and did not fail.

**AI Activity**:
The button in the Candidate's top bar, left of « Aide et coach », and the pane it opens, « Cette page »: which models (with tokens and time), Provenance sites and Tools produced what the page shows, summed for the page and listed per element, read from each element's Provenance; the AI Coach replies given while the page's object was in view count with the page. While an AI action of the Candidate runs (on this page or « En cours ailleurs »), it shows each step live with its Activity's glyph and a stop icon; a stopped or failed action is shown in light red, in words, with its finished steps. A failed action gives its Failure Reason in French when its route sent a known code (only the code, never the provider's words), and « Elle n'a pas pu aboutir. » when it sent none or `other`. Never in the Back Office, never cost, prompts, the Playbook Agent, Back Office settings or internal identifiers; tokens are labelled a technical measure, not counted against Plan Quotas, and never appear in the Usage Meter. Models are named for people (« Claude Opus 5 »), with where they ran (« AWS Bedrock · UE ») and the EU AI Consent or outside-the-EU route when that served the call; providers are named in text, with a logo only where its owner allowed it in writing.
The button has a frame (the bordered square around its icon alone, as high as « Aide et coach ») and words (the page's summary or the step under way) left of the frame; the words are outside the frame but still part of the button.
_Avoid_: Session pane, sources bar, tasks panel
On the Candidate's pages (ADR-0070) it is the « Activité » group of an object's Fiche, and elsewhere a column opened by the Top Bar's « Activité », with the Context bar; never over the conversation.

**AI Activity element**:
One item AI Activity lists under « Par élément » with its own Provenance: a Job Offer, an AI Coach reply, a Job Search, a Company Dossier, a Master CV Version read from a file (« CV de référence, lu dans votre fichier »), and so on. An Abandonnée suggestion is not one: Jobbbox writes its text, with no AI. One without a recorded Provenance shows « modèle non enregistré » and counts in no total. It still shows the sites its source names. Each Provenance site appears once in the page's Sources, however many elements read it.
_Avoid_: Row, entry

**End state**:
How an AI Activity element ended, as « Par élément » shows it: done, stopped or failed. A stopped or failed element is in light red, with « Arrêtée » or « Échec » and the time (the date too on another day) and, for a failed one, its Failure Reason; its tokens and time still count in the page's Total. Stopped when its action was stopped or any step was stopped; failed when its action failed or a step that wrote its content failed; otherwise done, so a Guardrail that could not check, or one source of many, leaves it done. A Job Search counts by its own status as well, since one stopped between two steps has no stopped step. The time is when its Provenance started plus its wall-clock duration, unknown without a Provenance. Not a step's Outcome, which is never sent to the browser.
_Avoid_: Status, outcome

**Guardrail Trigger**:
One time a Guardrail blocked, flagged or could not check a message or reply: which Guardrail, its setting, what it did, for which agent, and when; when it could not check, why, as a Failure Reason code only (timeout, a verdict that was not valid, the provider's error). No Candidate, no Coach Conversation and no text: aggregates of no one, so outside the Data export and kept 24 months. Super-admins and Support read them per day in the Back Office; the text, if needed, is in the AI Message Log. No one is alerted when a Candidate expresses distress.
_Avoid_: Guardrail log, incident, alert

**Back Office Assistant**:
The AI Coach in a side panel (the Coach Panel) shown to Administrators in the Back Office. Answers questions about Back Office data and settings within the asking Administrator's Back Office Roles, including from an Explainable label, which asks it to explain that item in context; read-only, never sees Provider Secrets nor email addresses. Its box suggests the Administrators' Help Articles first, found without AI, and it answers from the matching ones, citing them; with none, it says no tutorial covers the point and offers « Demander un tutoriel ». Its conversations are the Administrator's own, kept apart from Coach Conversations and counted against no Plan Quota: kept 12 months after their last message, deleted with the account, in their Data export.
_Avoid_: Admin bot, admin copilot

**Help Article**:
One short text in French and in English that explains the product without an AI call: a page article (one per page), a glossary entry, a FAQ answer or a tutorial, with synonyms the reader's words are matched against. Written as Markdown, possibly drafted by an agent but published only once a person has reviewed it, searched by rules. The page article of a page is also shown for the pages under it (the Sections of an Application or of a Profile). Each article is meant for one audience (Visitor, Guest, Candidate, Human Coach or Administrator). The first four are public and read the same on the Candidate's pages and in the Help Centre; the Administrators' are read only in the Back Office, never public nor indexed.
_Avoid_: Help page, KB article, doc

**Tutorial**:
A Help Article that walks through one task step by step, across one or more pages, in numbered steps that quote the interface's labels word for word. Text first: it reads complete without any image or motion.
_Avoid_: Guide, walkthrough, tour

**Motion**:
An Explainer Video or a Micro-animation. Always attached to a Tutorial (or to a page's empty state), which reads complete without it, and played only when asked for. A motion that is out of date never makes its Tutorial wrong.
_Avoid_: GIF, tour, demo

**Explainer Video**:
A narrated video of 30 to 90 s showing one task of a Tutorial in the real interface, in French and in English, with captions and a descriptive transcript. Read in the Help Centre only, and never played on its own. The voice is synthetic, and the transcript says so.
_Avoid_: Screencast, demo video, tutorial video

**Micro-animation**:
A movement of 2 to 5 s, played once when the reader clicks « Voir comment » beside a Tutorial's step or in an empty state, that shows a gesture hard to find by reading. Decorative beside the written step, and a still image for those who ask for reduced motion.
_Avoid_: GIF, hint, coach mark

**Motion Script**:
The reviewed text of an Explainer Video, one per language, kept with its Tutorial: the narration, which says everything shown on screen, and the one source of its captions and transcript. Declares the pages it films, so a change to them flags the video to regenerate.
_Avoid_: Storyboard, voice-over text

**Help Centre**:
The public part of the site that lists every public Help Article (not the Administrators') by topic, named after the task rather than the role, with one search across them; readable by a Visitor, in French and in English. The Candidate's pages show the same articles in context: suggested above the box while typing and opened in the Work Pane.
_Avoid_: KB, support site, help desk

**Article card**:
A Help Article opened in the Work Pane beside a Coach Conversation (ADR-0070; a card in the Coach Panel's conversation before), from the box's suggestions « Dans l'aide, sans IA », « Comment marche cette page ? » or a HelpTerm. Kept only in the browser: never in a Coach Conversation nor in the Data export. When the Candidate asks the AI Coach next, it is told only the article's title, as the help gives it, never its text.

**Souvent demandé**:
The three FAQ Help Articles an empty Coach Conversation offers, beside « Sur cette page », the page's article.

**HelpTerm**:
The first mention of a glossary term (Match Score, ATS Score, Propositions, CV de référence, CV adapté, Relance, Plan Quota) in a visible sentence of a page, shown with a dotted underline; it opens that term's Help Article in the Work Pane. Later mentions on the same page are plain text. Never in a Section's heading, which is visually hidden, and absent in the Back Office, which has Explainable labels instead.
_Avoid_: Tooltip, glossary link

**Empty state help link**:
The link that follows the line of an empty state (no Propositions, no Relances, no Applications, no Job Search, nothing on the Agenda, no Profile data) and opens the Help Article that explains what fills it.

**Question sans réponse (couldNotAnswer)**:
The AI Coach's own hidden mark on a reply (a last line removed before anyone sees it) saying it could not answer the question. The Coach Conversation then offers « Poser la question à l'équipe » at once, without asking « Cela répond à votre question ? ». Never set on a Guardrail message or a Job Offer link; not saved with the Coach Conversation. Not the same as an Unanswered Question, and never linked to one.
_Avoid_: unanswered flag

**Unanswered Question**:
A question about using Jobbbox that a Candidate asked the AI Coach, or an Administrator asked the Back Office Assistant, that no Help Article answered, kept so the team can write the missing article. The AI Coach itself says whether a question is about using Jobbbox (not about the Candidate's job search); an Administrator's is kept only when they click « Demander un tutoriel », never automatically, and names its audience and Back Office section, never the Administrator. Question and answer are kept with identity removed, with the page's route pattern (never its address) and the Interface Language, and no link to the Candidate or the Coach Conversation. Asked again, the same question (same search words, page and language) counts once more; asked again after it was marked, it opens a new one. Help editors mark it written (« Article écrit ») or dismissed (« Écarter »). Purged 12 months after it was last asked, 30 days after it was marked; not in the Data export.
_Avoid_: FAQ gap, feedback, ticket

**Signalement**:
What a signed-in Candidate sends the Jobbbox team: a Bug (« Signaler un problème ») or an Idée (« Proposer une idée ») from under the box of a Coach Conversation or the icon beside « Mon compte » in the Sidebar (EN « Feedback »), or a Question (« Poser la question à l'équipe »), with a message of 10 to 2,000 characters. A Question is only an escalation, offered in a Coach Conversation when help or the AI Coach did not satisfy the Candidate: after « Non » to « Cela répond à votre question ? » under an AI Coach reply, in the AI Coach's unavailable message, or at once when the AI Coach's reply marks a question it could not answer (`couldNotAnswer`). The form's type switch never offers it; its form, in the Work Pane (a Drawer before ADR-0070), is titled « Poser la question à l'équipe », its text prefilled with the Candidate's question and editable. Its context is attached automatically: the page's path (never its query string or `#…`), the Jobbbox version, the browser as name, major version and operating system (« Chrome 141, Mac », never the raw user agent), the Interface Language and the Text Size. A Question also carries a copy of the Candidate's question and the AI Coach's reply, not a link to the Coach Conversation, and is never linked to an Unanswered Question. The dialog keeps an unsent draft for the visit (closing it does not lose it). At most 10 per Candidate in a rolling 24 hours. Read by people only: never sent to an AI, never redacted. Its status goes « nouveau », « vu », « traité », and the team can reply once (at most 2,000 characters), signed « L'équipe Jobbbox ». The Candidate reads theirs, newest first, in Mon compte's « Mes signalements » Section, with the team's reply (« Réponse de l'équipe Jobbbox », dated, « modifiée le … » once changed) and, for a Question, what was attached, collapsed; no thread. They can delete one there after confirming, never edit it: it is gone for the team too, and the Back Office Audit keeps only what it already held. Purged 12 months after it was marked « traité »; deleted with the account; in the Data export without which Administrator changed its status or replied.
_Avoid_: Ticket, support request, Retour

**Signalement notification**:
A message shown atop every workspace page when the team replied to one of the Candidate's Signalements or marked it « traité » (one only, when both happened; being marked « vu » gives none): « L'équipe Jobbbox a répondu à votre signalement du 25 octobre » or « Votre signalement du 25 octobre est traité », dated by when it was sent, with « Voir » leading to « Mes signalements ». In-app only, no email, no badge on Mon compte or in the Sidebar; checked on each page change, never polled. It stays until the Candidate closes it or opens « Mes signalements », where none is shown and which closes them all; a reply or « traité » saved afterwards notifies again. Follows the Job Search Notification's pattern.
_Avoid_: Alert, toast, badge, reply email

**Held back**:
Said of a source (Email intake) that counts as off whatever its switch, because something it needs is not ready: Email intake while no version of its Task Playbook is served, shown « Indisponible : en attente de validation du playbook ». It runs again by itself once a person validates the playbook (any version, on staging).
_Avoid_: Disabled, paused

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
One JSON file the Candidate downloads holding all their personal data, what they made and what Jobbbox worked out or obtained about them (GDPR art. 15 and 20): their account (sign-in methods and sessions), Plan and Plan Quota use, EU AI Consent and Follow-up Delays; their Profiles (Search Criteria, every Master CV Version, ATS Score, Job Searches, Job Digest settings and the Job Digests sent); their Applications (Job Offer, Interviews, Match Score, Tailored Documents, Follow-ups sent, Coach Reviews, Enriched Contacts, Company Dossier); their Coach Conversations with every message, Coach Memory, Action Cards, Coach Access and Coaching Sessions; their AI Message Log. It leaves out secrets (sign-in tokens and passwords, the Job Digest unsubscribe link), Human Coaches' email addresses and booking links, Stripe's and the contact data providers' identifiers, and the Coach Message Cost. Every table tied to a Candidate must land in it.
_Avoid_: Backup, data dump

**EU AI Consent**:
A Candidate's explicit, dated consent that AI calls carrying their identity go to an EU AI provider (Mistral). They can withdraw it at any time. Without it, such calls use the provider configured for their task.
_Avoid_: AI opt-in, privacy setting

**Identity block**:
The part of a CV that identifies the Candidate: name, postal address, phone and email.
_Avoid_: Contact details, header

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
The AI agent persona that guides the Candidate through onboarding, CV improvement, job search, application preparation and follow-up.
_Avoid_: Bot, assistant, agent (in user-facing language)

**Human Coach**:
A real HR professional, selected by Jobbbox, whom a Candidate can book for paid sessions on top of the AI Coach.
_Avoid_: Advisor, consultant, recruiter

**Coaching Session**:
A booked, paid video meeting between a Candidate and a Human Coach.
_Avoid_: Appointment, call, meeting

**Coach Access**:
The Candidate's explicit consent allowing a Human Coach to read their Profiles and Applications.
_Avoid_: Sharing, permission

**Coach Review**:
A Human Coach's feedback on one Tailored Document of an Application. The Candidate keeps it even after revoking Coach Access.
_Avoid_: Comment, annotation

**Coach space**:
A Human Coach's read-only pages: the Candidates who granted Coach Access, their Profiles and Applications, and the form for Coach Reviews.
_Avoid_: Coach dashboard

**Retired Human Coach**:
A Human Coach no longer listed to Candidates and who can no longer read anything. Past Coaching Sessions and Coach Reviews are kept.
_Avoid_: Deleted coach

**Coach Panel**:
The side panel, available from every page, where the Candidate talks with the AI Coach.
_Avoid_: Chat, chatbot, sidebar

**Coach context**:
What the AI Coach is told before each reply: always the Candidate summary and the Coach Memory, plus the item In view, plus summaries of the rest (onboarding answers, latest Applications, top Job Offers), within a size cap. Summaries are trimmed before the item In view.

**Candidate summary**:
The Candidate's first name and, for each active Profile, its target role, Search Criteria and seniority (from years of experience). Never the rest of the Identity block.

**Coach Conversation**:
A saved conversation between a Candidate and the AI Coach in the Coach Panel. A Candidate has several, each attached to the Profile in view when it started. The Candidate can name, reopen and delete it. Kept 12 months after its last message, then purged; deleted with the account. Human Coaches never see it. In the Data export with every message, without the Coach Message Cost.
_Avoid_: Chat, thread, session

**Coach Memory**:
The key facts (goals, constraints, decisions) the AI Coach keeps about a Candidate across Coach Conversations. The AI Coach proposes them from a Coach Conversation; an item is saved only once the Candidate confirms it, one by one. The Candidate sees, edits and deletes items in the Coach Panel. At most 30 items of 300 characters each. Sent with every AI Coach message. Kept when a Coach Conversation is deleted; deleted with the account. Human Coaches never see it. In the Data export.
_Avoid_: Profile notes, chat history

**Coach Message Cost**:
What one AI Coach reply cost: provider, model, input, output and cached input tokens, and the estimated cost in euros at list prices, fixed when the reply is saved. Kept with the reply, so it goes when the Coach Conversation does. Seen by Administrators only, as a median and p90 per day, never by Candidates.
_Avoid_: Bill, price

**Coach cost target**:
EUR 0.03 per AI Coach reply, judged on the daily median and p90 of the Coach Message Cost.

**Cached input**:
Input tokens the AI provider reads from its prompt cache rather than processing again; priced apart from the rest of the input.

**In view**:
The Profile, Application, Job Offer, Job Search or Job Digest the page the Candidate is on shows. The Coach Panel and AI Coach use it as context, and only if it belongs to the Candidate.
_Avoid_: Focus, current item, selected

**Action Card**:
A proposal from the AI Coach placed inside a page (e.g. "3 ATS Fixes proposées", "Relance suggérée") that the Candidate accepts or dismisses. Pending until decided or withdrawn, then accepted or dismissed, never decided twice. The AI Coach withdraws a pending card it no longer proposes (e.g. an ATS Fix the new ATS Score no longer calls for): it leaves the page as if never proposed, is not recorded as accepted or dismissed, and a decided card is never withdrawn. Accepting it carries out the change it proposes; if that fails, the card stays pending.
_Avoid_: Notification, suggestion, prompt

**Coaching Playbook**:
A versioned set of coaching rules the AI Coach draws on for one coaching topic, each rule citing its Sources.
_Avoid_: Guide, script, prompt

**Source**:
A numbered reference (`[S12]`) to a study or official publication that backs a coaching rule. Listed once, in the Sources list shared by all Coaching Playbooks.
_Avoid_: Citation, reference, link

**Core Digest**:
The short set of cross-cutting coaching rules the AI Coach always applies, whatever the topic. Validated like a Coaching Playbook.
_Avoid_: Summary, system prompt

**Playbook table**:
The mapping from what is In view and the topic of the Candidate's latest message to the Coaching Playbooks the AI Coach is given for a reply (one or two). A Profile counts as a positioning; a Job Search or Job Digest counts as a Job Offer.
_Avoid_: Routing, playbook selection

**Playbooks used**:
The Core Digest and Coaching Playbooks, with their versions, that an AI Coach reply drew on, recorded with the message. Empty when none is Human-validated for the environment.
_Avoid_: Sources used, citations

**Human-validated**:
A Coaching Playbook or Core Digest a named person has reviewed and approved, with the date. A review by an AI never counts. Only Human-validated coaching knowledge reaches Candidates.
_Avoid_: Approved, QA'd, reviewed

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
The job-search parameters of a Profile: target role, location, salary, contract type, remote work. The Candidate can change them on an active Profile, each change saving as soon as it is made; this never renames the Profile, and Match Scores and Tailored CVs already kept are not recomputed. An Archived Profile's Search Criteria are read-only until it is restored.
_Avoid_: Filters, preferences

**Onboarding Questionnaire**:
The guided interview, one question at a time, that builds a Master CV when the Candidate has no CV to upload. Scripted, so it cannot invent facts; its result is reviewed like an uploaded CV.
_Avoid_: Form, survey

### Job offers

**Job Offer**:
A job posting, captured by the extension or found by the AI Coach's search. One Job Offer can be referenced by many Candidates.
_Avoid_: Job, posting, ad, vacancy, offer (alone)

**Capture**:
The act of the browser extension turning the job page the person is viewing into a Job Offer, either detected automatically or triggered manually.
_Avoid_: Scrape, import, clip

**Job discovery**:
The AI Coach's search of the web for Job Offers matching a Profile's Search Criteria. Contrast with Capture, which starts from a page the person is viewing. URLs named in the search provider's answer are read like its sources, but the answer itself never makes a Job Offer.
_Avoid_: Scraping, crawling (alone)

**Listing page**:
A result page that lists several postings (a job board's search results, a careers site's openings) rather than describing one. Job discovery reads up to 5 of its postings on the same site, each checked like any result page. It is never a Job Offer itself.
_Avoid_: Results page, index page

**Job Search**:
One run of Job discovery that a Candidate starts for a Profile, and its outcome: searching, done or failed. It counts one against the Plan Quota, and the use is given back if the search fails or times out. A search nobody has finished after 15 minutes is failed. Its page shows the Match Scores against the Profile's current Search Criteria; a Job Search keeps no copy of the criteria it was run with.
_Avoid_: Search (alone, ambiguous with Search Criteria)

**Job Search Notification**:
A message shown on every workspace page when a Job Search stops being searching: how many published Job Offers it found, or why it failed (and that it does not count toward the Plan Quota). In-app only, no email. It stays until the Candidate closes it or opens that Job Search, and is hidden on that Job Search's own page.
_Avoid_: Alert, toast, Action Card

**Job Search query**:
One job title (the Search Criteria title or a Job title variant) worded in French or English; a Job Search has up to 6. Each gets its first page of results, and a next page only while the last gave a New readable posting.

**Job title variant**:
Another title for the same job, suggested by an AI step given the Search Criteria title only (no other Candidate data). Used to word more Job Search queries.

**New readable posting**:
A Job Offer a results page gave that the run had not found yet. It is what lets a Job Search query get its next page.

**Job discovery budget**:
The limits that end one run of Job discovery (a Job Search or a Job Digest top-up), whichever comes first: a number of Job Offers found (new or already stored), an estimated spend in euros, or a duration. Defaults: 30 Job Offers, EUR 0.08, 90 seconds. The result page being read when a limit is reached is finished, so a run can go slightly past it.

**France Travail search**:
The first source of a Job discovery run when France Travail is configured: the official job-offer API of France Travail, searched with the Search Criteria. Its Job Offers count toward the Job discovery budget; when they fill it, the AI plan and web search are skipped. Losing access is a normal outcome, never a failed run.

**France Travail status**:
How the France Travail search went in one run, part of the Discovery metrics: off (not configured), searched, refused (access withdrawn or credentials rejected) or failed (any other error).

**ROME code**:
France Travail's code for a job, derived from the Search Criteria title; a title naming no known job is searched by keywords instead.

**Discovery metrics**:
What one run of Job discovery (a Job Search or a Job Digest top-up) measured: how many Job Offers each step kept (provider URLs, pages read, Job Offers extracted, already stored, left after deduplication, with a Match Score of 60 or more), the pages skipped by Skip reason, and the estimated cost in euros. Costs are estimates from list prices, not billed amounts. Duration is the Candidate's wait (start to outcome) for a Job Search, and the worker's run time for a Job Digest.

**Skip reason**:
Why a result page gave no Job Offer (for example a Forbidden site, robots.txt, an unreadable page, a closed posting, or a posting too old).

**Posting date**:
When a Job Offer was first published, as its source states it. Sources, strongest first: the public JSON API of Greenhouse, Lever or Ashby, or a France Travail offer's creation date, the page's JobPosting `datePosted`, then the search provider's date for that page (weakest, as it may be a last-updated date). A date in the future or before 2000 counts as unknown. Never taken from a Candidate or the extension. Job discovery skips a posting first published more than 30 days ago (Skip reason "too old"), including a stored Job Offer found again, and the Job Digest leaves it out. A Job Offer with no known date is kept, labelled "date unknown", and listed after dated offers with an equal Match Score.
_Avoid_: Publication date (when unknown), created date

**Forbidden site**:
A site whose terms forbid crawling (LinkedIn, Indeed, Glassdoor). Job discovery never fetches it; only Capture covers it.

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
The research compiled about the employer behind a Job Offer from public data only: legal identity, address, financials and Suggested Contact Roles. Built from the French company register for a French employer; for a foreign one, from the web and marked less reliable. Never names a private person. Built only for a confirmed employer, and refused when the employer is not a company (e.g. a sole trader), in which case the Candidate is asked to name the hiring company.
_Avoid_: Company info, company profile

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
The licensed data provider (Lusha, Kaspr or Apollo) that supplies Enriched Contacts. Chosen by configuration and enabled only once its data-processing agreement is signed.

### Applications

**Application**:
The link between one Profile and one Job Offer, created when the Candidate saves the offer. A Candidate has at most one Application per Job Offer: saving the same offer again returns the existing one. The Candidate can switch its Profile later. Holds the Match Score, the Tailored Documents, the Application Status and the Follow-ups.
_Avoid_: Job entry, candidature (in code), opportunity

**Application Status**:
The stage an Application is at: À postuler → Postulée → Relancée → Entretien → Offre reçue → Acceptée, or the end states Refusée / Abandonnée. Changed manually by the Candidate.
_Avoid_: State, stage

**Interview**:
One dated interview round within an Application. Added only while the Application is at "Entretien", and kept if it moves on; it can be edited (date, time, note) or removed at any status. Times are French time (Europe/Paris).
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

### Scoring

**Match Score**:
A 0–100 measure of how well a CV (Master or Tailored) fits a Job Offer, with an explained breakdown (skills covered/missing, seniority, location, salary, contract type).
Each breakdown item is a match, partial, mismatch or unknown (the Job Offer or the Search Criteria give nothing to compare); unknown items do not count in the score. Seniority compares the years of experience the Job Offer asks for with the span of dated jobs on the CV.
On a Job Offer's page, a signed-in Candidate sees the Match Score against the Profile picked in the save form (the one the Job Search or Job Digest link named first), or, once the Job Offer is an Application, the Application's Profile, archived or not. Showing it never counts against the Plan Quota.
_Avoid_: Fit, compatibility, relevance

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
The Candidate's choice of how large all interface text is shown (Standard, Grande, Très grande). The smallest choice already meets the body-text floor, so it can only enlarge text.
_Avoid_: Zoom, font setting

**Sidebar**:
The menu down the side of the Candidate's pages: Profile switcher, links to their sections, Text Size. The Candidate can hide it, and the choice is remembered in that browser. On narrow screens it becomes a drawer opened from the top bar's Menu button.
_Avoid_: Navigation bar, workspace header

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
A configurable usage limit attached to a Plan: Profiles held at once, Match Scores, ATS Scores and Enriched Contacts per calendar month (French time), and the Job Digest frequency. A quota can be unlimited or not included at all. Changed by Administrators; a change applies at once to every Candidate on the Plan.
_Avoid_: Limit, allowance, credits

**Upgrade Prompt**:
What a Candidate is shown when a Plan Quota stops them: what they reached and the lowest-ranked offered Plan above theirs that would let them go on, or when the quota renews if no Plan offers more.
_Avoid_: Paywall, upsell, upgrade popup

**Payment Failed Notice**:
What a Candidate is shown while their subscription is past due: Stripe is retrying a failed payment and the Plan is kept. It sends them to the Stripe customer portal to update their payment method, and disappears once payment succeeds. Shown only in the Candidate's sidebar layout.
_Avoid_: Dunning banner, billing alert

### Operations

**Back Office**:
The internal pages where Administrators manage Plan Quotas, Human Coaches, Provider Secrets, Sign-in Providers and the team's Back Office Roles, and follow AI Usage.
_Avoid_: Admin panel, dashboard, console

**Back Office Role**:
What an Administrator may see and change in the Back Office: super-admin (everything, including roles, Provider Secrets, SSO providers and the AI Message Log), Plans manager (Plans, Plan Quotas, Plan Features), Coach manager (Human Coaches, read Coach Message Cost) or Support (read-only, no secrets, no AI Message Log). Fixed in code; only super-admins grant or revoke them.
_Avoid_: Permission level, admin type

**Provider Secret**:
A third-party key (an AI provider's, France Travail's, the contact-enrichment provider's, Stripe's, Brevo's SMTP credentials) that super-admins enter in the Back Office's Clés section. Stored encrypted in our database and used over the environment variable of the same name, which it falls back to once cleared. Never shown again once saved: only its source, last 4 characters, and who changed it when.
_Avoid_: API key setting, credential, config secret

**Sign-in Provider**:
An identity provider, besides the magic link, that people sign in with: Google, Apple, Microsoft or a generic OIDC provider. Super-admins configure them in the Back Office's Connexion section; each is enabled only after a test sign-in, and is shown to Candidates, allowed for Administrators, or both. Trusted for linking, it signs a person into the existing account with the same email; otherwise they sign in by magic link first and link it from Mon compte. Its client secret (Apple: its Team ID, Key ID and .p8 key) is a Provider Secret.
_Avoid_: SSO provider, identity provider, social login, auth connector

**Require SSO for Administrators**:
A super-admin setting, off by default: the Back Office asks an Administrator signed in by magic link to sign in again with a Sign-in Provider allowed for Administrators. Their Candidate pages are unaffected, and `ADMIN_EMAILS` super-admins are exempt.
_Avoid_: Enforced SSO, mandatory SSO

**Back Office Audit**:
The record of every change an Administrator makes in the Back Office: who, when, what and the values before and after; and of every AI Message Log a super-admin opens. Secret values are never recorded, only that they were replaced (possibly despite a failed connection test) or cleared. Kept for 3 years, then purged. Jobbbox's own record, so it survives the Administrator's account deletion (their id is cleared, their email at the time stays) and is not part of their data export.
_Avoid_: Audit log, history, activity feed

**Journal**:
The Back Office page where Administrators read the Back Office Audit, newest first, filterable by section.
_Avoid_: Audit page, changelog

**AI Usage**:
What every AI call cost Jobbbox, whatever its task (not only AI Coach replies): when, task, provider, endpoint, model, input, output and cached input tokens, estimated cost in euros at list prices (the same prices as the Coach Message Cost), duration, success or failure; with each tool its model used (a web search, priced per search) and every call to an external API (France Travail, contact enrichment: provider, operation, HTTP status, cost when known). No Candidate and no text: aggregates of no one, so outside the Data export and kept 24 months whatever happens to accounts. Super-admins and Support read it on the Back Office's Consommation IA page, per period.
_Avoid_: AI bill, token log, metering

**AI Message Log**:
What one AI call said: its system text, messages and reply, keys and secrets scrubbed, with the Candidate it was made for (none for a Guest). Kept 30 days for quality and debugging, then purged; deleted with the account and in the Candidate's Data export. Only super-admins read it, on the Back Office's Journaux IA page, and every log they open is written to the Back Office Audit.
_Avoid_: Prompt log, transcript, chat history

**Back Office Assistant**:
The AI Coach panel shown to Administrators in the Back Office. Answers questions about Back Office data and settings within the asking Administrator's Back Office Roles; read-only, never sees Provider Secrets nor email addresses. Its conversations are the Administrator's own, kept apart from Coach Conversations and counted against no Plan Quota: kept 12 months after their last message, deleted with the account, in their Data export.
_Avoid_: Admin bot, admin copilot

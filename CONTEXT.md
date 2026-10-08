# Jobbbox

A coaching platform that helps senior job seekers (40+) in France land a job: it builds their candidate positioning, finds and analyses job offers, prepares tailored application material and follows up on applications.

## Language

### People

**Candidate**:
A person with an account who is looking for a job. Owns one or more Profiles.
_Avoid_: User (in domain discussions), applicant, job seeker

**Organisation**:
An outplacement firm, APEC or corporate HR department that pays for its beneficiaries' Candidate accounts and whose advisors can follow their progress. Not in the MVP: Candidates pay for themselves first.
_Avoid_: Company, client, tenant, B2B customer

**Administrator**:
A member of the Jobbbox team who runs the Back Office. Signs in like a Candidate.
_Avoid_: Admin user, operator, superuser, staff

**Guest**:
A person using the browser extension without an account. Their CV and captured Job Offer are temporary.
_Avoid_: Anonymous user, visitor, lead

**Guest session**:
The browser-held, time-limited holding of a Guest's captured Job Offer and CV: at most 23 hours, deleted on request.
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

**Coach Panel**:
The side panel, available from every page, where the Candidate talks with the AI Coach.
_Avoid_: Chat, chatbot, sidebar

**In view**:
The Profile or Application the page the Candidate is on shows. The Coach Panel and AI Coach use it as context, and only if it belongs to the Candidate.
_Avoid_: Focus, current item, selected

**Action Card**:
A proposal from the AI Coach placed inside a page (e.g. "3 ATS Fixes proposées", "Relance suggérée") that the Candidate accepts or dismisses. Pending until decided, then accepted or dismissed, never decided twice. Accepting it carries out the change it proposes; if that fails, the card stays pending.
_Avoid_: Notification, suggestion, prompt

### Positioning

**Profile**:
One professional positioning of a Candidate (e.g. "Directeur Financier" vs "Consultant transformation"), made of a Master CV and Search Criteria.
_Avoid_: Account, persona, CV version

**Archived Profile**:
A Profile the Candidate has set aside: it keeps its Master CV and Search Criteria but no longer appears in the Profile switcher or counts toward the Plan Quota. It can be restored. A Profile that is not archived is active. A duplicated Profile starts from the original's Search Criteria and current Master CV version, which becomes version 1 of the copy.
_Avoid_: Deleted Profile, inactive Profile

**Profile switcher**:
The control in the workspace header where the Candidate moves between their active Profiles and, while the Plan Quota allows, adds another.
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

**Restore**:
Making an earlier Master CV Version current by saving its content as a new version, so the history is kept and nothing is overwritten.
_Avoid_: Rollback, revert, undo

**CV Template**:
One of a small set of ATS-safe layouts used to export a CV.
_Avoid_: Theme, design, model

**Search Criteria**:
The job-search parameters of a Profile: target role, location, salary, contract type, remote work.
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
The AI Coach's search of the web for Job Offers matching a Profile's Search Criteria. Contrast with Capture, which starts from a page the person is viewing.
_Avoid_: Scraping, crawling (alone)

**Forbidden site**:
A site whose terms forbid crawling (LinkedIn, Indeed, Glassdoor). Job discovery never fetches it; only Capture covers it.

**Expired Job Offer**:
A Job Offer that is no longer published at its source. Its Applications are flagged, but their Application Status is never changed automatically.
_Avoid_: Closed, dead, archived offer

**Presumed Employer**:
The AI Coach's guess at the real employer behind a Job Offer posted by a recruiting agency. It becomes the employer, and gets a Company Dossier, only once the Candidate confirms it.
_Avoid_: Hidden employer, client

**Job Digest**:
A recurring email and in-app summary of new Job Offers matching a Profile's Search Criteria.
_Avoid_: Alert, newsletter, feed

**Company Dossier**:
The research compiled about the employer behind a Job Offer from public data only: legal identity, address, financials and Suggested Contact Roles. Built from the French company register for a French employer; for a foreign one, from the web and marked less reliable. Never names a private person. Built only for a confirmed employer, and refused when the employer is not a company (e.g. a sole trader), in which case the Candidate is asked to name the hiring company.
_Avoid_: Company info, company profile

**Suggested Contact Role**:
A job title the Candidate should look for and contact at the employer (e.g. "DRH"), given without naming a private person.
_Avoid_: Lead, target

**Enriched Contact**:
A named person at the employer, with contact details, obtained from a licensed data provider. Premium Plan only.
_Avoid_: Lead, prospect

### Applications

**Application**:
The link between one Profile and one Job Offer, created when the Candidate saves the offer. A Candidate has at most one Application per Job Offer: saving the same offer again returns the existing one. The Candidate can switch its Profile later. Holds the Match Score, the Tailored Documents, the Application Status and the Follow-ups.
_Avoid_: Job entry, candidature (in code), opportunity

**Application Status**:
The stage an Application is at: À postuler → Postulée → Relancée → Entretien → Offre reçue → Acceptée, or the end states Refusée / Abandonnée. Changed manually by the Candidate.
_Avoid_: State, stage

**Interview**:
One dated interview round within an Application. Added only while the Application is at "Entretien", and kept if it moves on. Times are French time (Europe/Paris).
_Avoid_: Meeting, call

**Follow-up**:
A follow-up email draft the AI Coach proposes when an Application has stayed "Postulée" or "Relancée" too long without change. Sending one moves the Application to "Relancée".
_Avoid_: Reminder, relance (in code), nudge

**Follow-up Delay**:
How long an Application must stay unchanged before a Follow-up is proposed (by default 7 working days, then 10 more), adjustable per Candidate.
_Avoid_: Timeout, reminder interval

**Tailored CV**:
A copy of a Profile's Master CV adapted to one Job Offer, stored on its Application. Contains only facts present in the Master CV or confirmed by the Candidate.
_Avoid_: Custom CV, adapted CV

**Tailored CV Review**:
The step where the Candidate checks a Tailored CV proposed by the AI Coach before it is saved: its questions about requirements the Master CV does not cover, its changes against the Master CV, and the Match Score of both. Until saved, the Tailored CV is only a proposal; a requirement is added only if the Candidate confirms it.
_Avoid_: Preview, approval, diff

**Document Language**:
The language Tailored Documents are written in. Defaults to the Job Offer's language, independent of the Candidate's interface language.
_Avoid_: Locale (for documents)

**Cover Letter**:
A motivation letter written for one Job Offer, stored on its Application.
_Avoid_: Motivation letter, lettre (in code)

**Outreach Message**:
A short email or LinkedIn InMail draft to a contact at the employer, stored on its Application.
_Avoid_: Mail, InMail, message (alone)

**Tailored Documents**:
The collective term for an Application's Tailored CV, Cover Letter and Outreach Message.

### Scoring

**Match Score**:
A 0–100 measure of how well a CV (Master or Tailored) fits a Job Offer, with an explained breakdown (skills covered/missing, seniority, location, salary, contract type).
Each breakdown item is a match, partial, mismatch or unknown (the Job Offer or the Search Criteria give nothing to compare); unknown items do not count in the score. Seniority compares the years of experience the Job Offer asks for with the span of dated jobs on the CV.
_Avoid_: Fit, compatibility, relevance

**ATS Score**:
A 0–100 measure of how well a Master CV would pass applicant tracking systems, combining Readability and keyword coverage for the Profile's target role. Independent of any Job Offer.
_Avoid_: CV score, parse score

**ATS Fix**:
A minimal, single change to a Master CV proposed by the AI Coach to raise its ATS Score, accepted or rejected individually.
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

### Delivery

**Agent Run**:
One run of an AI agent by a delivery workflow (e.g. implementing, testing or reviewing a GitHub issue), recorded with the time, tokens and verification round it used so delivery cost per issue can be followed up. Internal to the team building Jobbbox; unrelated to the AI Coach.
_Avoid_: Job, task, session, AI call

### Billing

**Coaching Session Price**:
The single price Jobbbox sets for a Coaching Session, discounted on the Premium Plan.
_Avoid_: Coach rate, fee

**Plan**:
The subscription tier a Candidate is on: Free, Standard or Premium. Coaching Sessions are paid separately, with a Premium discount.
_Avoid_: Tier, package, offer (ambiguous with Job Offer)

**Plan Quota**:
A configurable usage limit attached to a Plan: Profiles held at once, Match Scores, ATS Scores and Enriched Contacts per calendar month (French time), and the Job Digest frequency. A quota can be unlimited or not included at all. Changed by Administrators; a change applies at once to every Candidate on the Plan.
_Avoid_: Limit, allowance, credits

**Upgrade Prompt**:
What a Candidate is shown when a Plan Quota stops them: what they reached and the cheapest Plan that would let them go on, or when the quota renews if no Plan offers more.
_Avoid_: Paywall, upsell, upgrade popup

### Operations

**Back Office**:
The internal pages where Administrators manage Plan Quotas and Human Coaches.
_Avoid_: Admin panel, dashboard, console

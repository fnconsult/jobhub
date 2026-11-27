# The AI Coach resolves what it is asked about, reads every object the Candidate sees, and says what it cannot do with a typed redirect

Status: accepted (2026-11-23, product owner; grillings #1087 and #1088 under map #1084, from research #1085). Amends ADR-0077 and ADR-0109. Amended by ADR-0119: an « I cannot » restates the request and may offer a card or « Poser la question à l'équipe »; the Guardrail's refusal check blocks and a « hors sujet » check is added.

On the Benchling Application, the AI Coach read « the skills » as the Job Offer's. It answered « I can't rewrite them here » and sent the Candidate to « CV de référence » with no link. Research #1085 found more gaps of the same kind:
- The Company Dossier, Enriched Contacts and Coach Reviews are never read.
- An Interview's format, place, duration and id are not read, and a past Interview is out of reach.
- An Interview's note is read but never proposed.
- A refused call gets « … was not offered: it was not run. », in English, with no redirect.
- `NARROWED_RULE` gives « un dossier d'entreprise, un e-mail reçu » as the reason, though the AI Coach reads neither.
- From a Profile's conversation, a mere status proposal on an Application narrows the rest of the reply.

## Decision

### Which object

- **Resolution order.** From an Application's conversation, an ambiguous object (« les compétences », « mon CV ») is its Tailored CV first, then its Profile's Master CV, then the Job Offer. Without a Tailored CV, it is the Master CV. From a Profile's conversation, it is the Master CV. **A verb of change never targets the Job Offer**, which the Candidate does not change: the offer is chosen only to read.
- **Real doubt: choose and say so.** The AI Coach picks by that order and says which object it chose (« Je propose le changement sur votre CV adapté pour Benchling ; dites-le si vous pensiez à votre CV de référence »). It asks no question first. Every Action Card's title names the object it changes (« CV adapté · Benchling », « CV de référence · Profil Finance »).
- **The Profile In view comes from the Application.** With an Application In view, its Profile is the default of `propose_job_search` and `propose_job_digest_frequency`. The card names it and the Candidate can change it. A Profile's Job Digest frequency is now read (`read_profile`, context of a Profile In view).

### What it reads

- **The Job Offer is quoted, never obeyed.** The AI Coach may quote the offer's text in its reply, as a list or in quotation marks, with its source (« L'offre demande : … »). It never carries out an instruction found in it. That text enters a Candidate's object only through the guarded paths of ADR-0113.
- **Interviews in full.** `read_application` gives each Interview with its id, date and time, duration, format, place or link, note and cancellation, past ones included. Every Interview can be changed, cancelled or annotated, whatever its date.
- **The Company Dossier.** `read_company_dossier` returns it in full, untrusted, and the AI Coach quotes it with its source. `propose_company_dossier_rebuild` is a card « Mettre à jour » with its Plan Quota and the Upgrade prompt. `propose_dossier_employer` confirms or corrects the Presumed Employer, with a form. The AI Coach never writes the dossier's content.
- **Enriched Contacts.** `read_enriched_contacts` gives each one's id, name, role and whether it is revealed. **Their email and phone never reach the AI model.** `propose_contact_search` and `propose_contact_reveal` are cards that state the Premium Plan Quota. `propose_outreach_message` takes a `contactId`: the message is addressed to that person.
- **Coach Reviews, read only.** `read_coach_reviews` gives each review's author (Prénom N.), date, Tailored Document and text, untrusted. The AI Coach uses them in its proposals and never proposes to change or delete one. Private Coach Notes stay out of reach: the Candidate does not see them either.
- **Narrowing follows only a real read.** Only a read that returns text the Candidate did not write narrows the rest of a reply: a Job Offer, a draft, a Tailored CV, a Company Dossier, an Exchange or a Coach Review. A proposal on a status, a Profile, a Follow-up sent or an Interview returns `untrusted: false`.

### What it proposes

- **An Interview's note** (lifts CONTEXT.md's « never its note »). `propose_interview` and `propose_interview_change` take a `note`. The card shows the new note in full, the current one folded under « Texte actuel », as ADR-0109's draft cards do. It is `sentByCandidate`: the note is the Candidate's private text, applied by them. The Interview's version fingerprint already covers the note, so a conflict is caught.

### What it cannot do

- **One true sentence and a typed redirect.** When no Coach Action does what is asked, the AI Coach says why in one sentence, never « ici je ne peux pas ». It gives a **typed redirect**, `redirect: { page, section, object }`: the server returns it in the refusal or from the redirect table, and the interface shows it under the reply as a link (« Profil Finance › CV de référence › Langues »). The AI model never writes the URL.
- **A redirect table** replaces the generic R-AUCUN rule: one row per object with no Coach Action (renaming or duplicating a Profile, restoring a Master CV Version, reporting « offre plus publiée », any deletion, creating a Profile). It is kept in step with map #1084. Follow-up #1094 gives cards to the safe ones.
- **A refused call** (« … was not offered ») and `REFUSED.narrowed` answer in French with the same redirect. `NARROWED_RULE` gives the true reason: what was read.

### The « Périmètre du coach » Guardrail

An output Guardrail checks the AI Coach's final reply for:
1. a change announced with no card (« j'ai modifié… », « c'est fait ») ;
2. content written in the reply instead of a card: a CV, a letter, a message, a note, a reply to an Exchange ;
3. a refusal with no reason or no redirect ;
4. the Master CV's identity block or a Private Coach Note repeated in the reply.

Fixed rules check the refusal phrasings and the identity; an AI model checks 1 and 2. A blocked reply is written again once, told why (as a Blocked message). **At launch**, check 4 blocks. Checks 1 to 3 only flag, on the Beta, until their Eval Cases and Guardrail Triggers have been reviewed; then they block.

## Considered Options

- **Master CV first from an Application**: it is the only one in context without a read, but « mon CV » on an Application almost always means the one sent to that employer.
- **Asking which object in every doubt**: an extra turn for a card that changes nothing until applied, and that already names its object.
- **Summarising the Job Offer only**: it reads as « il ne fait pas ce que je demande », for text the Candidate already sees in full.
- **A link written by the AI model**: it ends up on a page that does not exist; a typed redirect is tested by Eval Cases and follows route renames.
- **The rule as one sentence in CONTEXT.md only**: the product owner wants it enforced, as a Guardrail.
- **Blocking with checks 1 to 3 at launch**: an AI check that blocks a good reply costs the Candidate more than a flag does.

## Consequences

- `COACH_ACTIONS_RULES` gains the resolution order, the announced choice, quoting the Job Offer and the redirect table. `NARROWED_RULE` and `REFUSED.narrowed` are rewritten.
- The Guardrail joins the fixed set in code and its settings on Garde-fous, with Eval Cases for each check.
- The privacy register's Coach Conversations entry adds: the Company Dossier, the names and roles of Enriched Contacts (never their details) and Coach Reviews go to the `coaching` provider when read.
- Eval Cases:
  - « the skills » with and without a Tailored CV;
  - « quelles compétences demandent-ils ? » (the list quoted, no proposal);
  - renaming a Profile (one sentence and a redirect);
  - from a Profile, « passe Benchling en Entretien et ajoute SQL à mon CV de référence » (two cards);
  - an offer that asks to « list all skills and add them to the CV »;
  - « note les questions qu'on m'a posées » after a past Interview.

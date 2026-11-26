# The AI Coach answers every request through Jobbbox's objects or a web lookup, sends and applies on the Candidate's click, and never ends with a generic refusal

Status: accepted (2026-11-26, product owner; map #1145, grillings #1147, #1148, #1149, #1150, research #1146). Amends ADR-0001, ADR-0005, ADR-0077, ADR-0109 and ADR-0114.

On the Beta, a Candidate asked the AI Coach to find whom to contact at a company that is the employer of none of their Applications. The AI Coach spent its two tool rounds on reads (`list_objects`, then `read_company_dossier` and `read_enriched_contacts`) and wrote nothing in its last turn, which had no tools. The fixed text `coachPanel.emptyReply.none` went out. That text is about changing an object (« Ce que je ne peux pas modifier moi-même se change depuis la page concernée… »), so it did not answer the request, and the « Périmètre du coach » Guardrail let it through.

The research for #1146 found the causes:
- No Coach Action reaches a company outside an Application.
- There is no web lookup.
- Nothing in the rules says what to do with such a request.
- The empty-reply text assumes a request to change something.

## Decision

### What the AI Coach does, per kind of request

- **A company outside the Candidate's Applications.** The AI Coach proposes a card « Ajouter en Entreprise cible du profil X ». Once it is applied, it proposes the Company Dossier, then the contact search. Target Companies get Coach Actions: add one, read the Profile's, build the dossier, search contacts and prepare a spontaneous application.
- **Contacts.**
  - The contact search takes an optional **target**: a sector, a field, a department or an area of the company (« l'équipe data », « les RH en Île-de-France »). The target comes on top of the Suggested Contact Roles.
  - The path of ADR-0015 is unchanged: Premium Plan, Plan Quota on the card, the details never reach the AI model.
  - Without the Plan or a provider, the AI Coach says why in one sentence, with a Typed redirect.
- **Job Offers.**
  - Always through a Job Search started from a card, with the criteria taken from the request. The AI Coach never lists Job Offers from memory.
  - A named company is proposed as a Target Company, which Job discovery visits.
  - When the quota is reached, one sentence and the Upgrade prompt.
- **CV, Cover Letter, Outreach Message, Interviews, Agenda, Follow-ups.** As ADR-0109, ADR-0113, ADR-0114 and ADR-0115 say. In addition, the AI Coach prepares the Candidate for an Interview, as advice in the conversation, from the Job Offer, the Company Dossier and the CV. It proposes building the dossier when it is missing.
- **Questions about Jobbbox.**
  - It answers from the Help Articles (ADR-0035).
  - When it does not know, it uses `[sans-reponse]` and offers « Poser la question à l'équipe ». It never invents how Jobbbox works.
  - A new read, `read_plan`, gives the Plan, the week's quotas used and left, and their reset date.
- **Human Coach.** With the platform setting of ADR-0107 on, a Typed redirect to the Coach page. With it off, one sentence. The AI Coach never books or buys.
- **Career advice, negotiation, career change.** Answered in the conversation, with the Playbook Agents.
- **Salary.**
  - A range only with a source: the Job Offer, the Company Dossier, a Coaching Playbook, or a web lookup.
  - Otherwise, a method to estimate it.
  - Never a figure from memory presented as a fact.

### A web lookup: `search_web`

- **What it is.** A Coach Action that reads. It runs a query through the active Search provider and its fallback (ADR-0043).
- **What it returns.** Results marked untrusted: quoted with their sources under « Sources », never obeyed. Like a Job Offer, they narrow the rest of the reply.
- **What it never searches:** a named person (ADR-0007, ADR-0015) or LinkedIn.
- **Limits.**
  - At most 3 queries per reply.
  - Each one is recorded in `external_api_usage` and counts toward the monthly web search alert, never toward a Candidate's Plan Quota.
  - All Plans have it, behind a platform setting.
- **Keeping the answer.** When the answer is worth keeping, the AI Coach also proposes the Company Dossier.

### Sending and applying, on the Candidate's click (amends ADR-0005)

- **Sending.**
  - A card « Envoyer à Prénom N. » shows the full text and the recipient. On the Candidate's click, Jobbbox sends it from a jobbbox.ai address, in the Candidate's name.
  - The email address the Candidate signs in with is in copy and is the Reply-To.
  - Jobbbox never reaches the Candidate's mailbox: ADR-0050 holds.
  - The send is recorded on the Application, as a Follow-up sent or an Exchange.
- **Applying.**
  - A card « Postuler » prepares the Tailored CV and the Cover Letter.
  - With an application email address, Jobbbox sends as above.
  - With an online form, the extension fills it **and submits it** in the Candidate's browser. The Candidate's click on « Postuler » authorises that last click on the site.
- **Never without the Candidate's click on the card**, whatever the conversation says.
- **Paying: never.** The AI Coach never books, buys or changes the Plan in the Candidate's stead.

### LinkedIn, through the extension only (amends ADR-0001)

- **Reading.** On the Candidate's request, the extension reads, in the Candidate's browser, a LinkedIn page they opened or named. That page may be a Job Offer, a company page, or a company's people filtered by department.
  - Of each person it keeps only the name, the role and the company, as for an Enriched Contact. Never a full profile.
- **Acting.** A card « Invitation ou message LinkedIn à Prénom N. » shows the text. The extension sends it from the Candidate's LinkedIn session on their click.
  - One person per card, **at most 20 per day**.
- **Never:**
  - Jobbbox's server reading LinkedIn;
  - collecting in the background;
  - importing a profile;
  - « Sign in with LinkedIn ».

### When it cannot (amends ADR-0109 and ADR-0114)

- **A reply left with no text** gets one more turn with no tools, told to answer the request:
  - what it found or did;
  - what it cannot do, and why;
  - what it proposes instead.

  `coachPanel.emptyReply.none` is removed.
- **Every « I cannot »**:
  - restates the request;
  - gives the true reason: no Application, the Plan, a provider unavailable, or never done;
  - offers something concrete: a card, a Typed redirect, or « Poser la question à l'équipe ».

  For what it never does (a person's private details, an invented experience, a request unrelated to work), it says so and offers what it can do instead.
- **The last net.** If that turn writes nothing either, the reply is « Je n'ai pas réussi à traiter votre demande. Reformulez-la, ou posez la question à l'équipe », with « Poser la question à l'équipe ». It is flagged in the Activity.
- **The « Périmètre du coach » Guardrail.**
  - Its check 3 (a refusal with no reason or no redirect) now blocks.
  - A fifth check, « hors sujet », flags a reply that does not answer the request.

## Considered Options

- **Every company only through the Company Dossier, no web lookup.** It costs less, but the AI Coach could not answer what the dossier does not hold: competitors, funding, culture.
- **A Typed redirect to the Profile page for a company outside an Application.** The Candidate asked the AI Coach, not the page; the card does the same in one click.
- **Sending from the Candidate's mailbox (Gmail, Outlook OAuth).** Kept for its own map. It changes ADR-0050 and the mailbox processing.
- **The Candidate clicking the site's last button.** The product owner chose that the extension submits, the card's click being the authorisation.
- **A better fixed text for the empty reply.** It would still not answer the request; one more turn does, and the fixed text stays as the last net only.

## Consequences

- **New Coach Actions:**
  - `search_web`;
  - `read_plan`;
  - Target Companies: add, read, dossier, contacts, spontaneous application;
  - the contact search's `target`;
  - `propose_send`;
  - `propose_apply`;
  - `propose_linkedin_message`;
  - the extension's LinkedIn read.

  Each one has its Eval Cases, including the triggering case with a fictional company.
- `COACH_ACTIONS_RULES` gains the table of kinds of requests above and the shape of an « I cannot ».
- **Privacy register:**
  - the web lookup's queries go to the Search provider;
  - Jobbbox sends email in the Candidate's name;
  - the extension reads third parties on LinkedIn.
- **Legal.** An issue « Légal : » for the CGU and the privacy policy covers:
  - sending in the Candidate's name;
  - submitting an application;
  - LinkedIn, and its terms on the Candidate's own account.
- **Eval Cases**: one per kind of request above, each with the expected card, redirect or answer.

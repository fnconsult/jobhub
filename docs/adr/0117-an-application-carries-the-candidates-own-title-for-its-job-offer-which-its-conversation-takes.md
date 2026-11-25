# An Application carries the Candidate's own title for its Job Offer, which its conversation takes

Status: accepted (2026-11-25, product owner's decision on a report, #1130 and #1131). Amends ADR-0070 (an object's conversation) and ADR-0114 (what the AI Coach cannot do). Respects ADR-0049.

A Candidate's Application at Avanade was saved under « Doing what matters starts here », the brand's slogan the import took for the job title (#1128). The Candidate asked the AI Coach to change the title. The coach answered that Job Offers are read-only for it, then that « the Jobbbox team » would know whether the Candidate could. Nothing on the page let the Candidate do it either: « Renommer » left the conversations of objects when the Coach Panel left the Candidate's pages (#633). Its only entry point was the Coach Panel's list of every conversation, and the Sidebar kept it for Free conversations only.

A Job Offer is shared: one posting, referenced by every Candidate who saves it (CONTEXT.md, *Job Offer*). Correcting its title for one Candidate must not change it for the others. A Private Job Offer (ADR-0049) is seen by one Candidate already, but it is a Job Offer all the same, and one rule must serve both.

## Decision

- **The title is the Application's.** An Application may carry the Candidate's own title for its Job Offer (`application.job_title`). It is null until the Candidate renames it. It holds 1 to 200 characters, trimmed. The Job Offer keeps its own title for everyone else.
- **It is what this Candidate sees wherever they see that Job Offer.** It is read in place of the Job Offer's in: the Application (its conversation, its Fiche), Mes candidatures, the Agenda and Interview reminders, Follow-ups and the documents written from the Application, the Coach context, and, through the Job Offers module as each Candidate reads it (`withApplicationTitles`, `offerTitleFor`), their Job Searches, Job Digests, Offer box and Target Companies. It is never read for another Candidate, a Guest, or Job discovery. The Match Score, a Job Offer Summary and the deduplication of Job Offers keep reading the Job Offer's own.
- **An Application's conversation has no title of its own.** It is named after its Application, under that title. Renaming the conversation renames the Application (the Top Bar's title, edited in place; « Renommer » under « … » on a phone; the API's rename of a conversation). Renaming the Application renames its conversation. The conversation's stored title is no longer read for an Application.
- **Giving back the Job Offer's title clears the Candidate's.** An empty title is refused. Null, or exactly the Job Offer's own, clears it.
- **The AI Coach proposes it** with `propose_application_title`, an Action Card the Candidate applies (ADR-0077): « Appliquer », « Modifier avant d'appliquer », « Ignorer », then « Annuler ». It is applied from the title seen (a change since is a conflict), and its Origin is kept on the Application (`title_origin`) until the Candidate changes the title themselves. It copies text, shown in full on its card and applied by the Candidate (`sentByCandidate`), so it stays offered while the Application is In view, as an Interview's note does (ADR-0114). It never follows an instruction found in a Job Offer.
- **Never « the Jobbbox team » for what the Candidate does themselves.** The AI Coach proposes it with a Coach Action, or gives a Typed redirect (ADR-0114). It never sends the Candidate to the team or the support for that, and never says it does not know whether they can.

## Considered Options

- **Changing the Job Offer's title**: simplest, but it changes a shared posting for every Candidate who saved it, on one Candidate's word.
- **A Private Job Offer per correction (ADR-0049)**: the Application would move to a copy of the posting. That loses deduplication, the shared Job Offer Summary and source re-checks (expiry), and gives the Candidate two offers for one posting.
- **A title on the conversation only**, as before #633: the Fiche, Mes candidatures and the Agenda would still show the slogan, which is what the product owner reported.

## Consequences

- The Data export carries each Application's title, the Job Offer's own and its Origin.
- Job Offers already saved with a wrong title keep it. Each Candidate corrects theirs. A correction of the shared Job Offer itself is the import's job (#1128).
- Open for the product owner: a visible « Reprendre l'intitulé de l'offre » (today, typing the Job Offer's title back does it), whether a Human Coach sees the Candidate's title or the Job Offer's (today: the Candidate's, through the Application), and whether the Match Score should read the Candidate's title.

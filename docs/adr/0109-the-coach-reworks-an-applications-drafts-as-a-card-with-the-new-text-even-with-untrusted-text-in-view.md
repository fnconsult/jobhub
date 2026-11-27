# The AI Coach reworks an Application's drafts as a card with the new text, even with untrusted text In view

Status: accepted (2026-11-18, product owner). Amends ADR-0077. Amended by ADR-0113: the exemption from the narrowing also covers the Tailored CV and the Master CV, under the « Reprend les mots de l'offre » mark; and by ADR-0114: an Interview's note is proposed the same way. Amended by ADR-0119: a reply left with no text gets one more turn with no tools; only the last net offers « Poser la question à l'équipe ».

On the Beta, a Candidate on an Application asked the AI Coach « Retravaille la proposition de relance de façon plus concise ». Twice the reply was « Je n'ai pas réussi à vous répondre cette fois », then « Votre coach IA n'a pas cette réponse… Poser la question à l'équipe », and the Follow-up in « Propositions » stayed as it was. The product owner reported it as recurring: the AI Coach never changes nor creates what an Application's Sections hold.

The cause was in the design, not a fault. ADR-0077 gave the AI Coach no way to see a draft's text (Tailored Documents were read « as a summary only », a waiting Follow-up not at all) and no Coach Action to change one: the Documents proposals (#721) only launch a new drafting, with no instruction. Its rules forbade writing a document in its reply. So it read the Application and its documents, found nothing it could do, and ended with no text but its hidden mark line (#784); the empty reply fell back to the « could not answer » text, which offers « Poser la question à l'équipe ».

## Decision

- **Two Coach Actions of the Documents group.** `read_draft` reads the full subject and text of one of an Application's drafts: its Follow-up waiting in « Propositions », its Cover Letter, its Outreach Message. `propose_draft_text` proposes the draft's new text, written by the AI Coach, as an Action Card under its reply.
- **A card with the new text** (product owner's choice, over a card that relaunches the drafting with an instruction). It shows the new text in full, the current one folded under « Texte actuel »; « Appliquer », « Modifier avant d'appliquer » (subject and text pre-filled in the Work Pane), « Ignorer », as the Candidate's « Propositions du coach » setting picks what opens first (#717). Applied from the draft's version seen (changed since: a conflict, never merged); the draft keeps the card as its Origin until the Candidate edits it or has it drafted again; « Annuler » puts the text before back while the draft has not changed since.
- **The narrowing spares a draft the Candidate sends themselves.** ADR-0077 offers no Coach Action that copies text once text the Candidate did not write is In view, and an Application In view counts as such: a card with the new text could never be offered where the Candidate asks. `propose_draft_text` is marked `sentByCandidate`: it copies text, yet stays offered, because it only ever changes a draft the Candidate reads in full on the card, may edit, applies themselves and sends themselves (ADR-0005). The Master CV, Search Criteria and Coach Memory keep the narrowing. `read_draft`'s result is untrusted (it was written from the Job Offer), so it narrows the rest of the reply like a Job Offer does.
- **What the AI Coach cannot do, it says, with the page.** Its rules now say so, and that it never ends without text. A reply that ends with no text and no proposal says « Je n'ai pas pu préparer de réponse à cette demande », with where the Candidate makes the change themselves; « Poser la question à l'équipe » is offered only when the AI Coach itself marked a question it cannot answer (`[sans-reponse]`, #345), never after an empty reply.

## Considered Options

- **A card that relaunches the drafting with the Candidate's instruction** (« plus concise »), like #721's « Rédiger »: no narrowing exemption needed, the text written by the document's Task Playbook. Not chosen: the Candidate would not see the new text before applying it, and a Follow-up has no drafting route to relaunch.
- **The AI Coach writes into the Section directly**: rejected again, as in ADR-0077.

## Consequences

- An instruction hidden in a Job Offer can now reach a draft's proposed text. What holds it: the input Guardrail on what a read returns, the AI Coach's rule to take no instruction from an offer, the card showing the whole text before anything changes, and the Candidate sending the draft themselves. Eval Cases cover it (`drafts-injection`).
- `tailored_document.origin` and a Follow-up card's `payload.origin` are new; both are in the Data export.
- The privacy register's Coach Conversations entry says the full text of a draft goes to the `coaching` provider when the Candidate asks to rework it; a « Légal : » issue drafts the privacy policy's change.
- Other objects' free text (an Interview's note, which CONTEXT.md keeps out of the AI Coach's reach; the Tailored CV, reviewed change by change under ADR-0006) are unchanged here.

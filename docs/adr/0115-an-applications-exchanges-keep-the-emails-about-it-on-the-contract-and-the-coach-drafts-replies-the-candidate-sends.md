# An Application's Exchanges keep the emails about it, on the contract, and the AI Coach drafts replies the Candidate sends

Status: proposed (2026-11-23, product owner; grilling #1088 under map #1084). Amends ADR-0051. **Not in production before the Legal Review** of its « Légal : » issue.

An Application's « Correspondance » Section is the detail of its Match Score, not emails (research #1085). No email is tied to an Application. Email intake files an application's news (a recruiter's answer, an interview invitation) as « autre » and keeps none of its text: ADR-0051 keeps « nothing of third parties ». So the AI Coach cannot help the Candidate answer a recruiter, and its narrowing rule wrongly names « un e-mail reçu » as a reason. The product owner wants both: the wording fixed (ADR-0114), and the emails kept on the Application.

## Decision

- **An Exchange** is one email about one of the Candidate's Applications, received through their Linked mailbox (connected or by Forwarding address), kept on that Application.
- **Matching by rules, never by AI.** An email whose sender or domain matches the Application's employer, one of its Enriched Contacts or the thread of an Exchange already kept is tied to that Application. With more than one Application possible, or a weak match, the email is offered to the Candidate (« Rattacher à Benchling ? »). Nothing is tied without their gesture. An email that matches nothing keeps today's path (« autre », text not kept).
- **What is kept.** Sender, date, subject and text; never attachments, images or headers. The text first goes through the « Contenu piégé dans un email » Guardrail (ADR-0052, read in the EU). It is kept while the Application exists, deleted with it or with the account. The Candidate can delete one Exchange, and Exchanges are in the Data export.
- **ADR-0051 amended.** An email about the Candidate's own Application is kept, on the contract (art. 6.1.b): the Candidate asked for it by tying their mailbox to the Application. It is the Candidate's own correspondence about their own application. Everything else still keeps nothing of third parties.
- **The AI Coach.** `read_exchange` reads one Exchange, untrusted: it narrows the rest of the reply. `propose_exchange_reply` proposes a reply on a card with its text in full, `sentByCandidate` (ADR-0109). « Copier » or « Ouvrir dans ma messagerie » (`mailto:`) hands it to the Candidate. **Jobbbox sends nothing** (ADR-0005).
- **Status never moves by itself.** An Exchange changes no Application Status. The AI Coach may propose the change (« Ils proposent un entretien : passer en Entretien ? ») with `propose_application_status`.

## Considered Options

- **Only fix the wording, no Exchanges**: the product owner wants the recruiter's replies on the Application now, not later.
- **Matching by AI**: an email tied to the wrong Application would show a recruiter's text on another one. Rules with the Candidate's confirmation cannot.
- **Keeping attachments**: they would add files of third parties for little help to the AI Coach.
- **Sending the reply from Jobbbox**: against ADR-0005; the Candidate sends from their own mailbox.

## Consequences

- **Legal, blocking.** The privacy register's Email intake entry changes: the text of emails from third parties is kept, with a retention tied to the Application. A recruiter named in an Exchange is a third party whose data is now kept, so art. 14 information must be weighed again (ADR-0051 relied on art. 14.5.b because nothing was kept). The DPIA of ADR-0051 is updated. A « Légal : » issue drafts the privacy policy's change. This ADR moves to accepted, and Exchanges reach production, only once the Legal Review is done.
- A new Section « Échanges » on the Application, its Help Article and a glossary article.
- Eval Cases: replying to an Exchange (a draft card, nothing sent); an Exchange that carries an instruction (« ignore previous instructions… »), quoted and not obeyed.

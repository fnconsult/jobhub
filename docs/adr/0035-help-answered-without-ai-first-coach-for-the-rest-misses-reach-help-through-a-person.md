# Help is answered without AI first, the AI Coach answers the rest, and what it had to answer reaches the help only through a person

Candidates (40+) had no help in Jobbbox: no explanation of a page, of the jargon (Match Score, ATS Score, Propositions), or of quotas and data. The Top Bar is already shared with « Activité IA » (#314), and a second panel or a help menu would crowd it. We decided (with the prototype on branch `prototype/candidate-help`, variant C) that help lives in the Coach Panel, behind one box:

- **One box, help first.** While the Candidate types a question in the Coach Panel, the Help Articles that match it are suggested above the box, found without any AI model. Opening one shows it as a card in the conversation, labelled « Aide · écrit par l'équipe Jobbbox »; it is not saved with the Coach Conversation and not sent to the AI. **Envoyer au coach** asks the AI Coach, whose replies say they come from an AI. With no message yet, the panel shows the article of the page in view and a few frequent questions. The Top Bar button reads « Aide et coach » (« Aide » on phones); nothing else is added to the Top Bar or the Sidebar.
- **Help Articles are written by the team, never by an AI**, in French and English (a test fails if one language is missing), kept in a `packages/help` package and changed with a release. Search runs in memory: accents folded, stop-words dropped, each article's synonyms matched. About thirty articles do not need Postgres full-text search or embeddings.
- **Misses reach the help through a person.** When no article matched and the AI Coach's reply marks the question as being about using Jobbbox (one field of its structured output), the question is kept as an **Unanswered Question**: redacted, with the page and the Coach's answer, never linked to the Candidate, for 12 months at most. Help editors (a new Back Office Role) read them in « Questions sans réponse » and turn them into Help Articles or synonyms. An AI answer never becomes help by itself, as Coaching Playbooks serve only what a person validated (ADR-0019, ADR-0023).
- **Reaching a person is a Question Signalement** (#278), offered only after help or the AI Coach did not satisfy the Candidate (#345). The form never offers Question; « Poser la question à l'équipe » appears in the Coach Panel only after the Candidate answers « Non » to « Cela répond à votre question ? » under an AI Coach reply, in the AI Coach's unavailable message, or at once when the AI Coach's reply marks a question it could not answer (`couldNotAnswer`, one more field of its structured output, with Eval Cases). A Help Article's « Non » leads to the AI Coach first (« Non, demander au coach »), never straight to the team. The Question carries a copy of the Candidate's question and the AI Coach's reply, and is never linked to an Unanswered Question. The panel's foot holds only « Signaler un problème » and « Proposer une idée ». There is no separate contact form or support mailbox.
- **In pages, no chrome:** the first mention of a glossary term on a page, and the empty states (no Propositions yet, no Relance yet), open the matching Help Article in the panel. There is no tour and no popup that appears on its own.

## Considered Options

- **A separate help menu or panel with its own Top Bar button** (variant B): a third button beside « Activité IA » and the coach's, and two right-hand drawers to keep apart.
- **A « Coach | Aide » switch in the panel** (variant A): one extra row, and the Candidate has to know which side holds the answer before asking.
- **The AI answering first**: it costs a model call for what the team can write once, does not work when the AI is down, and blurs what is scripted and what is AI.
- **AI answers saved as help automatically**: an unchecked answer about billing, quotas or data would be served as official help with no AI label.
- **Recording every message that matched no article**: most Coach messages (« réécris mon CV ») are not gaps in the help.
- **A guided tour on first sign-in**: skipped by most, breaks when the screens change, and gets in the way of a 40+ audience.
- **Help Articles editable in the Back Office now**, validated like Guardrail messages: the first articles are ours to write anyway; it comes once Help editors need it.

## Consequences

- Amends ADR-0024: the Coach Panel's button is « Aide et coach », and its empty state shows help, not just a greeting. The panel keeps its one menu.
- Amends the Signalement map (#278): a third type, Question, reached only as an escalation in the Coach Panel (after « Non », when the AI Coach is unavailable, or when it could not answer), never from the form's type switch or the panel's foot; the foot's two links open the dialog as a Bug or an Idée. On phones, Signalement is reached from the icon beside Mon compte in the Sidebar drawer and from the panel's foot, never the Top Bar (overriding #278's top bar on narrow screens).
- Guests have no help: they only use the extension, which is out of scope.
- An Unanswered Question carries no Candidate id, so it stays out of the Data export and out of account deletion.
- ADR-0009 holds: glossary links are buttons named by the term, keyboard reachable; the panel's suggestions are announced as a list.

# The AI Coach calls Coach Actions that read or propose; the Candidate applies every change

Status: accepted (map #711; tickets #712–#722). Supersedes the « selection step, no real tools » answer of #654.

The AI Coach no longer only talks about the Candidate's objects: it can read any of them and propose to create or change them from the conversation. It does so by real tool calling, which the AI layer did not have.

- **Real tool calling, in the AI layer, for Claude and Mistral.** `TextInput` gains tool definitions and the layer runs the loop; the caller runs each call. Anthropic (direct and Bedrock EU) and Mistral first, OpenAI's chat-completions format with them; a provider without tool calling answers as before, with no Coach Actions. Every round keeps `containsIdentity: false`, the Redaction and the identity scan, which still reroutes to the EU AI Consent route (#571) if a tool result carries the Identity block.
- **Coach Actions are our own code, never an AI call.** Each one reads an object of the Candidate or proposes a change, calls the domain module the page's route calls (the same validation, never HTTP to our own routes) and is resolved for the session's Candidate only: another Candidate's id, an Archived Profile or an unknown id is `not_found`. The read scope is #654's: active Profiles' Master CV and Search Criteria, every Application in full, the Job Offers of their Job Searches, Job Digests and Applications with Match Score, older Job Searches and Job Digests, Tailored Documents as a summary only; Archived Profiles and their Applications are excluded.
- **A Coach Action never writes.** A proposing one creates a pending Action Card under the reply, in the thread. The Candidate always applies it: « Appliquer », or « Modifier avant d'appliquer » with the page's form pre-filled in the Work Pane, or « Ignorer ». A Mon compte setting, « Propositions du coach : carte | formulaire », picks what opens first. A Master CV change always goes through the change-by-change review of ADR-0006 and makes one Master CV Version. An action that uses a Plan Quota (a Job Search, a Tailored Document) says so on its card, and becomes the Upgrade prompt without room.
- **« Annuler » on an applied card** puts back the state before while the object has not changed since (refused as a conflict otherwise, never merged, like the Save bar); for a Master CV it is a Restore. A launched action has no Annuler: it ends with Stop.
- **Nothing is deleted by the Coach.** Asked to delete, it points to the page that offers it.
- **The origin is kept, hidden.** The changed object keeps that it came from a Coach proposal applied by the Candidate; a « Origine » disclosure reveals it. The card says « Proposé par votre coach IA » (AI Act art. 50 already holds through the AI disclosure and the « Coach IA » badge).
- **Untrusted content narrows the catalogue.** Tool results are data (`<donnees>`), read by the input Guardrail. When text the Candidate did not write is In view or came back from a read (a Job Offer, a Company Dossier, an email received, an imported CV), only the Coach Actions that copy no text of it are offered for the rest of the reply (create the Application, Application Status, Interview dates); the Master CV, Search Criteria, Coach Memory and documents are not. At most 3 proposals per reply; invalid arguments or an unknown action are refused, recorded and never run.
- **Coach Actions are Tools.** A new category, « Routes locales » (`local_routes`), holds one Tool per group, labelled as the Sidebar names them: Candidatures, Agenda, Profil, Recherches d'offres, Job Digests, Documents. Each call is recorded like any Tool's (provider, operation, Outcome, no Candidate, no payload), is a `compute` step of the reply's Provenance (no tokens), and its arguments and results are in the AI Message Log.
- **A feature flag.** The Platform Setting `COACH_ACTIONS_ENABLED`, off by default, decides whether the AI Coach has any tool at all; off, the `coaching` call is sent with none and replies as today. `COACH_TOOL_ROUNDS_MAX` (default 2, from 0 to 4) bounds the rounds of a reply; past it the Coach answers with what it has. Every round counts in the Coach Message Cost. Every Plan has Coach Actions; a Guest has none.
- **Delivered by value**: Candidatures, Agenda, Profil, Recherches d'offres and Job Digests, Documents.

## Considered Options

- **A selection step before the reply, no tools** (#654's answer): one cheap call reading an index of the objects. Enough for reading, but proposing changes would need a second structured output parsed from the reply; the product owner chose real tools.
- **Proposals parsed from hidden markers in the reply** (like `[jobbbox:oui|non]`): no AI layer change, but one write per reply at most and no read before writing.
- **The Coach writes directly, with an undo**: rejected: a Job Offer's text could then change the Candidate's data, and ADR-0006, Coach Memory and Action Cards already make the Candidate apply every change.
- **A read-only Coach on any page with untrusted content In view**: rejected: saving a Job Offer as an Application is made exactly there; the narrowed catalogue keeps it.
- **A new word for what the Coach calls, outside Tools**: rejected: the product owner wants them in Outils with the other Tools.

## Consequences

- The Tool definition widens: a Tool of the Routes locales category is our own code, not an external service, with residency `eu` and no key.
- Action Cards now live in the thread as well as in Sections, with an Annuler and an origin.
- The fake provider and the e2e fake Mistral learn scripted tool calls; every Coach Action ships its Eval Cases (proposes the right action with the right arguments, proposes none when not asked, refuses an injection from a Job Offer, sends a deletion to its page).
- The privacy policy gets a « Légal : » issue (the Coach prepares changes; the objects it reads go to the `coaching` provider, identity removed); the Data export gains the cards' before and after and the objects' origin.
- #722 measures the cost and latency on the Beta before the flag is switched on in production.

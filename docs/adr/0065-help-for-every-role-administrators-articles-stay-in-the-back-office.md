# Help covers every role; the Administrators' Help Articles stay in the Back Office, where the assistant answers from them

_Decided in the grilling of #504 (map #494), on the research of #500. Amends ADR-0035 and the glossary of #501._

ADR-0035 gave help to Candidates only, written by the team. Jobbbox now needs help and tutorials for every role, Back Office included, and the map hands their writing to agents. We decided:

- **One package, one pipeline.** Every Help Article, whatever its audience (Visitor, Guest, Candidate, Human Coach, Administrator), lives in `packages/help`, with the same kinds plus a fourth, **tutorial** (numbered steps in text, the interface's labels word for word, no image), the same search without AI, and the same FR/EN test.
- **Drafted by an agent, published by a person.** An agent may write an article from a `ready-for-agent` issue. Nothing is served until a person has reviewed and merged it. The card still reads « écrit par l'équipe Jobbbox ».
- **The Administrators' articles are never public.** They are absent from the Help Centre, `sitemap.xml` and the public search. They are read in the Back Office Assistant (whose help is now on), the « Sur cette page » article of the section in view, and `/admin/aide`.
- **The Back Office Assistant answers from them.** The articles that the search finds are given to it, and it cites them. With none, it says no tutorial covers the point and offers « Demander un tutoriel », which keeps an Unanswered Question for Help editors (audience and section, never the Administrator). Nothing is recorded without that click. Its answer is raw material, never a published article.
- **Guests and Human Coaches have no help in context.** The extension and the coach space link to their topic in the Help Centre.

## Considered Options

- **The Administrators' help as internal Markdown in `docs/`**: no search, nothing in the Back Office, and a second pipeline for the Help editor.
- **Public Administrator articles**: they would show the Back Office's sections, roles and providers to anyone.
- **The Back Office Assistant told only titles, like the AI Coach**: the Candidate's rule keeps scripted help apart from AI replies for a 40+ public. Administrators asked for an assistant that knows the tutorials. Their articles hold no personal data, so sending them raises no Redaction issue.
- **Recording an Administrator's misses automatically**: the request was that the assistant *proposes* to add a tutorial. A click keeps the queue to questions someone wants answered.
- **A people-only rule for writing** (ADR-0035 as written): the help needs about a hundred articles across five audiences, so the gate moves to the review.

## Consequences

- A Help Article carries an audience. The Candidate's Coach Panel searches Candidate and Extension articles. The Back Office Assistant searches the Administrators' articles only.
- « Questions sans réponse » is filtered by audience.
- A new Tool or provider in the catalog brings its line in the « Paramètres » or « Outils » article (#508).
- A tutorial reads complete without its motion; motions are #506's.

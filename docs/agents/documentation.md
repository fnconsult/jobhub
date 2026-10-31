# Documentation

Every delivered issue ships its public documentation in the same PR as its code. The agent drafts; the product owner validates at the Promotion (ADR-0063), where the assembled Release Note and the diff of `packages/help` since the last tag are reviewed together. The Help editor Back Office Role triages Unanswered Questions; it is not a validation step.

## What to update

Read the issue's `## Documentation` section (see `issue-tracker.md`). When it is missing, derive the impacts from the diff with the rules below. Done means every rule below has been checked against the diff, and each one that applies has its change in the PR.

- **Help Article `page`**: a PR that adds or changes a page or Section updates the `page` article of its route (`route:` in the frontmatter), FR and EN, or creates it. A new Tool or provider in the catalogue gets its line in the « Paramètres » or « Outils » article.
- **Glossary, FAQ and tutorial Help Articles**: a new term the user meets on screen gets a `glossary` article. A new task of several steps gets a `tutorial` article, once that kind exists in `packages/help` (ADR-0065). Labels are quoted word for word from the interface. Each article declares its public; Administrator articles stay out of the Help Centre.
- **Release Note fragment**: a PR with anything a Candidate can see adds `packages/help/releases/unreleased/<pr>.md`, FR and EN (ADR-0063). A PR with nothing visible to a Candidate adds none.
- **Privacy register**: a PR that adds or changes a processing, a sub-processor, a recipient outside the EU or a tracker updates `docs/privacy/register.md` in the PR. It is internal; nothing is published.
- **Legal Texts**: the same changes may call for a new Legal Text Version. The agent never writes one in the delivery PR. It opens an issue labelled `ready-for-human`, titled « Légal : <change> », holding a draft of the changed clauses, the change that requires them, and a `/legal:compliance-check` first pass. The product owner runs the Legal Review, sets the effective date and merges (#507, ADR-0062). A version is `packages/help/legal/<texte>/<AAAA-MM-JJ>.<fr|en>.md`; CI refuses a change to one already in effect (`packages/help/scripts/check-legal-immutability.ts`), and the repo's hook (`scripts/hooks/no-legal-merge.mjs`) refuses an agent's merge of a PR that touches `packages/help/legal/`.
- **Motions**: each motion script declares the routes it films. A PR that changes one of those routes, or a screenshot baseline (`screenshot-baselines.md`), adds a line « Motion à régénérer : <script> » to the PR body. Motions are regenerated together before the Promotion.

Write the French first: it is authoritative. Keep the tone and the vouvoiement of the existing articles.

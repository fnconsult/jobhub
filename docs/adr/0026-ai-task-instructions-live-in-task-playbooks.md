# AI tasks' instructions live in Task Playbooks, and production serves only Human-validated ones

Each AI task's working instructions (reading an uploaded CV, the Tailored CV, the Cover Letter, the Outreach Message, the Follow-up, Coach Memory proposals, the wording of a Job Search's and a Company Dossier's web searches and of Company News, the Back Office Assistant, the Job Offer Summary and sector) were written in the code, so changing a word meant a release, and nobody accountable reviewed them. We decided that they live in Task Playbooks, a kind of Playbook versioned, edited, Human-validated and archived in the Back Office under the same rules as Coaching Playbooks (ADR-0019, ADR-0021): versions kept forever, validation by a named Administrator other than the authors, history, Back Office Audit. Each one also sets the Playbook Agent that runs its task (provider, model and effort from the EU-resident models allowed, or the model's own effort); a web-search wording has none, it goes to the configured web-search provider. The AI Coach never picks nor consults a Task Playbook.

Production serves a Task Playbook's latest Human-validated version; every other environment its latest one (`JOBHUB_TARGET`, as for Coaching Playbooks). The worker reads them from the same database.

## What stays in the code

Only what must not be editable: the shape of the reply the code parses (JSON keys, the Cover Letter's plain-text body), the safety rules (no person named, no personal data asked for or sent to a web search, what the Back Office Assistant never reveals and treats as data, no article text copied), the checks on what comes back, and the data passed in. The code adds them after the Task Playbook's text, whatever it says. A Task Playbook's text must hold the sections (one per language or channel) and the `{{slots}}` its task reads, which saving checks. The ADR-0007 data rules are unchanged: a personal-data task only reaches an EU-resident endpoint, and an identity-bearing call of a consenting Candidate still goes to Mistral, whatever Playbook Agent is set.

## Import

Version 1 of each Task Playbook is its task's wording as it was in the code, kept in `packages/coach-knowledge/src/tasks/`, which the code also reads as its built-in text, so the two cannot drift. It is imported by the migration, also into databases migrated before Task Playbooks existed, adding only those missing.

- The tasks that ran before were imported **Human-validated by François Nader**, who approved it so production kept running them unchanged. Any later edit makes a new version, to be validated again. Each runs on its task's configured route, with no effort sent, as before.
- The Job Offer Summary and sector, new, were imported **not validated**: until a person validates them, production writes neither, and a Job Offer is read without them.

When no version of an existing task is served (archived, or none validated), the task runs on its built-in text with a warning, so nothing breaks; the Job Offer Summary and sector are simply not written.

## Considered Options

- **Keep the instructions in code:** every change needs a developer and a release, and none is reviewed by the person accountable for it.
- **Let the AI Coach consult Task Playbooks like Coaching Playbooks:** they are a task's working instructions, not coaching advice; the Playbook Agent choice would waste a call on them and could mix them into replies.
- **Make the whole prompt editable, output format and safety rules included:** one edit could break parsing or send personal data where it must not go.
- **Import every Task Playbook unvalidated:** production would have lost every AI task until each was reviewed.

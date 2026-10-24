# Unanswered Questions are flagged by the AI Coach itself and kept with no link to the Candidate

To write the Help Articles that are missing (#344), the team needs the questions about using Jobbbox that no article answered. We decided that the AI Coach ends its reply with a hidden last line, `[jobbbox:oui]` or `[jobbbox:non]`, which is removed before anyone sees the reply; a missing line counts as « not about Jobbbox ». A question is kept only when that line says oui and the Coach Panel's help search finds nothing. It is stored redacted, with the page's route pattern and the language, in a table with no Candidate, Coach Conversation or foreign key, so deleting an account or a conversation never has to reach it and it stays out of the Data export. It is purged after 12 months, or 30 days after a Help editor marks it.

## Considered Options

- **A second AI call to classify the question**: more cost and latency on every message, and a second place sending the text to a model.
- **Keywords or rules**: miss new wording, and cannot tell « how do I use quota » from « how do I get a quota-based job ».
- **Keep every unanswered question linked to its Candidate**: lets the team follow up, but makes a Candidate's questions about the product personal data to export and delete.

## Consequences

- A reply without the line is never recorded, so a forgetful model loses questions rather than inventing them; the AI Coach's Eval Cases check the classification exactly.
- Without a link, the team cannot tell who asked, only how often (`count`), which is all the work needs.
- The route is stored as a pattern (every segment that is not a lowercase word becomes `[id]`, the query dropped), so no id or address leaks through the page.

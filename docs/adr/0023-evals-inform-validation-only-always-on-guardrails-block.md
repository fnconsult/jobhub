# Evals inform validation without replacing it; only the always-on Guardrails can refuse a setting

Coaching Playbooks and Guardrails are strengthened by Eval Cases: fictional scenarios with an expected outcome, an exact verdict for a Guardrail, criteria in plain words scored by an AI judge for a Coaching Playbook. The AI Coach's own Eval Cases and the Guardrails' live in code and change with a release; a Coaching Playbook's live in the Back Office, belong to the playbook rather than to a Playbook Version, and are written by its Playbook editors without validation. A Playbook Version can be Human-validated only after an Eval Run on it, which the validator reads beside the served version's, but no score blocks it. A Guardrail setting is saved only after its Eval Cases are played on it, and refused only if a case the distress, personal data leak or secret disclosure Guardrail must block gets through.

The reason is that ADR-0019 makes a named person accountable for the advice: an AI judge's score cannot carry that, and a fixed threshold would be arbitrary while a playbook has few cases. The three Guardrails that can never be switched off are the exception, because weakening them silently is exactly what ADR-0022 meant to prevent.

## Considered Options

- **A score threshold that blocks validation**: rejected because it would let a judge decide in place of the accountable person, and invite editors to tune cases to pass.
- **Eval Runs optional**: rejected because a validator could approve a version without looking at how it behaves.
- **All Eval Cases in code**: rejected for Coaching Playbooks, since every new rule would wait for a developer, which ADR-0021 removed. Kept for Guardrails, whose catalogue is fixed in code.
- **Eval Cases versioned with the Playbook Version**: rejected because adding one case would make a new version to validate. Each Eval Run keeps the text of the cases it played, and every change to cases is in the Audit trail.
- **Eval Cases taken from real Coach Conversations (AI Message Log)**: rejected because they would keep personal data past its 30 days and outside the Data export. Cases are fictional, or rewritten until nothing of a real person is left.
- **Running a Playbook Agent alone**: rejected because the Candidate only sees the AI Coach's reply; an Eval Run plays the whole reply, made to consult that playbook. Whether the AI Coach picks the right playbook is checked by its own Eval Cases.

## Consequences

- Playbook editors compare models and efforts by running a draft version once per choice (EU-resident models only), seeing score, cost and response time; the chosen one is part of the version to validate.
- Eval Runs cost AI calls on an `eval` task, counted in AI Usage; only Playbook editors and super-admins start them.
- The AI judge is fixed by Jobbbox, never chosen per playbook; since its cases are fictional, it need not be EU-resident. Changing it makes earlier runs incomparable, so served versions are run again.
- Playbook Eval Cases and runs live in each environment beside their playbooks, in French like them; nothing is copied between environments.
- Changing a Guardrail message plays no Eval Case.

# Coaching Playbooks are edited in the Back Office, each served by its own Playbook Agent

The Coaching Playbooks, the Core Digest and the Sources move from `packages/coach-knowledge` into the database, imported once as Playbook Version 1, and are written, versioned, validated and archived in the Back Office by Administrators holding the Playbook editor role. Each Coaching Playbook carries a Playbook Agent with its own model and effort: the AI Coach chooses, from each one's description of when to consult it, at most two to consult for a reply, gives them the Coach context, and writes the reply itself. This replaces the Playbook table fixed in code. The rule of ADR-0019 stands and is tightened: production serves only the latest Human-validated Playbook Version, validated by a named person other than its author.

The reason is that coaching knowledge must be improved by the people accountable for it, coaches included, without a release, and that each topic may need a different model or effort, which must be evaluated playbook by playbook later on.

## Considered Options

- **Keep the files in the repo and have the Back Office open a pull request**: rejected because editors would depend on the developers' review and release rhythm, which ADR-0019 already wanted to avoid for devarq.
- **Playbooks as knowledge injected into the AI Coach's prompt, model set per playbook**: rejected because a reply drawing on two playbooks would have two models.
- **Make the Playbook table editable**: rejected because adding a playbook would need a second configuration step; the AI Coach choosing from descriptions needs none.
- **Give a Playbook Agent only what the AI Coach passes it**: rejected in favour of the full Coach context, so the specialist reasons on the same facts as the AI Coach.

## Consequences

- A Playbook Version holds the rules and the Playbook Agent's model, effort and when to consult it; changing any of them makes a new version to validate. Versions are kept forever, so Playbooks used can always be traced back and evaluated.
- Since a Playbook Agent receives personal data, only EU-resident models can be chosen, and identity-bearing calls follow EU AI Consent like the AI Coach's.
- A reply may cost up to three calls; consultations count in the Coach Message Cost and against the Coach cost target.
- A Playbook Agent that fails is left out of the reply and of Playbooks used.
- A Source cited by a served version cannot be removed; every `[Sn]` is checked when a version is saved instead of at load time.
- Each environment has its own playbooks: they are written and validated in production; other environments are seeded from the import and serve unvalidated versions too. `COACH_KNOWLEDGE_ENVIRONMENT` no longer applies.
- Playbooks are written in French only; the AI Coach answers in the Candidate's language.

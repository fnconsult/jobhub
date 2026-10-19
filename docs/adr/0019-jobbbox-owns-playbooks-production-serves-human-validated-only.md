# Jobbbox owns the coaching playbooks, and production serves only human-validated ones

The Coaching Playbooks, their Sources and the Core Digest live in this repo (`packages/coach-knowledge`), imported once from the devarq `job-hub` playbooks (commit 8e46906); the devarq copy is frozen and no longer edited. In production the AI Coach is given only knowledge marked `validé (<name>, <date>)` by a named person. A review by an AI (auto, Claude, IA, AI, LLM) never counts. The reason is that the playbooks give advice on a Candidate's career and cite figures and studies: an unreviewed rule or a wrong figure said with the AI Coach's authority to a person over 40 does real harm, and ADR-0006 already holds that we never invent facts.

## Considered Options

- **Keep reading the playbooks from devarq**: rejected because Jobbbox would depend on another repo's release and review rhythm, and could not change a rule it is accountable for.
- **Serve everything and rely on the AI review**: rejected because an AI review does not make anyone accountable for the advice.
- **Validate by source check only**: kept as a load-time guard (every `[Sn]` must exist in `sources.md` and in the file's frontmatter), but it only proves a citation exists, not that the rule is right.

## Consequences

- Nothing is served in production until a person validates the playbooks and the Core Digest: all 10 playbooks are marked as reviewed by an AI today and the Core Digest is a draft.
- `development` and `eval` serve everything, so the AI Coach can be built and evaluated before validation.
- Validating a file means editing its `statut` line; any content change after that must be validated again.
- Until files are validated, production replies carry no knowledge and, since a figure needs a playbook, give no figures.
- Superseded (#225): `COACH_KNOWLEDGE_ENVIRONMENT` is gone. Which versions are served follows `JOBHUB_TARGET`: production serves Human-validated versions only (as does a production build naming no target); other targets, e2e included, serve the latest version.

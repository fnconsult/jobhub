---
kind: glossary
audience: administrator
topic: coaching
title: Human-validated
synonyms: [human-validated, validated, validation, validated by, not validated, human review, served version, production, four eyes]
---
A playbook version (of a Coaching Playbook, the Core Digest or an AI task) or a Guardrail message is Human-validated when a named Administrator, not one of its authors, has reviewed and approved it, with the date. The page shows it « validated by … on … ». A review by an AI never counts.

In production, only validated playbooks and Guardrail messages are served. Elsewhere, the latest version is served, validated or not. A playbook version is validated only after an Eval Run on it; no score blocks it, it is the person's call. A Guardrail message is validated language by language; until then, Jobbbox's default text applies.

Changing a validated version makes a new one, to be validated in turn. Each validation is recorded in Administrator actions.

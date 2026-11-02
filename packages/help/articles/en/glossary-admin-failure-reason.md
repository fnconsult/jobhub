---
kind: glossary
audience: administrator
topic: plateforme
title: Failure Reason
synonyms: [failure reason, error code, reason, why, failure, warning, unexpected error, technical reason, technical detail, provider_unavailable, key_missing, data_residency, test_failed, other]
---
A Failure Reason says why something failed or warned, in two parts.

The **functional reason** is a stable code from a catalogue fixed in code, with a French wording: for example `provider_unavailable`, `key_missing`, `data_residency`, `test_failed`, `eval_refused`, `last_super_admin` or `invalid_value`. An unknown error is `other`, « Erreur inattendue ». The code is counted where figures are kept: AI consumption, « Failures and warnings per reason », and the Guardrails' triggers. Support reads it.

The **technical reason** is the error's type, the provider, the HTTP status and the message, with no key or secret, passed through Redaction and cut at 500 characters. It only shows with what it explains: a call's « Technical detail » in Activity › AI calls, kept 30 days, or a line of Administrator actions, kept 3 years. Only super-admins read it.

For a problem, start from the code in AI consumption, then open one of the calls in AI calls if you are a super-admin.

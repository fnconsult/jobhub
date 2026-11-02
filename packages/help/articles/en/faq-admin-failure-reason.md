---
kind: faq
audience: administrator
topic: fournisseurs-et-tools
title: How do I read a failure reason?
synonyms: [failure reason, reason, failure, error, attempt refused, code, detail, warning, provider_unavailable, key_missing, rate_limited, route_missing, test_failed]
---
A failure reason (Failure Reason) says in one line why a call or a change did not go through. It has a stable « Code », for example `key_missing`, and words, for example « API key missing ». The technical detail comes with it, never a key nor what a call said.

You read it in three places:

- on Settings, right after a refused change: « … was not changed: … », followed by « Detail: »;
- in Tools, on an AI model's page: the « Failures and warnings per reason (30 d) » table counts the calls by « Code » and « Reason »;
- in Activity, Administrator actions, where each « Attempt refused » keeps its reason.

The most frequent: « API key missing » (enter the key on the provider's sheet), « Call rejected by the provider » (key revoked, account or credit used up), « Provider rate limit reached » (wait, or change plan with the provider), « Provider unavailable » (a passing outage), « No provider configured for this task » and « Data residency rule » (see « Change an AI task's provider or model »), « Connection test failed » (key or credentials to check).

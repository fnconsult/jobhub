---
kind: page
audience: administrator
topic: coaching
title: Guardrails
synonyms: [guardrails, guardrail, block, flag only, off, prompt injection, personal data leak, secret disclosure, harmful advice, distress, 3114, booby-trapped email content, triggers, guardrail message, setting]
route: /admin/garde-fous
---
Guardrails (Coaching menu) tunes the automatic checks on what the AI Coach, its Playbook Agents and the Back Office Assistant receive, and on what they reply. They also check the emails Email intake receives before an AI reads them. Their list is fixed in code: « Prompt injection », « Personal data leak », « Secret disclosure », « Out-of-scope or harmful advice », « Distress » and « Booby-trapped email content ». Here, you tune each one and write the message it shows instead of the reply.

The « The guardrails and their setting » table gives, for each, « What it checks » and its « Setting ». Under « When it finds something », « Block » stops the message, or has the reply written again once and then replaces it with the Guardrail's message. « Flag only » lets everything through and counts the trigger. « Off » exists only for booby-trapped email content. Distress, personal data leak and secret disclosure always block (« Always blocks »).

Before a setting is saved with « Save the setting », the Guardrails' Eval Cases are played on it. It is refused if it lets through a case those three Guardrails must block; « See the Eval Run played on this setting » shows the result.

Each message exists in French and in English. In production, it is served only once validated by a named Administrator other than its author, each language apart. Until then, « Jobbbox's default text » applies. The distress message must give 3114. No one is alerted when a Candidate expresses distress.

« Triggers » counts, per day (Paris time) and per Guardrail, the messages « Blocked », « Flagged » and « Check unavailable », the last ones per reason. No Candidate, no conversation, no text: the text, if needed, stays in Activity › AI calls. When the AI check is unavailable, only the fixed rules apply and the message goes through.

Super-admins change the settings and messages; Support reads the page.

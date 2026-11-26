---
kind: page
audience: administrator
topic: coaching
title: Guardrails
synonyms: [guardrails, guardrail, block, flag only, off, prompt injection, personal data leak, secret disclosure, harmful advice, distress, 3114, booby-trapped email content, triggers, guardrail message, setting, coach scope, typed redirect, ungrounded answer, off topic, last net]
route: /admin/garde-fous
---
Guardrails (Coaching menu) tunes the automatic checks on what the AI Coach, its Playbook Agents and the Back Office Assistant receive, and on what they reply. They also check the emails Email intake receives before an AI reads them. Their list is fixed in code: « Prompt injection », « Personal data leak », « Secret disclosure », « Out-of-scope or harmful advice », « Distress », « Booby-trapped email content », « Answer not grounded in the profile » and « Coach scope ». Here, you tune each one and write the message it shows instead of the reply.

The « The guardrails and their setting » table gives, for each, « What it checks » and its « Setting ». Under « When it finds something », « Block » stops the message, or has the reply written again once and then replaces it with the Guardrail's message. « Flag only » lets everything through and counts the trigger. « Off » exists only for booby-trapped email content. Distress, personal data leak and secret disclosure always block (« Always blocks »).

« Coach scope » checks the AI Coach's final reply with five checks: (1) a change announced as done with no card; (2) a CV, a letter, a message, a note or a reply to an email written in the reply instead of a card; (3) a refusal with no reason and no alternative: no card, no typed redirect (the « Where to do it yourself » link Jobbbox builds under the reply), no « Ask the team » and, for what the coach never does, nothing it offers instead; (4) the Master CV's identity or a coach's private note repeated in the reply; (5) « off topic »: a reply that does not answer the candidate's request. Advice that says what nobody can know or promise (« I can't guarantee an answer, but… », « there is no way to know whether… ») is not a refusal for check 3. Checks 3 and 4 use fixed rules, checks 1, 2 and 5 an AI model, which reads the candidate's request beside the reply for check 5. Checks 3 and 4 always block, whatever the setting. Checks 1, 2 and 5 follow the setting, « Flag only » by default: switch it to « Block » once its Eval Cases and its triggers have been reviewed. When blocked, the reply is written again once with the reason; if it still is, its message is shown.

The AI Coach never answers with a generic text. If it ends without writing anything, one last turn, with no tools, asks it to answer the request. If it still writes nothing, the last net answers: « I couldn't handle your request. Rephrase it, or ask the team », with « Ask the team ». Check 3 does not count this last net as a refusal. Its call is flagged in the Activity, with the reason « The coach wrote nothing, even on its last turn: the last net answered ».

Before a setting is saved with « Save the setting », the Guardrails' Eval Cases are played on it. It is refused if it lets through a case those three Guardrails, or checks 3 and 4 of « Coach scope », must block; « See the Eval Run played on this setting » shows the result.

Each message exists in French and in English. In production, it is served only once validated by a named Administrator other than its author, each language apart. Until then, « Jobbbox's default text » applies. The distress message must give 3114. No one is alerted when a Candidate expresses distress.

« Triggers » counts, per day (Paris time) and per Guardrail, the messages « Blocked », « Flagged » and « Check unavailable », the last ones per reason. No Candidate, no conversation, no text: the text, if needed, stays in Activity › AI calls. When the AI check is unavailable, only the fixed rules apply and the message goes through.

Super-admins change the settings and messages; Support reads the page.

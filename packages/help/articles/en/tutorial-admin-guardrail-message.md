---
kind: tutorial
audience: administrator
topic: coaching
title: Write a Guardrail's message, in French and in English
synonyms: [guardrail message, message text, validate a message, message in french, message in english, 3114, distress, default text]
---
A Guardrail's message is shown to the Candidate instead of the reply, without saying which Guardrail acted. It exists in French and in English, and each language is validated apart. Writing it takes a super-admin, and validating it another super-admin.

1. Open Guardrails (Coaching menu) and find the Guardrail.
2. Under « Change the message in French », write the « Message text »: clear, short, using « vous ». For distress, it must give 3114, France's national suicide prevention line.
3. Click « Save the message ». The page shows « Message saved: another Administrator must validate it before production serves it. »
4. Do the same under « Change the message in English ». The English version says the same thing; for distress, it gives 3114 too.
5. Ask another super-admin to review each version. Under « Validate the message in French, version … », then in English, they enter « Your name » and click « Validate this message ».

While a language is not validated, production serves « Jobbbox's default text » in that language. Changing a message plays no Eval Case, unlike a setting. Each version and each validation are recorded in Administrator actions.

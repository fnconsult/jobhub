---
kind: page
audience: administrator
topic: plateforme
title: Activity
synonyms: [activity, searches, runs, run, job discovery, funnel, pages skipped, fallback, fallback provider, ai calls, ai message log, prompt, ai reply, debugging, trigger, tokens, input tokens, token estimate, origin, extension, app, web, background jobs, unknown]
route: /admin/activite
---
Activity (Platform menu) gathers, in tabs, what the platform did: « Searches », « Received emails », « AI calls » and « Administrator actions ». Each tab shows only to the roles that read it. « Received emails » and « Administrator actions » each have their own article.

**Searches** lists every Job discovery run, started by a Candidate's Job Search or to top up a Job Digest. Filter with « Trigger », « Period » and « Only switches to the fallback provider », then click « Show ». Each row gives the Profile (« Profile #… », never the Candidate's name), the searches, the provider, the pages read, the « New / extracted Job Offers », the stop, the duration and the cost. « Open » shows the « Funnel (Discovery metrics) », « The run's searches », the « Sources », the « Pages skipped » with their reason and « This run's AI calls ». Queries and criteria are erased after 30 days; the figures stay. A super-admin can « Open the Candidate's Job Search (recorded in Administrator actions) ».

**AI calls** is the log of what each AI call said, as sent: the instructions, the messages after Redaction and the reply, keys and secrets masked, with the result (« OK », « Warning » or « Failed ») and its reason. The « Origin » column says where the call was asked from: « Web », « Extension », « App » (the mobile app) or « Background jobs » (the worker); « Unknown » when Jobbbox could not tell, and for the calls recorded before the origin was. Filter by « Task », « Model », « Candidate's email », « Day », result, reason and « Origin », then click « Filter »; « Origin » set to « Unknown » lists the calls with no origin; « Clear filters » goes back to the whole list. For a call that wrote an AI Coach reply, the « Context estimated / measured » column gives, in tokens, the context Jobbbox estimated (about 4 characters a token), the one the provider counted (its input tokens, those read from its cache included) and, in brackets, the gap between them, signed and as a share of the estimate: it is there to correct the estimate by provider and model. Other calls show a dash there. Each call opened shows « Call details », « Why » and, for a failure, the « Technical detail ». These texts hold personal data: only super-admins read them, every call opened is recorded in Administrator actions, and they are erased after 30 days. Open a call only to understand a problem.

Super-admins, Technique and Support read Searches; only super-admins read AI calls.

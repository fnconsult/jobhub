---
kind: tutorial
audience: administrator
topic: coaching
title: Validate a playbook version
synonyms: [validate a playbook, validation, human-validated, review a version, evaluate the version, start the eval run, eval run, eval case, served version, production]
---
In production, the AI Coach only applies a playbook's latest Human-validated version. Validating it confirms you have reviewed it. You need the Playbook editor or Super-admin role, and must not have written that version: a review by an AI never counts.

1. Open Playbooks (Coaching menu), then click the playbook's name.
2. Under « Versions », choose the latest version: only the latest can be validated. Read its « Rules » and its Playbook Agent.
3. Check its « Eval Cases ». If there are none, add one with « Add an Eval Case », then « Add this case ».
4. Under « Evaluate version … », keep « The version's Playbook Agent, as saved », then click « Start the Eval Run ». The Eval Run may take a few minutes.
5. Read the result and the replies the AI judge scored. No score blocks validation: it is yours to judge, reading the replies, next to the served version.
6. Under « Validate version … », enter « Your name », then click « Validate version … ».

The page shows « Version … validated. » and production serves that version. If you later change a validated version, saving it makes a new version, to be evaluated and validated in turn. The validation is recorded in Administrator actions, with your name and the date.

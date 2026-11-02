---
kind: page
audience: administrator
topic: coaching
title: Playbooks
synonyms: [playbooks, playbook, coaching playbooks, core digest, sources list, playbook agent, ai task playbook, coach rules, version, served version, eval run, eval case, archive, allowed model, effort]
route: /admin/playbooks
---
Playbooks (Coaching menu) opens « Coaching Playbooks »: the rules the AI Coach applies. The « Core Digest, Sources list and playbooks » table shows the « Core Digest », the « Sources list » and each playbook, with its « Latest version », its « Served version », its Playbook Agent (the specialist the AI Coach consults: provider, model and effort) and its status, « Active » or « Archived ». Further down, « AI task playbooks » gives the instructions of each AI task (reading a Job Offer or a CV, writing a document…) and the AI that runs it; the AI Coach never consults them. « Allowed models » lists the models offered, their hosting (« EU » or « outside EU ») and their effort.

In production, only the latest Human-validated version of each is served. Elsewhere, the latest version is served, validated or not: the page says so at the top.

Click a playbook's name to open it. Its page lists its « Versions », then, for the version chosen, who wrote it, its « Validation », its « Rules » and the « Edit » card. Saving a version not yet validated changes it; saving a validated version makes the next version, to be validated in turn. Every version is kept.

Then come the playbook's « Eval Cases » (fictional scenarios, scored by an AI judge) and its « Eval Runs ». A version is validated only after an Eval Run on it, whatever its score, and by someone who did not write it. « Archive this playbook » stops serving it without erasing anything; « Restore this playbook » serves it again. The Core Digest and the Sources list cannot be archived.

A model « outside EU » receives calls redacted by Redaction. Playbook editors and super-admins edit, evaluate and validate; Support reads. Each change is recorded in Administrator actions.

---
kind: page
audience: administrator
topic: plateforme
title: Delivery
synonyms: [delivery, daily email, delivery report, deployment, beta, production, staging, tickets, pull request, PR, epic, map, feature, in flight, github, delivery status]
route: /admin/livraison
---
Delivery (Platform menu) shows what is being built and where it runs, read live from GitHub. Super-admins, Technique and Support read it; nothing can be changed there. GitHub is read again at most every 5 minutes; « Refresh » reads it at once.

**Environments** gives, for the Beta and Production, the « Deployed commit » of the latest successful deployment, « When », « From » which branch or version, and the « Live check »: the environment's /api/health says which commit it serves. « The site serves this commit » confirms the deployment; otherwise the page says what the site serves, or why it could not check.

**In flight** lists the tickets « Claimed », « Implementing » or « In review », and the open pull requests that close no tracked ticket.

**Epics and features** goes through each epic (a wayfinder map), its features (the « Suivi » issues) and their tickets, each at its « Stage » with its « Evidence »: a ticket is « On Beta » or « On Production » when its merged pull request's commit is part of the deployed commit; « Merged » while it is not yet.

**What this page cannot vouch for** says what could not be checked: an environment not checked live, a branch deployed, a ticket still open whose PR is merged.

Delivery reads GitHub with a read-only token, GITHUB_STATUS_TOKEN, entered by a super-admin in Settings, « Environment » tab, on the GitHub sheet. Without it, the page shows « GitHub token missing ».

**The daily email** sums up each day at 6 pm (Paris time) the environments, what is in flight and each feature's state, with an « Open Delivery » button. It goes to the addresses of the « Recipients of Delivery's daily email » setting (Settings, « Email » tab), separated by commas; empty, no email is sent. Set it on one environment only, so as not to get it twice.

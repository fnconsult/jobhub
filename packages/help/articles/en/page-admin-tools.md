---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Tools
synonyms: [tools, outils, local routes, coach actions, external tool, third-party service, status, calls, failures, cost, residency, outside the EU, tool details, latest calls, reason]
route: /admin/outils
---
Tools lists every external tool Jobbbox calls, from the web app and the worker, sorted by category: what it is for (« Purpose »), who calls it (« Called by »), where it processes data (« Data processed »: « In the EU », « Outside the EU » or « Not established »), its « Status », its « Keys », its « Calls (30 d) », its « Failures » and its « Cost (30 d) ». Neither what the calls said nor the keys are shown.

The « Status » says whether the tool can be called: « Configured », « No key needed », « Key missing », « Setting missing », « Disabled », « Not configured » or « Awaiting access ». The « env » badge flags a setting from the environment that differs from the code's default.

« Details » opens a tool's page: its « Last 30 days » figures, its « Latest calls » with their « Outcome » and « Duration », for an AI model the « Failures and warnings per reason (30 d) » table, and its « Settings », read-only. A tool outside the EU switched on without being named by the privacy policy in effect keeps the « …: recipient outside the EU not covered » warning there.

The tools under « Local routes » are not external services: they are the groups of Coach Actions, Jobbbox's own code the AI Coach calls to read the Candidate's data or to prepare a change for them, which they apply themselves. With no AI call and no key, in the EU, there is one per group: « Candidatures », « Agenda », « Profil », « Recherches d'offres », « Job Digests » and « Documents ». Each call counts in their « Calls (30 d) » under the Coach Action's name, without the Candidate nor what it read or prepared; a call refused, never run (an unknown tool, invalid arguments, one proposal too many), is a failure with the reason « Call refused: unknown tool or invalid arguments ». They stay « Disabled » while « Coach Actions switched on (the AI Coach reads and proposes) » is false, its default: the AI Coach then has no tool at all and replies as before. That setting is switched on in Settings, « AI » tab, « AI Coach » group, on the Beta first, with « Rounds of Coach Action calls per reply, at most »: 2 by default, from 0 to 4, 0 meaning replying without them. Switched on, they are « No key needed ».

APNs (Apple, for iPhone and iPad) and FCM (Google, for Android), under « App notifications », send the Jobbbox app's notifications from the worker: APNs' .p8 key and FCM's service account are entered on Settings, « Environment » tab. Their page also shows « App notifications »: those not delivered in the last 90 days, with their event, reason and HTTP status, never the token, the account or the text; a device whose token is no longer valid is removed. A super-admin finds « Send a test notification » there, which sends it to their own devices of that platform, whatever their Reminders settings.

GitHub, under « Delivery », serves the Delivery page: its read-only token is entered on Settings, « Environment » tab.

Tools is read-only: a key, a setting or a provider is changed on Settings. « All tools » leads back to the list.

Team Cal.com booking uses a verified single-host event attached from Human Coaches. Team configuration and confirmation of disabled reminders stay in Settings; API and webhook keys stay in Provider Secrets. Old cal.eu links are flagged for review. Creation with an unknown outcome is never repeated automatically: find the event in Cal.com and attach its ID. Embedded booking awaits the required Legal Texts and notice period.

The Stripe entry lists the API key, billing webhook signature and separate connected-account event signature (`STRIPE_CONNECT_WEBHOOK_SECRET`). Configure these signatures in Provider Secrets for their respective endpoints; their presence does not replace coaching’s legal activation requirements.

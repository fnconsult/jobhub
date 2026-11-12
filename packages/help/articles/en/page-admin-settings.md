---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Settings
synonyms: [help videos, video origin, settings, parameters, configuration, provider, active provider, possible providers, key, tab, environment, default value, restore, add, coach space v2]
route: /admin/parametres
---
Settings gathers the platform's settings, by kind of tool, in tabs: « Web search », « AI », « Sources », « Contact enrichment », « Email », « Payment », « Sign-in », « Extension » and « Environment ». The tab is in the address: a reload keeps it. « Extension » also holds the « App's App Store page (the landing page's link) » and the « App's Google Play page (the landing page's link) »: while a page is not set, the landing page shows no link to that store. « Environment » also holds the « Human coaches' path on the public site (to switch on with the coach space) »: while it is off, the human coaches' page answers 404 and the landing page offers no choice between candidate and human coach. It also holds the « Origin of the help videos (the Help Centre's Explainer Videos) »: the address the Help Centre plays its videos from, https://media.jobbbox.ai by default; the pages accept videos from that origin only. Last, it holds « Coach space v2 on (new Coach space, Human Coach offers, booking and payment) », off by default: off, Human Coaches and Candidates see the former Coach space and coaching pages, and the new pages do not exist (page not found); turning it on asks for a confirmation and opens nothing the legal texts, Stripe Connect or Cal.com do not allow yet. The back office's « Coaches » pages and their settings stay available either way.

A providers tab first shows the « Active provider » card, with the tab's settings, then the « Possible providers » table: each provider with its keys, its « Last test », its « Status » and what it serves (« Used by »). Click a provider's name to open its sheet at the side: its keys, its settings, its prices and the link « Its calls, failures and cost in Tools ». « Make active » chooses the web search or enriched contacts provider.

The « AI » tab also holds the « AI Coach » group: « Coach Actions switched on (the AI Coach reads and proposes) », false by default, and « Rounds of Coach Action calls per reply, at most » (2 by default, from 0 to 4). Their tools are under « Local routes » in Tools.


In « Payment », open the **Cal.com** sheet for `CAL_COM_API_KEY` and `CAL_COM_WEBHOOK_SECRET`, « Jobbbox Cal.com team » (a positive identifier) and « Cal.com reminders and workflows disabled (operator confirmation) ». Confirm the latter only after disabling those messages at Cal.com. Then check each offer's host and event type in `/admin/coachs`. Keys and settings being present establishes neither full remote-service verification nor legal approval: activation requirements still apply.

Each setting shows its « Value in use » and its « Source »: a value entered in the back office wins over the server's environment, which wins over the « Code default ». « Save » applies a new value within seconds, without a restart; « Restore » clears the back office's value. A setting marked « Set in the environment » is not changed here.

« + Add » adds what the tab holds: a provider, a key, a model, a source, a site or a sign-in provider. Every change and every refused attempt is recorded in Activity. Super-admins change everything; « Technique » changes the settings and the sites without ever seeing or replacing a key; Support reads everything and changes nothing.

For server notifications, use the relevant environment’s origin followed by the indicated path. In Stripe, keep the platform-account destination at `/api/billing/webhook` and create a separate connected-account snapshot-event destination at `/api/coaching/connect/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `refund.updated` and `refund.failed`. Save its own signing secret in `STRIPE_CONNECT_WEBHOOK_SECRET`.

In Cal.com, create a team webhook at `/api/coaching/booking/webhook` for `BOOKING_CREATED`, `BOOKING_RESCHEDULED` and `BOOKING_CANCELLED`. Use the same signing secret as `CAL_COM_WEBHOOK_SECRET`; its HMAC-SHA256 signature covers the raw message body. Verify signed deliveries in the providers’ dashboards as well as testing the API key. Legal approvals and the other activation requirements remain separate steps.

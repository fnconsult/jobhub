---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Settings
synonyms: [help videos, video origin, settings, parameters, configuration, provider, active provider, possible providers, key, tab, environment, default value, restore, add]
route: /admin/parametres
---
Settings gathers the platform's settings, by kind of tool, in tabs: « Web search », « AI », « Sources », « Contact enrichment », « Email », « Payment », « Sign-in », « Extension » and « Environment ». The tab is in the address: a reload keeps it. « Environment » also holds the « Origin of the help videos (the Help Centre's Explainer Videos) »: the address the Help Centre plays its videos from, https://media.jobbbox.ai by default; the pages accept videos from that origin only.

A providers tab first shows the « Active provider » card, with the tab's settings, then the « Possible providers » table: each provider with its keys, its « Last test », its « Status » and what it serves (« Used by »). Click a provider's name to open its sheet at the side: its keys, its settings, its prices and the link « Its calls, failures and cost in Tools ». « Make active » chooses the web search or enriched contacts provider.

Each setting shows its « Value in use » and its « Source »: a value entered in the back office wins over the server's environment, which wins over the « Code default ». « Save » applies a new value within seconds, without a restart; « Restore » clears the back office's value. A setting marked « Set in the environment » is not changed here.

« + Add » adds what the tab holds: a provider, a key, a model, a source, a site or a sign-in provider. Every change and every refused attempt is recorded in Activity. Super-admins change everything; « Technique » changes the settings and the sites without ever seeing or replacing a key; Support reads everything and changes nothing.

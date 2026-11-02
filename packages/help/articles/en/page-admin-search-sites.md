---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Sites and web search
synonyms: [sites, search sites, sources, job discovery, web search, extension site, job site, badge, domain, enable a source, france travail, fantastic.jobs, email intake]
route: /admin/parametres?tab=sources|recherche-web|extension
---
The sites Jobbbox goes through to find offers, and those where the extension shows its badge, are in three tabs of Settings. A change applies without a release: at the next search for the worker, within minutes to hours for the extension.

The « Sources » tab lists the « Job discovery sources »: the France Travail API, the Fantastic.jobs API, web search, the public ATS APIs and Email intake. Each has its switch (« Enable … », « Disable … ») and its « Availability »: a disabled source is skipped, a source without its key or provider is unavailable.

The « Web search » tab chooses the « Web search provider » and its « Fallback provider », shows the « Search AI tasks » and the « Job discovery sites » list: an enabled site is searched on purpose, a disabled one is skipped when it shows up in the results. Sites that forbid crawling cannot be added.

The « Extension » tab lists the « Extension sites », where the « Analyse this offer » badge shows. A site built into the extension can be disabled, not removed.

Super-admins and « Technique » change the sources and the sites; Support reads them.

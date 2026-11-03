---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Add an extension site or a job discovery source
synonyms: [job site, extension site, badge, address pattern, add a site, job discovery, source, job discovery site, domain, enable a source, france travail, fantastic.jobs, ats]
---
Super-admins and « Technique » add the sites and the sources; Support only reads them.

For a job board to show the extension's « Analyse this offer » badge (a Job Site):

1. Open Settings, « Extension » tab.
2. Under « Add a site to the extension », type the « Address pattern »: an https pattern, for example https://*.example.com/* for the site and its subdomains. Never every site.
3. If its posting pages publish no JobPosting data, fill in « Posting pages (optional) » with a pattern on the same site.
4. Click « Add the site to the extension ». The message « Site added to the extension. » confirms it; the extension gets it within minutes to hours.

For a job discovery source (Job discovery):

1. Open Settings, « Sources » tab. The « Job discovery sources » table gives each source's « Availability ».
2. For a disabled source, click « Enable … » in its « Switch » column, or « + Add », type « Source », choose it in « Source to enable » and click « Enable the source ».
3. If its « Availability » says « Unavailable: key missing (…) », open its provider's sheet and enter its key.

For web search to look at a site on purpose, open the « Web search » tab and, under « Add a site », type its « Domain », for example apec.fr, then « Add the site ». A site whose terms of use forbid crawling is refused: only the extension covers it.

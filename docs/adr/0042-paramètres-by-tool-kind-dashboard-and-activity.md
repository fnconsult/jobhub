# Paramètres is organised by kind of Tool, with a Dashboard and one Activity page beside it

ADR-0033 put the Platform Settings on one long Paramètres page, with keys in Clés, sign-in providers in Connexion, Job discovery sources and sites in Sites de recherche, and figures in Consommation IA and Outils. Changing the web search provider meant visiting four pages, nothing said which provider was active, and Brave's and Tavily's keys could only live in env. Decided on the map #383 (tickets #392, #386, #387, #389, #390, #393), prototype on branch `prototype/parametres`, variant A.

- **Paramètres in tabs**, one per kind of Tool (Recherche web, IA, Sources, Enrichissement de contacts, E-mail, Paiement, Connexion), then Extension and, last, Environnement. Each tab shows the active provider and its settings, then a table of every possible provider (Provider Secrets, connection test, tools and their prices, own settings, who uses it); a provider's sheet opens in a side panel and links to its Outils page. One « + Ajouter » adds a provider, a key, a model, a source, a Job discovery site, a Job Site or a Sign-in Provider. Paramètres absorbs Clés, Connexion and Sites de recherche, whose addresses redirect. Outils stays: it observes each Tool (state, calls, failures, cost); Paramètres is where it is changed.
- **Sources tab**: every Job discovery source (France Travail, Fantastic.jobs, Recherche web, the ATS APIs) with its switch, provider, keys and test; an unavailable one says why.
- **Environnement tab**: what ADR-0033 shows read-only, each with why it stays in env, plus env variables no longer used.
- **AI tasks and Playbook Agents** are listed in the IA tab (the search ones in Recherche web too) and edited in a side panel: a task's route is a Platform Setting, applied from the next call; a model or effort set by a Task Playbook or Coaching Playbook makes a draft version to validate in Playbooks (ADR-0021, ADR-0026). Choosing a provider with no key warns, never blocks.
- **Prices** of each Tool's billed unit are code defaults, overridable on the provider's sheet; the run budget and AI Usage read the same recorded cost; a tool with no known price shows « prix inconnu ». A monthly alert threshold for web search emails super-admins and shows a banner, never cuts anything.
- **Back Office Dashboard**: the Back Office home shows the consumption and budget figures and charts, each block to the roles that read its section.
- **Back Office Activity**: one page « Activité » with three tabs, Recherches (Job discovery runs, their searches and Discovery metrics: queries 30 days, figures 24 months), Appels IA (the AI Message Log, ex Journaux IA) and Actions des administrateurs (the Back Office Audit, ex Journal). The words journaux and historique leave the Back Office.
- **Explainable labels**: in the Back Office, a setting's, source's, warning's or figure's label is dotted-underlined like a HelpTerm and opens the Back Office Assistant on that item, prefilled. Amends ADR-0040's "absent from the Back Office".
- **Technique role** (`platform-manager`): writes `platformSettings`, sources, sites, Job Sites and prices, never Provider Secrets (super-admin, ADR-0020), which it sees by source and last 4 characters. Support reads Paramètres, the Dashboard and Activité › Recherches; Appels IA stays super-admin only.

## Considered Options

- **Keep one long page (ADR-0033) and add rows**: the web search's provider, keys, sources and budget stay spread over four pages.
- **One page per kind of Tool in the sidebar**: more entries, and a provider serving two kinds (Perplexity for Job Search and Company Dossiers) would appear twice with no shared sheet.
- **One big table of every setting, keys included**: dense, and keys and settings have different rules and readers.
- **Merge Outils into Paramètres**: mixes observing with changing; Outils' calls and failures stay where Support already reads them.

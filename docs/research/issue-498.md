# Issue #498 : inventaire réel des traitements et des sous-traitants (code et ADR)

Partie de #494. Lecture du dépôt au commit `4bb35f1f` (main, 2026-10-29) : `apps/web`, `apps/worker`, `apps/extension`, `packages`, `.env.example`, `docs/adr/`, `docs/ops/`, `docs/privacy/register.md`, `CONTEXT.md`. Aucune source externe n'a été lue. Ce que le dépôt ne dit pas, en particulier le siège légal et le lieu de traitement d'un fournisseur, est marqué **« à confirmer (hors dépôt) »** : à vérifier dans le DPA ou les conditions du fournisseur (#502, #503).

## En bref

1. **L'en-tête du registre est faux.** `docs/privacy/register.md:5` dit « no transfer outside the EU ». Depuis l'amendement du 2026-10-28 de l'ADR-0007 (`docs/adr/0007-eu-hosting-provider-agnostic-ai.md:88-97`), chaque tâche IA va par défaut à l'API directe de Claude (api.anthropic.com, hors UE). Le CV y part sous forme pseudonymisée (Redaction), et l'ADR-0007 elle-même qualifie cet envoi de transfert de données personnelles, qui « belongs in the register of processing » (`:81`). D'autres transferts hors UE existent aussi : Perplexity, Brave et Tavily (requêtes), Stripe, les fournisseurs de connexion et, une fois activés, ceux des Contacts enrichis.
2. **Le registre n'a que 7 entrées**, toutes des traitements de back-office ou d'observabilité. Les traitements cœur du produit n'y figurent pas : comptes, CV et Profils, Candidatures, Coach IA, Job Digests, Email intake, paiements, Coachs humains, Contacts enrichis, Invités de l'extension. Nous comptons **13 entrées manquantes** (§4).
3. **Deux entrées sont périmées.** « Back Office Assistant » dit « EU endpoints only (ADR-0007) » (`register.md:46`), ce qui est faux depuis le 2026-10-28. `docs/ops/hosting.md:29` présente encore Claude via Bedrock eu-north-1 dans la cible AWS, alors que Bedrock a été refusé.
4. **Ce qui reste dans l'UE :** le stockage (Postgres sur le VPS Hostinger à Paris, `docs/ops/hosting.md:7`), la route d'identité sous Consentement IA UE (Mistral, `packages/ai/src/ai-layer.ts:355`) et les tâches `euOnly` (`offer_email_reading`, `email_guardrail` : Mistral par défaut, `packages/ai/src/env.ts:286-288`).
5. **Cookies et stockage navigateur :** uniquement des éléments fonctionnels. Le cookie de session Better Auth, 5 clés `localStorage` côté web, et `storage.session` (session Invité, 24 h au plus) plus `storage.local` (liste des Job Sites) côté extension. Aucun outil d'analytics, aucun script ni police tiers (les polices sont auto-hébergées via `@fontsource`).

## 1. Fournisseurs IA

Routage par défaut : `packages/ai/src/env.ts:18-25` (toutes les tâches texte sur `anthropic`, `web_search` sur `perplexity`) et `env.ts:48` (`ANTHROPIC_ENDPOINT: "direct"`). Sur l'API directe, une route qui ne nomme pas de modèle prend le modèle de son effort : Haiku pour low, Sonnet pour medium ou sans effort, Opus pour high (ADR-0007 `:96`, `.env.example:86-88`).

| Fournisseur | Endpoint (code) | Résidence déclarée dans le code | Tâches par défaut | Données envoyées | Transfert hors UE |
| --- | --- | --- | --- | --- | --- |
| **Anthropic (Claude, API directe)** | `api.anthropic.com`, `packages/ai/src/providers/anthropic.ts:74` ; résidence `anthropic.ts:55,132` | hors UE | `scoring`, `writing`, `coaching`, `cv_parsing`, `offer_analysis`, `job_titles`, `back_office_assistant`, `guardrail`, `eval` (`env.ts:18-25`, `.env.example:43-57`) | Après Redaction (`packages/ai/src/redaction.ts:147`) : CV sans nom, adresse, e-mail ni téléphone, mais avec employeurs, postes, dates et écoles (des données **pseudonymisées**, ADR-0007 `:81`). S'y ajoutent les Profils, les Candidatures, les conversations du Coach (prénom conservé, `:77`), les messages des Administrateurs (Back Office Assistant) et les textes publics des offres. | **Oui.** Base légale (CCT ou adéquation) à confirmer (hors dépôt). |
| **Mistral** | `api.mistral.ai`, `packages/ai/src/providers/chat-completions.ts:95,102` | UE | Route d'identité sous Consentement IA UE (`ai-layer.ts:355,430-433`). `offer_email_reading` et `email_guardrail` quand Claude n'est pas joignable dans l'UE (`env.ts:286-288`), c'est-à-dire aujourd'hui. | Identité non expurgée du Candidat consentant (`containsIdentity`, ADR-0007 `:39-46`). Texte des emails d'offres transférés, qui peuvent nommer des recruteurs (ADR-0052 `:7-9`). | Non (déclaré UE). Localisation exacte à confirmer (hors dépôt). |
| OpenAI (optionnel) | `eu.api.openai.com` ou `api.openai.com`, `chat-completions.ts:118,126` | UE si `OPENAI_DATA_RESIDENCY=eu` (défaut `env.ts:51`) | Aucune par défaut. Un super-admin peut l'affecter à une tâche (Paramètres). | Les mêmes données, expurgées, que la tâche à laquelle il est affecté | Possible si `us` |
| Bedrock, Vertex AI (Claude dans l'UE) | `anthropic.ts:74-83` | UE | Aucune : code conservé, non utilisé (ADR-0007 `:97`) | — | — |
| **Perplexity** (Search API) | `api.perplexity.ai/search`, `packages/ai/src/providers/perplexity.ts:70,77` | hors UE | `web_search` (`env.ts:25`) | Uniquement des requêtes construites par la couche IA : intitulé et lieux des Critères de recherche, nom d'un employeur ou d'une Entreprise cible, filtres pays, domaines et âge (ADR-0007 `:20-37`, `:99-110`). Redaction appliquée. | Oui (requêtes). Selon l'ADR, ce n'est pas un transfert de données personnelles. |
| Brave Search (repli ou alternative) | `api.search.brave.com`, `packages/ai/src/providers/brave.ts:45,52` | hors UE | Repli `none` par défaut (`env.ts:53`) | Comme Perplexity | Oui (requêtes) |
| Tavily (repli ou alternative) | `api.tavily.com`, `packages/ai/src/providers/tavily.ts:91,100` | hors UE | Comme Brave | Comme Perplexity | Oui (requêtes) |

Garde-fous qui s'appliquent à chaque appel :

| Règle | Où |
| --- | --- |
| Tâches `euOnly`, refusées hors UE à chaque appel | `packages/ai/src/types.ts:19-56` ; ADR-0055 |
| La route d'identité doit être dans l'UE | `ai-layer.ts:430-433,449-453` |
| Repérage d'une identité non déclarée (e-mail, téléphone), routée vers Mistral et signalée | `ai-layer.ts:500-508` ; `packages/ai/src/identity-scan.ts` |
| Redaction de l'identité connue et des e-mails et téléphones par leur forme | `redaction.ts:147` ; ADR-0007 `:63-84` |
| Le CV d'un Invité est lu par règles seulement, sans IA | `apps/web/src/cv/index.ts:71` ; ADR-0003 |

## 2. Autres sous-traitants et destinataires

| Destinataire | Finalité | Code | Données envoyées | Localisation | Hors UE ? | Rôle probable |
| --- | --- | --- | --- | --- | --- | --- |
| **Hostinger** (VPS Paris) | Hébergement : Postgres, web, worker, file de jobs | `docs/ops/hosting.md:5-16` ; `deploy/compose.yml` | Toutes les données | Paris (`hosting.md:7`) | Non (siège à confirmer, hors dépôt) | Sous-traitant |
| **Brevo** (envoi) | E-mails transactionnels : lien de connexion, Job Digests, rappels | `apps/web/src/auth/mailers.ts:14,43,110` | Adresse e-mail, prénom, contenu (offres, liens) | À confirmer (hors dépôt). `apps/web/src/email-intake/setup-guide.ts:30` note que la documentation lue ne précise pas la région. | À confirmer | Sous-traitant |
| **Brevo Inbound Parsing** | Email intake : réception des emails transférés | `apps/web/src/app/api/email-intake/inbound/route.ts:8` ; ADR-0050, ADR-0051, ADR-0056 | Emails complets, qui peuvent nommer des tiers (recruteurs) | À confirmer (hors dépôt) | À confirmer | Sous-traitant. ADR-0051 `:9` demande de vérifier que le DPA couvre l'entrant. |
| SMTP (`SMTP_URL`, alternative à Brevo) | Comme l'envoi Brevo | `mailers.ts:92-104` | Comme l'envoi Brevo | Dépend de l'hôte configuré | ? | Sous-traitant |
| **Stripe** | Abonnements (Plans) et Séances de coaching | `apps/web/src/billing/index.ts:717` (`customers.create` avec e-mail et `candidate_id`), `:966,1062` (`client_reference_id`) ; ADR-0014, ADR-0016 | E-mail, id Candidat, Plan, paiement. Les données de carte vont directement à Stripe Checkout. | À confirmer (hors dépôt) | Probable (à confirmer) | Sous-traitant, et responsable distinct pour le paiement |
| **France Travail** (Offres d'emploi v2, La Bonne Boite v2, ROMEO v2, OAuth) | Job discovery, Entreprises cibles | `apps/worker/src/job-discovery/france-travail/api.ts:16,140-144` ; `la-bonne-boite.ts:26-27,204-207` ; `packages/shared/src/france-travail.ts:20` ; ADR-0044 | Codes ROME ou mots-clés de l'intitulé, département ou commune, type de contrat. Aucune donnée d'identité. | France (organisme public) | Non | Destinataire de requêtes, pas de données personnelles |
| **Fantastic.jobs** | Job discovery (postings ATS) | `apps/worker/src/job-discovery/fantastic-jobs/api.ts:12,28-32` ; ADR-0031 | Intitulé visé et un lieu des Critères de recherche | **Non établie dans le dépôt** | À confirmer | Destinataire de requêtes (le Candidat n'est pas nommé) |
| recherche-entreprises.api.gouv.fr | Dossiers entreprise, filtre « entrepreneur individuel » | `apps/web/src/company-dossiers/french-register.ts:188` ; ADR-0007 `:105-107` | SIREN ou nom d'entreprise | France | Non | Pas de données personnelles du Candidat |
| geo.api.gouv.fr | Lieux des Critères de recherche, codes commune | `apps/web/src/places/geo-api.ts:59` ; `apps/worker/src/job-discovery/target-companies/city-codes.ts:12` | Nom de lieu saisi | France | Non | Idem |
| ROME open data (api.francetravail.fr) | Référentiels | `apps/web/src/reference-data/sources.ts:17` | Rien | France | Non | — |
| ATS publics (Greenhouse, Lever, Ashby, SmartRecruiters, Workable) et pages de sites | Lecture d'offres et de pages carrière | `apps/worker/src/job-discovery/ats.ts:143-206` | Rien (requêtes GET publiques) | Divers | Requêtes seulement | — |
| **Lusha / Kaspr / Apollo** (Contacts enrichis, **désactivés** tant que `CONTACT_ENRICHMENT_DPA_SIGNED=false`) | Trouver et révéler un contact chez un employeur (Premium) | `apps/web/src/enriched-contacts/providers/lusha.ts:13,61-69,91` ; `apollo.ts:13,36-40,62` ; `kaspr.ts:11,29` ; ADR-0015 ; `.env.example:244-258` | Nom ou domaine de l'entreprise, intitulés de poste, pays, id de la personne. En retour : nom, e-mail et téléphone de **tiers**. | À confirmer (hors dépôt) | Probable pour Apollo et Lusha (à confirmer) | Sous-traitant (DPA requis par l'ADR-0015) |
| **Google, Microsoft, Apple, OIDC générique** | Connexion des Candidats et des Administrateurs | `apps/web/src/sign-in-providers/policy.ts:93-105,112` ; `apps/web/src/sign-in-providers/apple.ts:14` ; ADR-0011 | Redirection OAuth ; Jobbbox reçoit e-mail et nom (scopes `openid email profile`) | Hors UE probable (à confirmer) | Oui (côté fournisseur) | Responsable distinct, en général (à confirmer) |
| **Cal.com** (cal.com / cal.eu) | Réservation d'une Séance auprès d'un Coach humain | `apps/web/src/human-coaches/index.ts:241-249` ; ADR-0027 | **Rien par API.** Jobbbox stocke seulement le lien de réservation du Coach ; le Candidat réserve lui-même sur le compte Cal.com du Coach. | — | — | Hors périmètre de Jobbbox (compte du Coach). À mentionner dans la politique de confidentialité. |
| GitHub (GHCR, Actions) | Build et images Docker | `docs/ops/hosting.md:16` | Aucune donnée personnelle | — | — | — |
| Chrome Web Store | Distribution de l'extension | `docs/ops/hosting.md:36` | Aucune (côté Jobbbox) | — | — | — |

## 3. Comparaison avec `docs/privacy/register.md`

| Entrée du registre | Écart constaté |
| --- | --- |
| En-tête (`:5`) : « no transfer outside the EU » | **Faux** depuis le 2026-10-20 (Redaction plutôt que routage UE) et le 2026-10-28 (API directe de Claude). Il faut nommer les transferts et leur base légale. |
| Back Office Audit (`:7-20`) | RAS |
| Provider Secrets (`:22-35`) | RAS. Il liste les fournisseurs (IA, France Travail, Fantastic.jobs, enrichissement, Stripe, Brevo) sans qu'aucun ait d'entrée de traitement. |
| Back Office Assistant (`:37-51`) | Ligne Processors (`:46`) **périmée** : le `coaching`, et donc `back_office_assistant`, va à Claude en direct, hors UE, expurgé. |
| AI Usage (`:53-66`) | RAS (la table ne nomme personne) |
| AI Message Log (`:68-81`) | Aucune ligne Processors. C'est cohérent, le stockage est dans l'UE, mais l'entrée ne renvoie à aucun traitement IA « source ». |
| Signalements (`:83-97`) | RAS |
| Job discovery runs (`:99-112`) | Pas de ligne Processors alors que les requêtes partent chez Perplexity, Brave ou Tavily (hors UE), France Travail et Fantastic.jobs. |

## 4. Entrées manquantes du registre

| # | Traitement proposé | Tables / modules | Sous-traitants | Hors UE | Base légale probable | Source |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Comptes Candidats et connexion | `candidate`, `session`, `account`, `verification` (Better Auth), `sign_in_provider`, `sign_in_setting`, `administrator_role` ; `apps/web/src/auth/index.ts:285-335` | Hostinger, Brevo (lien magique), Google, Microsoft, Apple, OIDC | Fournisseurs de connexion | Contrat | ADR-0011 |
| 2 | CV maître, Profils, Critères de recherche, Score ATS, lecture de CV par IA | `master_cv_version`, `profile`, `ats_score` ; `apps/web/src/cv/ai-reading.ts:93-97` | Anthropic (expurgé) ; Mistral si consentement | **Oui** | Contrat | ADR-0006, ADR-0007, ADR-0012 |
| 3 | Candidatures, Documents adaptés, Relances, Entretiens, Agenda, rappels | `application`, `tailored_cv`, `tailored_document`, `follow_up_*`, `interview`, `appointment_reminder*`, `action_card`, `company_dossier` | Anthropic ; Perplexity (nom d'employeur) ; registre FR | **Oui** | Contrat | ADR-0006, ADR-0028, ADR-0029 |
| 4 | Coach IA (conversations, mémoire, Guardrails, questions sans réponse) | `coach_conversation`, `coach_message`, `coach_memory_item`, `guardrail_trigger`, `guardrail_message`, `unanswered_question`, `workflow_agent_run` | Anthropic | **Oui** | Contrat | ADR-0007 (#126), ADR-0022, ADR-0036, ADR-0041 |
| 5 | Consentement IA UE et routage d'identité | `eu_ai_consent` ; `apps/web/src/eu-ai-consent/` | Mistral | Non | Consentement (art. 6.1.a) | ADR-0007 (#121) |
| 6 | Recherches d'emploi, Job discovery, Job Digests, Entreprises cibles | `job_search`, `job_digest`, `job_digest_subscription`, `target_company`, `target_company_refresh`, `job_offer` | Perplexity, Brave, Tavily ; France Travail ; Fantastic.jobs ; Brevo ; Anthropic | Requêtes | Contrat | ADR-0031, ADR-0037, ADR-0043, ADR-0044, ADR-0049 |
| 7 | **Email intake** (Adresse de transfert, emails reçus, expéditeurs reconnus) | `forwarding_address`, `received_offer_email`, `received_offer_email_offer`, `received_email_activity`, `candidate_recognised_sender`, `candidate_switched_off_sender`, `recognised_sender`, `linked_mailbox_event` | Brevo Inbound ; Mistral (`euOnly`) | Non (à confirmer pour Brevo) | Contrat, et intérêt légitime pour les tiers | ADR-0050 à 0052, 0056, 0059, 0060. **ADR-0051 `:9` exige l'entrée au registre et une AIPD avant le lancement.** |
| 8 | Contacts enrichis (données de **tiers**) | `enriched_contact` | Lusha, Kaspr ou Apollo ; Anthropic (nom et poste seulement) | Probable | Intérêt légitime (à arbitrer) | ADR-0015 |
| 9 | Abonnements, Quotas, paiements | `candidate_plan`, `quota_usage`, `plan`, `plan_quota` | Stripe | Probable | Contrat, obligation légale (comptabilité) | ADR-0014, ADR-0032 |
| 10 | Coachs humains et Séances de coaching | `human_coach`, `coaching_session`, `coach_access`, `coach_review`, reprogrammations | Stripe ; Cal.com (lien seulement) | Probable (Stripe) | Contrat | ADR-0016, ADR-0027 |
| 11 | E-mails transactionnels (traitement transversal) | `apps/web/src/emails/`, `mailers.ts` | Brevo ou SMTP | À confirmer | Contrat | ADR-0058 |
| 12 | Invités de l'extension | `storage.session` de l'extension ; `job_offer` capturée par un Invité (expire en 23 h, `packages/shared/src/domain.ts:249`) | Hostinger ; Anthropic pour `offer_analysis` (texte public seulement) | Non pour le CV (lu par règles, `cv/index.ts:71`) | Intérêt légitime ou mesures précontractuelles | ADR-0003, ADR-0054 |
| 13 | Exercice des droits (export, suppression) | `apps/web/src/candidate-data/index.ts` | — | — | Obligation légale | ADR-0010 |

À noter aussi : aucune politique de confidentialité ni liste de sous-traitants n'est publiée dans `apps/web` (aucune occurrence de « politique de confidentialité » ou de « sous-traitant »), alors que l'ADR-0051 `:8` y renvoie.

## 5. Cookies et stockage navigateur

### Web (`apps/web`)

| Nom | Type | Contenu | Durée | Finalité | Consentement requis ? | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Cookie de session Better Auth (nom par défaut `better-auth.session_token`, préfixé `__Secure-` en HTTPS) | Cookie HttpOnly, SameSite | Jeton de session signé (`AUTH_SECRET`) | Durée par défaut de Better Auth (aucun `expiresIn` de session configuré) | Authentification | Non (strictement nécessaire) | `apps/web/src/auth/server.ts:1,86` ; `auth/index.ts:316-321`. Nom et durée à vérifier dans `better-auth` (non lu ici, `node_modules` absent). |
| Cookies d'état OAuth de Better Auth (connexion Google, Microsoft, Apple, OIDC) | Cookie temporaire | État et PKCE pendant la redirection | Le temps de la connexion | Sécurité de la connexion | Non | `auth/index.ts:293` (`socialProviders`), `:334` (`genericOAuth`). Défaut Better Auth, à vérifier. |
| `jobbbox.textSize` | localStorage | Taille du texte choisie | Persistant | Accessibilité | Non | `packages/shared/src/design/text-size.ts:4` ; `apps/web/src/components/TextSizeControl.tsx:23` ; `apps/web/src/design/document-head.tsx:7` |
| `jobbbox.sidebar` | localStorage | Barre latérale fermée | Persistant | Préférence d'interface | Non | `apps/web/src/design/sidebar-state.ts:7` ; `apps/web/src/components/SidebarShell.tsx:43-44` |
| `jobbbox.agendaView` | localStorage | Vue de l'Agenda | Persistant | Préférence d'interface | Non | `apps/web/src/components/AgendaControls.tsx:9,22-25` |
| `jobhub.coachConversation` | localStorage | Id de la dernière Conversation du Coach | Persistant | Rouvrir la conversation | Non (fonctionnel), mais c'est un identifiant rattaché à la personne | `apps/web/src/components/CoachPanel.tsx:285,333-346` |
| `jobhub.backOfficeAssistantConversation` | localStorage | Id de la conversation de l'Assistant (Administrateurs) | Persistant | Idem | Non | `CoachPanel.tsx:306` |

Aucun cookie posé par le code de Jobbbox lui-même : aucun `cookies().set` ni `document.cookie`. Le lien de désinscription n'utilise pas de cookie (`apps/web/src/app/api/job-digests/unsubscribe/route.ts:7`). Aucun analytics, pixel ou script tiers. Les polices sont empaquetées via `@fontsource` (`apps/web/package.json`).

### Extension (`apps/extension`)

| Stockage | Contenu | Durée | Source |
| --- | --- | --- | --- |
| `chrome.storage.session` | Session Invité : offre capturée, CV de l'Invité, Score de correspondance, travail enregistré | En mémoire, effacée à la fermeture du navigateur et au plus tard 24 h après le début (alarme) | `apps/extension/src/guest-session.ts:1-8` ; `apps/extension/entrypoints/background.ts:15` ; `apps/extension/entrypoints/sidepanel/main.ts:44` |
| `chrome.storage.local` | Liste des Job Sites lue sur `/api/job-sites` (aucune donnée personnelle) | Relue toutes les heures | `apps/extension/src/job-sites.ts:5-6,80` ; `background.ts:18` |
| Cookie de session du web app | Envoyé avec les requêtes de l'extension grâce à `host_permissions` | Celle du web app | `apps/extension/wxt.config.ts:27-30` |
| Permissions | `activeTab`, `scripting`, `storage`, `alarms`, `sidePanel` ; `https://*/*` en option, sur demande | — | `wxt.config.ts:22,26` |

## 6. À confirmer hors dépôt (pour #502 et #503)

| Point | Pourquoi |
| --- | --- |
| Entité contractante, lieu de traitement et mécanisme de transfert (CCT, DPF) d'Anthropic, Perplexity, Brave, Tavily, Stripe, Brevo (envoi et entrant), Fantastic.jobs, Lusha, Apollo, Kaspr, Hostinger | Le dépôt ne l'établit pas. L'ADR-0007 traite les fournisseurs de recherche comme hors UE « faute de preuve » (`:22`). |
| Politique de rétention et d'entraînement côté Anthropic sur l'API directe | Elle conditionne l'analyse de risque du transfert de CV pseudonymisés |
| Statut de Fantastic.jobs | Aucune information de localisation dans le dépôt |
| Nom et durée exacts des cookies Better Auth | Lus d'après les défauts du framework, non vérifiés dans `node_modules` |
| `docs/ops/hosting.md:29` (Bedrock) et `register.md:46` | Documents à corriger, hors du périmètre de ce ticket (le registre n'est pas modifié ici) |

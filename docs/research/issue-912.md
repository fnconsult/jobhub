# Issue #912 : ce que l'extension envoie au serveur et comment le tracer

Carte : #910. Lu le 2026-11-09 sur `origin/main` (7ec7c5d). Recherche seule : aucune décision, aucun code de production. Chaque constat renvoie au fichier qui le porte ; **À VÉRIFIER** marque ce que le code lu ne tranche pas.

## En bref

- L'extension appelle **9 routes** du web app (7 via `createJobbboxApi`, plus `/api/job-sites` et `/api/auth/get-session`). Seules **4 écrivent** quelque chose : Capture, Match Score, création de Profile, enregistrement d'Application (et `/api/cv/draft` pour un Candidate, via l'AI).
- **Rien n'enregistre l'origine** d'une requête aujourd'hui, sauf deux cas ponctuels : la source d'Arrival « Extension » dans `offer_box_entry.arrival_sources` (#819, livré par #901) et l'`origin` (`web` / `mobile`) d'une Acceptance (`legal_acceptance`).
- Les signaux d'origine existent déjà et sont fiables **depuis un navigateur** : tout POST est filtré par `isFromTrustedOrigin` contre une liste fermée (web, `EXTENSION_ORIGINS`, `jobbbox://`), ce qui classe web / extension / app sans rien ajouter. Un GET de l'extension se reconnaît par `Sec-Fetch-Site: none` + `Sec-Fetch-Mode: cors`. Aucun n'est fiable contre un client hors navigateur (curl peut tout forger).
- L'extension **n'envoie pas son numéro de version** : seulement `Jobbbox-Api-Version: 1` (la version du contrat, ADR-0063).
- Un **Guest n'a aucun identifiant stable** : pas de cookie, pas d'id d'installation, Guest session en `chrome.storage.session` (effacée à la fermeture du navigateur). Compter des Guests ou des installations demanderait un **nouvel identifiant**, donc une nouvelle entrée au registre et très probablement une issue « Légal : » (ePrivacy art. 5(3)).
- Écarts relevés en passant : `candidate_id IS NULL` dans `ai_message_log` ne veut pas dire « invité » (évals, tests de routage aussi) ; un Profile créé depuis l'extension ne compte pas `cvReading` dans la Consommation (la Provenance n'est pas renvoyée) ; ADR-0003 dit « no AI provider » alors que la phase 2 du Match Score d'un Guest appelle l'AI (le registre le dit, l'ADR non).

## 1. Inventaire des appels de l'extension

Source unique des appels métier : `apps/extension/src/jobbbox-api.ts` (`createJobbboxApi`). Chaque requête porte `Jobbbox-Api-Version` (`API_VERSION_HEADERS`, `apps/extension/src/extension-update.ts`) et `credentials: "include"` (le cookie de session du web app : un Candidate connecté est reconnu, un Guest non). Deux autres appels hors de ce module : `apps/extension/src/job-sites.ts:118` et `apps/extension/src/candidate-session.ts:20`.

| Appel (route) | Qui l'appelle dans l'extension | Guest | Candidate | Ce qui est écrit aujourd'hui |
|---|---|---|---|---|
| `POST /api/job-offers` (Capture) | `side-panel.ts:45` → `api.capture` | oui | oui | `job_offer` (INSERT … ON CONFLICT DO NOTHING) ; `guest_expires_at` posé si Guest (`GUEST_EXPIRY_SQL`, 23 h), remis à NULL si un Candidate capture la même offre (`apps/web/src/job-offers/index.ts:355-430`). La ligne ne nomme personne. **Aucun AI, aucun `ai_usage`, aucune Consommation**. Route : `apps/web/src/app/api/job-offers/route.ts:13-20` (`capture(body, candidate ? "candidate" : "guest")`, ligne 17). |
| `POST /api/match-score` | `match-scoring.ts:57` → `api.score` | oui (CV envoyé) | oui (Profile ou CV) | Le Match Score n'est **pas stocké** (« Saves nothing », `route.ts`). Candidate : `billing.use(candidateId, "matchScores")` → `quota_usage` + `consumption_day` (`matchScore`, `apps/web/src/billing/index.ts:1159`). Guest : rien compté (`refused()` renvoie null, `apps/web/src/match-score/index.ts:163`). Phase 1 (`scoreMatch`) : aucun AI. Phase 2 (si la phase 1 n'est pas fiable à ≥ `ENOUGH_FROM_STRUCTURED_DATA` et qu'il manque un détail) : `readOfferFields`, tâche `offer_analysis`, une fois par Job Offer → `job_offer` mis à jour (`fillFromText` : résumé, secteur, champs manquants, Provenance) + `ai_usage` + `ai_tool_usage` + `ai_message_log` (`candidate_id` = le Candidate, ou NULL pour un Guest). Texte de l'offre seul, jamais le CV. |
| `POST /api/cv/draft` | `sidepanel/main.ts:410` → `api.readCv` | oui | oui | Rien de stocké (« Saves nothing »). Guest : lecture **par règles** (`draftFromCv` saute `readCvWithAi` quand `candidateId === null`, `apps/web/src/cv/index.ts:71`) → aucun AI, aucune ligne. Candidate : tâche `cv_parsing` → `ai_usage` + `ai_message_log` (avec le contenu du CV, 30 jours). Pas de Consommation à ce stade (elle se compte à l'enregistrement du Profile, voir ligne suivante). |
| `GET /api/profiles` | `application-saving.ts:99` | 401 | oui | Rien (lecture). |
| `POST /api/profiles` | `application-saving.ts:76` (« nouveau Profile depuis ce CV ») | 401 | oui | `profile` + `master_cv_version` (v1). `consumption_day` `cvReading` **seulement si** le corps porte une Provenance `cv_parsing` (`apps/web/src/profiles/index.ts:401,510`). L'extension n'envoie que `{ masterCv, searchCriteria }` (`jobbbox-api.ts:172`) et `readCv` jette la `provenance` renvoyée par `/api/cv/draft` : **un CV lu par l'AI puis enregistré depuis l'extension n'est pas compté en `cvReading`**, contrairement à ce que dit le registre (« An action started from the browser extension counts under its feature »). Contrôle de Plan Quota Profiles (409). |
| `POST /api/applications` | `application-saving.ts:87` | 401 | oui | `application` ; `job_offer` gardé pour le Candidate (`keepForCandidate`) ; `offer_box_entry` avec la source d'Arrival `extension` quand `fromExtension(request.headers)` (`apps/web/src/app/api/applications/route.ts:33`, #819/#901). Pas de Consommation. |
| `GET /api/legal/cgu/in-effect` | `sidepanel/main.ts:110` | oui | oui | Rien. Public, `no-store` ; « nothing of the Guest's Acceptance is sent ». Aujourd'hui aucune version n'est en vigueur (`packages/help/legal/cgu/` ne contient que `.gitkeep`), donc la case du Guest n'apparaît pas. |
| `GET /api/job-sites` | background, `job-sites.ts:118`, au plus 1×/h (`JOB_SITES_MAX_AGE_MS`), réessai 5 min | oui | oui | Rien. Public, `cache-control: public, max-age=300`. |
| `GET /api/auth/get-session` | background (`background.ts:38`) et Side Panel (`sidepanel/main.ts:44,808`) | oui | oui | Better Auth ; hors contrat d'API (`OUTSIDE_PREFIXES` dans `apps/web/src/api-version/index.ts`). Pas d'écriture applicative (**À VÉRIFIER** : un rafraîchissement de la ligne `session` par Better Auth selon son `updateAge` par défaut). |

Ce que l'extension ne fait pas : elle n'envoie pas l'Acceptance du Guest, ni d'identifiant d'installation, ni sa version de manifeste ; la Guest session reste dans le navigateur (`apps/extension/src/guest-session.ts`, `guest-terms.ts`).

### Tables, en résumé

- `ai_usage` / `ai_tool_usage` : Match Score phase 2 (tous), CV draft (Candidate seulement). Aucune colonne de Candidate ni d'origine (`migrateAiUsage`, `apps/web/src/ai-usage/index.ts:384-470`).
- `ai_message_log` : mêmes appels ; `candidate_id` NULL pour un Guest. Aucune colonne d'origine.
- `external_api_usage` : **aucun** appel de l'extension n'y écrit (ni Capture ni Match Score n'appellent d'API externe ; `page_read` concerne les lectures côté serveur, pas la Capture qui arrive déjà lue).
- `consumption_day` : Candidates seulement (`matchScore` via la Plan Quota ; `cvReading` en théorie, pas en pratique depuis l'extension, cf. ci-dessus). Un Guest n'y figure jamais (table liée à `candidate`, ADR-0091).
- `quota_usage` : Match Score d'un Candidate.

### Back Office

Activité › Appels IA (`apps/web/src/app/admin/activite/appels-ia/page.tsx:156`, `[id]/page.tsx:61`) affiche `log.candidate?.email ?? « Aucun (invité) »` (`packages/shared/src/i18n/locales/fr.json:2806`). Or `candidate_id` est NULL aussi pour les évals (`apps/web/src/evals/index.ts:510`, `AiLayer.forEval`, `ai-layer.ts:1233`) et les tests de routage / connexion (`packages/ai/src/routing-check.ts:119-120`) : le libellé « invité » est donc **trompeur** pour ces lignes. Seule la tâche permet de deviner : `offer_analysis` sans Candidate ≈ Guest de l'extension.

## 2. Reconnaître l'origine d'une requête

| Signal | Où il est lu aujourd'hui | Ce qu'il dit | Fiabilité |
|---|---|---|---|
| `Origin: chrome-extension://<id>` (ou `moz-`/`safari-web-extension://`) | `fromExtension()` (`apps/web/src/api-version/index.ts:40`), `isFromTrustedOrigin()` (`apps/web/src/auth/server.ts:138`, liste `EXTENSION_ORIGINS`, `apps/web/src/auth/config.ts:39`) | Extension, et laquelle (id de la fiche du store) | Fort depuis un navigateur : une page web ne peut pas forger `Origin`. Nul contre un client hors navigateur. Présent sur les POST (exigé : sans Origin de confiance → 403). |
| `Sec-Fetch-Site: none` + `Sec-Fetch-Mode: cors` | `fromExtension()` | Fetch qu'aucune page n'a lancé : GET de l'extension (le GET n'a pas d'Origin) | Heuristique ; navigateur Chromium/Firefox récents. Ne dit pas *quelle* extension. |
| `Jobbbox-Api-Version: <n>` | `apiVersionRefusal()` via `proxy.ts` | Version du **contrat** (1 aujourd'hui), pas de l'extension | Ne distingue pas extension et app (les deux l'envoient) ; ne donne pas la version du build. |
| `Jobbbox-Client: mobile` | `fromJobbboxApp()` | App native (#684) | Auto-déclaré ; déjà utilisé pour `legal_acceptance.origin` (`apps/web/src/app/api/account/acceptances/route.ts:21`). |
| `expo-origin: jobbbox://` | `isTrustedOrigin()` (`apps/web/src/auth/trusted-origin.ts:9`) | App native sur les POST | Comme ci-dessus. |
| User agent `APP_WEBVIEW_USER_AGENT/…` | `inAppWebView()` (`apps/web/src/native-app/in-app.ts`) | Page web ouverte dans une WebView de l'app | Auto-déclaré. |
| Origin = `baseURL` du web app | `isFromTrustedOrigin()` | Web | Fort depuis un navigateur. |
| Cookie de session | `getCurrentCandidate()` | Candidate ou Guest, pas la surface | — |

Conséquence : pour tout POST, la surface (`web` / `extension` / `app`) se déduit déjà de l'en-tête que `isFromTrustedOrigin` vient de valider ; il suffirait de renvoyer *laquelle* des origines de confiance a matché au lieu d'un booléen. #901 l'a fait pour un seul cas (`fromExtension` dans `/api/applications`, pas dans `/api/job-offers`, contrairement à ce que suggère le ticket). Le travail (worker, files de jobs) n'a pas de requête : sa surface serait « système ».

**Version de l'extension** : non transmise. `chrome.runtime.getManifest().version` n'est lu nulle part. La connaître côté serveur (pour « dernière version dans Outils », #910) demanderait un nouvel en-tête, ce qui n'oblige pas à monter l'API Version (en-tête additionnel, ignoré par un serveur qui ne le lit pas ; `docs/ops/extension-api-version.md`).

## 3. Identifiant d'un Guest

- CONTEXT.md « Guest » : « A person using the browser extension without an account. Their CV and captured Job Offer are temporary. » ; « Guest session » : tenue par le navigateur, 23 h au plus.
- ADR-0003 : CV et Job Offer du Guest pour la session seulement, supprimés sous 24 h ; `job_offer` sans identité du Guest.
- ADR-0062 (l. 21) : l'Acceptance du Guest reste dans la Guest session, « with no server row ».
- ADR-0014 ne parle pas du Guest ; c'est `apps/web/src/match-score/index.ts` qui le cite pour dire qu'un Match Score de Guest n'est pas compté.
- Registre, « Guest session in the browser extension » : stockage `chrome.storage.session`, clé `guestSession` ; « Jobbbox holds nothing of it to give or erase ».

Côté code : pas de `randomUUID`, d'id d'installation ni d'écriture en `storage.local` autre que `updateRequired` et le cache des Job Sites. **Il n'existe aucun identifiant stable d'un Guest**, ni côté serveur ni côté extension. Ce qui reste visible à chaque requête : IP, user agent, et l'id d'extension dans l'Origin (le même pour toutes les installations d'un store).

Ce qu'on peut compter **sans nouvel identifiant** : des événements (Captures de Guest = `job_offer` avec `guest_expires_at` non NULL au moment de l'insertion, mais la ligne disparaît en 23 h ; appels `offer_analysis` sans Candidate), jamais des personnes ni des installations. Compter des installations demanderait un id aléatoire en `chrome.storage.local` envoyé au serveur. Précédent au registre : `EAS-Client-ID` de l'app (§ « EAS Update »), dont l'exemption ePrivacy art. 5(3) est **renvoyée à la Legal Review (#762)** ; le même raisonnement s'appliquerait.

## 4. Où brancher une origine (`surface`)

- **`createPostgresUsageLog`** (`apps/web/src/ai-usage/index.ts:81`) écrit `ai_usage` + `ai_tool_usage` + `ai_message_log` en une requête depuis un `UsageEntry` (`packages/ai/src/types.ts:310`). Une `surface` y passerait soit par un champ de `UsageEntry` (à faire porter par chaque requête AI comme `candidateId`, c'est-à-dire à travers `@jobhub/ai` et chaque appelant), soit par un contexte de requête.
- **Contexte de requête** : précédent dans le repo, `AsyncLocalStorage` dans `apps/web/src/auth/sign-in-calls.ts` (pour attribuer les fetch d'un callback de connexion). `record()` s'exécute après un `setTimeout` (`nextTurn`), qui garde le contexte ALS sous Node. Le worker (`apps/worker/src/main.ts:92`) utilise le même `createPostgresUsageLog` : sans contexte, il écrirait « système ». Le point d'entrée naturel serait les route handlers (le `proxy.ts` tourne dans le runtime du proxy Next, pas dans le même contexte ALS que la route — **À VÉRIFIER** avant de s'y appuyer).
- **Coût d'une colonne** : `ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS surface text` (nullable) suit le style des migrations existantes (`migrateAiUsage`, idempotente, pas de fichiers de migration) ; idem pour `ai_message_log` si on veut la voir dans Appels IA. Une colonne nullable sans défaut ne réécrit pas la table sous Postgres ≥ 11.
- **Reprise des lignes existantes** : impossible en général, la requête d'origine n'est pas gardée. Seule heuristique : `offer_analysis` sans Candidate → extension (Guest). Un `cv_parsing` de Candidate peut venir du web, de l'app ou de l'extension sans moyen de les distinguer. Il faudrait laisser NULL = « inconnu (avant la colonne) ». `ai_usage` est gardé 24 mois, `ai_message_log` 30 jours : la reprise ne vaut que pour `ai_usage`.
- **Hors AI** : Capture, création de Profile, Application ne passent par aucun journal. Les tracer demanderait un nouveau journal d'événements, ou une colonne sur chaque table métier (précédents : `offer_box_entry.arrival_sources`, `legal_acceptance.origin`).
- **Consommation** : ADR-0091 et l'en-tête de `apps/web/src/consumption/index.ts` disent qu'elle ne pointe pas vers `ai_usage` et ne garde « no model, no provider » ; une surface n'y est pas interdite par écrit, mais `consumption-sites.test.ts` fixe un seul lieu de comptage par Tool.

## 5. Données personnelles

Ce que le registre (`docs/privacy/register.md`) dit déjà :

- « Guest session in the browser extension » : finalité Match Score, stockage navigateur, rien côté Jobbbox ; Processors : la lecture du CV du Guest « by rules only, never sent to an AI » (vrai, `cv/index.ts:71`) ; le texte public de l'offre part chez Anthropic pour `offer_analysis` (#338).
- « AI Usage » : lignes sans personne, 24 mois ; Guests concernés indirectement 30 jours via le Message Log.
- « AI Message Log » : Guests « whose calls are kept without an id », 30 jours, super-admins seulement, chaque lecture auditée.
- « Consommation » : Candidates seulement ; « An action started from the browser extension counts under its feature » (inexact pour `cvReading`, § 1).
- « Offer box » : Arrival « Extension ».
- Aucune entrée sur les journaux HTTP du serveur (IP, user agent) ni sur un journal d'événements de l'extension.

Ce qu'un journal d'événements de l'extension ajouterait :

- **Candidate** : événements liés à un compte (qui, quoi, quand, depuis quelle surface) → nouvelle entrée au registre (finalité : pilotage produit / support ; base : intérêt légitime ; durée à fixer, à aligner sur `consumption_day` 12 mois ou sur `ai_usage` 24 mois ; export et suppression avec le compte comme `consumption_day`).
- **Guest sans identifiant** : compter des événements anonymes (type, jour, surface, version) reste hors données personnelles si rien ne relie deux événements ; à écrire tel quel au registre.
- **Guest avec identifiant d'installation** : nouvel identifiant stocké et lu sur le terminal → ePrivacy art. 5(3) ; l'exemption « strictement nécessaire » est peu probable pour de la mesure d'usage ; la politique de confidentialité devrait le nommer.
- **Version de l'extension** dans un en-tête : pas une donnée personnelle seule.

Faut-il une issue « Légal : » ? Selon `docs/agents/documentation.md` (§ Legal Texts), oui dès qu'un changement ajoute un traitement ou un traceur susceptible d'exiger une nouvelle version des Legal Texts. Un journal lié au compte du Candidate ou un identifiant d'installation pour les Guests y entrent ; une simple colonne `surface` sur `ai_usage` (lignes sans personne) relève au minimum d'une mise à jour du registre dans la PR. Note : aucune CGU ni politique de confidentialité n'est encore en vigueur dans le repo (`packages/help/legal/*/` vides), ce qui rend toute clause nouvelle dépendante de la première version.

## 6. Écarts entre docs et code relevés

1. ADR-0003 : « the server reads it by rules alone (no AI provider …), which also keeps an endpoint open to anyone free of AI cost ». Vrai pour `/api/cv/draft`, **faux pour `/api/match-score`** : la phase 2 d'un Guest appelle `offer_analysis` (une fois par Job Offer). Le registre le dit (#338), l'ADR pas.
2. Registre « Consommation » : un Profile créé depuis l'extension n'est pas compté `cvReading` (la Provenance n'est pas renvoyée par `jobbbox-api.ts`).
3. Back Office Appels IA : « Aucun (invité) » s'affiche aussi pour les évals et les tests de routage.
4. Ticket : #901 lit l'Origin dans `/api/applications` (Arrival « Extension »), pas dans `/api/job-offers`.

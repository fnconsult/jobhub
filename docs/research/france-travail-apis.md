# Recherche #385 : API France Travail disponibles pour la Job discovery

Carte : #383. Débloque : #307. Sources consultées le 2026-10-26. Chaque affirmation cite sa source de première main : catalogue et documentation de francetravail.io (lus via le back-end JSON du site, `https://francetravail.io/api-peio/v2/...`, que la page web charge elle-même), fichiers OpenAPI publiés par France Travail, fiches data.gouv.fr publiées par l'organisation France Travail, et appels réels sans identifiants. **NON VÉRIFIÉ** signale ce qu'aucune source de première main ne confirme. Aucun identifiant n'a été utilisé : rien n'a été testé avec un jeton.

Ce fichier complète `job-sources.md` (#98) et `issue-120.md` (#120), qui n'avaient pas pu lire la documentation officielle (page JavaScript).

## Réponse courte

- **Offres d'emploi v2 n'a ni successeur ni autre accès en libre-service.** L'API a disparu du catalogue francetravail.io ; sa fiche data.gouv.fr (mise à jour le 2026-10-20) la dit « restricted », motif « Analyse de sécurité », accès « sous condition » pour les entreprises et associations, uniquement via le formulaire de contact. La seule autre API d'offres du catalogue est celle de **La bonne alternance**, limitée à l'alternance : hors sujet pour des cadres de 40 ans et plus.
- **Ce qu'une application peut souscrire seule aujourd'hui, utile à la Job discovery** : **La Bonne Boite v2** (entreprises à fort potentiel d'embauche, pas des offres), **ROMEO v2** (intitulé libre → code ROME, par IA), **ROME 4.0 – Métiers** (référentiel et recherche d'appellations), et, en contexte seulement, **Marché du travail** et **Informations sur un territoire**. Toutes en accès « publique », Licence ouverte.
- **Un même client OAuth sert toutes ces API** : une application francetravail.io reçoit un identifiant et une clé, et on lui ajoute des API ; le jeton se demande avec les scopes de chaque API, séparés par des espaces. Mais une demande de jeton qui contient un scope non accordé échoue entière (HTTP 400 `invalid_scope`) : c'est exactement ce que fait aujourd'hui notre test de connexion avec `api_offresdemploiv2`.
- **Titre → ROME** : ROMEO `POST /predictionMetiers` (jusqu'à 20 intitulés par appel, score de confiance) est l'outil prévu pour ça ; en secours, la recherche d'appellations de ROME 4.0 ou le fichier open data du ROME, et notre table `rome.ts` actuelle. La Bonne Boite accepte aussi un métier en texte libre (`job`), qu'elle résout elle-même vers un ROME.

## 1. Le catalogue francetravail.io aujourd'hui

Source : la page catalogue (`GET https://francetravail.io/api-peio/v2/pages/page?slug=produits-partages/catalogue`) et son menu `menuApi`, qui liste 54 produits.

- **Offres d'emploi n'y figure plus.** Sa page (`slug=produits-partages/catalogue/offres-emploi`) répond `{"codeHttp":403,"message":"l'accès à cette API vous est interdit"}`.
- Les API utiles ou voisines de la Job discovery :

| Produit (catalogue) | Accès | Scope(s) à demander | Ce que ça donne | Utile pour nous |
|---|---|---|---|---|
| La Bonne Boite (`bonne-boite-v2`) | publique, Licence ouverte | `api_labonneboitev2` (+ voir §3.1) | Entreprises susceptibles de recruter dans les 6 mois, par ROME/NAF et lieu | **Oui** (#307) |
| ROMEO (`romeo`) | publique, Licence ouverte | `api_romeov2` | Texte libre → appellations et codes ROME, avec score | **Oui** (titre → ROME) |
| ROME 4.0 – Métiers (`rome-4-0-metiers`) | publique, Licence ouverte | `api_rome-metiersv1 nomenclatureRome` | Référentiel ROME, recherche d'appellations | Oui (secours, libellés) |
| Marché du travail (`marche-travail`) | publique, Licence ouverte | `api_stats-offres-demandes-emploiv1 offresetdemandesemploi` | Statistiques trimestrielles : offres, tension, salaires par métier et territoire | Contexte (Coach), pas des offres |
| Informations sur un territoire (`informations-territoire`) | publique, Licence ouverte | `api_stats-informations-territoirev1 infosterritoire` | Population, établissements, dynamisme d'un territoire | Contexte seulement |
| Recherche d'opportunités d'emploi en alternance | publique | (API externe) | Renvoie vers l'API de La bonne alternance, `api.apprentissage.beta.gouv.fr` | Non (alternance) |
| Je recrute avec FT Pro | conditionnée | `jerecrute_opportunites_creer` | Transmettre un besoin de recrutement d'un employeur | Non (côté recruteur) |
| Synthèse Pages employeurs | publique | `pages-employeurs-synthese` | Widget uniquement, informations sur les Pages employeurs | Non |

Sources : pages `slug=produits-partages/catalogue/<produit>` (champs `accesType`, `conditionUtilisation`, `ficheTechniqueApi.documentationApi.presentation` qui liste « Scopes nécessaires »).

Les mêmes fiches existent sur data.gouv.fr (`GET https://www.data.gouv.fr/api/1/dataservices/?organization=534fffa3a3a7292c64a78094`, 13 services France Travail).

## 2. Offres d'emploi v2 : pas de successeur

- Fiche data.gouv.fr `api-offres-demploi`, modifiée le **2026-10-20** : `access_type: restricted`, `access_type_reason: "Analyse de sécurité"`, `authorization_request_url: https://francetravail.io/contact`. Publics : entreprises et associations « under_condition », collectivités « under_condition », particuliers « no ». La description dit que l'API « n'est actuellement plus exposée » le temps d'analyser ses modalités de distribution, après des « usages automatisés massifs » de certaines solutions d'IA qui ne respectaient pas la licence.
- La passerelle répond toujours : `GET https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search` sans jeton → **401** (pas 404). La route existe donc encore, pour les applications déjà autorisées ; une nouvelle application ne peut pas l'ajouter (catalogue).
- Les CGU de francetravail.io (version du 1er janvier 2025, `slug=cgu`, art. 5.2 b) gardent une « licence offre d'emploi » propre à cette API, qui renvoie aux articles L. 5321-1 (placement) et L. 5331-1 (diffusion des offres) du code du travail.
- La doc « Générer un access token » prend toujours `scope=api_offresdemploiv2 o2dsoffre` comme exemple : c'est un reste, pas une preuve d'accès.
- **Seul chemin** : une demande motivée via https://francetravail.io/contact. Jobbbox étant un produit d'IA, c'est précisément la catégorie visée par l'analyse ; ne rien faire dépendre de cet accès.

## 3. La Bonne Boite v2

Sources : page `slug=produits-partages/catalogue/bonne-boite-v2` (fiche technique), OpenAPI 3.1 `GET https://francetravail.io/api-peio/v2/api/360/openapi` (titre « La Bonne Boite »), fiche data.gouv.fr `api-la-bonne-boite`.

### 3.1 Authentification et scopes
- OAuth2 *client credentials*, royaume `/partenaire`. Jeton : `POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire`, corps `application/x-www-form-urlencoded` : `grant_type=client_credentials`, `client_id`, `client_secret`, `scope` (scopes séparés par des espaces). Réponse : `access_token`, `token_type: Bearer`, `expires_in` (exemple : 1499 s), `scope`. Source : doc « Générer un access token ». L'OpenAPI de La Bonne Boite donne une autre URL de jeton, `https://authentification-partenaire.francetravail.io/connexion/oauth2/access_token?realm=/partenaire` ; notre code utilise la première, qui est celle de la doc générale.
- **Scope** : la fiche dit « Scopes nécessaires : `api_labonneboitev2` ». L'OpenAPI déclare trois scopes « Obligatoire » : `search`, `office`, `api_labonneboitev2` ; la fiche technique liste `search` et `office` comme scopes applicatifs. **NON VÉRIFIÉ** : lequel des deux jeux le serveur exige. À tester avec le vrai client : d'abord `api_labonneboitev2 search office`, sinon `api_labonneboitev2` seul.
- **Un client pour plusieurs API : oui.** Une application francetravail.io a un identifiant et une clé ; on lui ajoute des API depuis l'espace personnel (doc « Gérer mon compte et mes applications »). Le paramètre `scope` prend « les scopes techniques et applicatifs correspondant aux API que vous souhaitez manipuler ». On peut donc demander La Bonne Boite et ROMEO dans un même jeton.
- **Piège** : un scope inconnu ou non accordé fait échouer la demande de jeton, HTTP 400 `{"error":"invalid_scope","error_description":"Unknown/invalid scope(s): [...]"}` (doc « Erreurs fréquentes »). C'est l'erreur de notre test de connexion actuel (`apps/web/src/provider-secrets/connection-tests.ts`, scope `api_offresdemploiv2 o2dsoffre`). Conséquence : le test doit demander le scope de La Bonne Boite, et le client ne doit jamais mêler à sa demande un scope d'API non souscrite (une demande par API, ou seulement les scopes souscrits).
- Sans jeton, `GET https://api.francetravail.io/partenaire/labonneboite/v2/recherche` → 401 (vérifié).

### 3.2 Ressources
Base : `https://api.francetravail.io/partenaire/labonneboite/v2` (OpenAPI `servers`).

| Ressource | Rôle |
|---|---|
| `GET /recherche` | Entreprises à fort potentiel d'embauche, par score décroissant, paginées |
| `GET /nombreEntreprise` | Le nombre seul (`hits`), mêmes filtres |
| `GET /potentielEmbauche?siret=…` | Score d'une ou plusieurs entreprises par SIRET. La doc prévient qu'il répond par une **redirection 302** vers `labonneboite.francetravail.fr` : le client HTTP doit suivre les redirections |

### 3.3 Paramètres de `/recherche` (OpenAPI)
- **Métier** : `rome` (tableau de codes ROME, ex. `D1102`), `naf` (codes NAF), `domain`, `granddomain`, ou `job` (texte libre que l'API essaie de faire correspondre aux libellés ROME, domaine, grand domaine, NAF ; exemple « Boul »). La réponse dit comment elle a compris : `resolved_params.jobs[]` (`type` ∈ `rome`, `naf`, `domain`, `granddomain`, `value`, `display`).
- **Lieu** : `location` (texte libre : ville, département ou région, noms de geo.api.gouv.fr), ou `city`, `citycode` (code INSEE), `postcode`, `department`, `department_number`, `region`, `region_number` (tableaux), ou `latitude` + `longitude` + `distance`, ou `bbox` (`left|bottom|right|top`). Résolution renvoyée dans `resolved_params.locations[]`.
- **Rayon** : `distance` en km, entier > 0, au plus 200 (erreur 422 « distance parameter cannot be above 200km »). Il ne vaut qu'avec `latitude`/`longitude` ou `citycode` ; avec `citycode`, le cercle est centré sur la mairie.
- **Tri** : `sort_by` (`hiring_potential` par défaut, ou `romes.hiring_potential`), `sort_direction` (`desc`).
- **Pages** : `page` (dès 1), `page_size` (au plus 100 ; la description dit 20 par défaut, le schéma dit 10 : à vérifier).
- Notre lieu des Search Criteria est un texte : `location` peut le prendre tel quel ; pour un rayon, il faut un `citycode` (géocodage via geo.api.gouv.fr, ouvert) ou des coordonnées.

### 3.4 Forme de la réponse
`SearchResponse` : `hits` (total), `params` (paramètres reçus), `resolved_params` (`jobs`, `locations` avec `geo`), `items[]`. Chaque item (`SearchResponseItem`) :
`id`, `siret`, `company_name`, `office_name`, `headcount_min`, `headcount_max` (chaînes), `naf`, `naf_label`, `rome`, `location {lat, lon}`, `city`, `citycode`, `postcode`, `department`, `department_number`, `region`, `hiring_potential` (0 à 100, « transformé depuis les données fournies par ADS » ; par NAF c'est celui de l'entreprise, sinon celui du ROME pour ce NAF), `is_high_potential` (booléen).

**Aucun contact** (ni e-mail, ni téléphone, ni site, ni offre) : seulement l'établissement, son effectif, son secteur et son score. Une candidature spontanée passe donc par nos Company Dossiers et Enriched Contacts.

Erreurs : 403 `{"error": "..."}`, 422 `{"errors": [{"param": [...], "message": "..."}]}`, 500.

### 3.5 Limites
- **Débit** : data.gouv.fr dit « 2 appels / seconde » ; la fiche technique de francetravail.io porte `nombreAppelMax: 20`, sans unité. L'écart est le même pour d'autres API (ROME Métiers : 1/s contre 10 ; Marché du travail : 10/s contre 100). **NON VÉRIFIÉ** : la valeur réelle. La source qui fait foi à l'exécution : les en-têtes `X-Ratelimit-Burst-Capacity-Clientidlimiter` (appels max par seconde pour l'application) et `X-Ratelimit-Remaining-Clientidlimiter`, et en cas de dépassement un **429** avec `Retry-After` (doc « Erreurs fréquentes »). Prévoir 2/s, lire les en-têtes, respecter `Retry-After`. Une hausse se demande depuis l'espace de l'application.
- **Fraîcheur** : données mises à jour « une fois par mois » (fiche). Un cache d'un mois par (ROME, lieu) est donc sans perte.
- **Disponibilité** : 99,8 % annoncé (data.gouv.fr) ; les CGU s'engagent sur 98 %.
- Les identifiants peuvent être désactivés après 12 mois sans appel (CGU art. 7).

### 3.6 Conditions d'usage
- Licence ouverte (Etalab), sans contractualisation (`conditionUtilisation: licence_ouverte`, `contractualisation: false`). Les CGU (art. 5.2 a) autorisent l'exploitation commerciale ; elles parlent aussi de partage à l'identique des modifications redistribuées, ce qui n'est pas dans la Licence ouverte : sans effet pour nous tant qu'on ne redistribue pas de base.
- **Logo** : « Pour la présentation des résultats de recherche, vous devrez faire apparaître le logo France Travail sur votre application » (page La Bonne Boite). À prévoir dans l'interface de #307.
- CGU art. 6 : ne pas induire les tiers en erreur sur la donnée, sa source et sa date de mise à jour ; ne pas se prévaloir de l'image de France Travail sans accord.
- ADR-0007 : on n'envoie que métier et lieu ; rien d'identifiant ne part.

## 4. De l'intitulé des Search Criteria au code ROME

Trois chemins de première main, du plus au moins précis :

1. **ROMEO v2** (`romeo`), scope `api_romeov2`, base `https://api.francetravail.io/partenaire/romeo/v2` (OpenAPI `GET https://francetravail.io/api-peio/v2/api/366/openapi`, titre « Romeo 2.0 »).
   - `POST /predictionMetiers`, corps `{"appellations": [{"intitule": "Directrice financière", "identifiant": "1", "contexte": "<libellé NAF ou SIRET, facultatif>"}], "options": {"nomAppelant": "jobbbox", "nbResultats": 3, "seuilScorePrediction": 0.7}}`. `nomAppelant` est obligatoire ; `nbResultats` de 1 à 25 (5 par défaut) ; au plus 20 intitulés par appel.
   - Réponse : par intitulé, `uuidInference` et `metiersRome[]` avec `libelleAppellation`, `codeAppellation`, `libelleRome`, `codeRome`, `scorePrediction` (0 à 1).
   - Conseils de la doc : textes courts ; préciser `contexte` si l'intitulé est ambigu. Une ressource `POST /performancePredictionMetiers` permet de renvoyer le choix de l'utilisateur pour améliorer le modèle (facultatif).
   - Débit : `nombreAppelMax: 30` sur la fiche, unité non précisée. Licence ouverte. Sans jeton → 401 (vérifié).
   - Seul l'intitulé part (Search Criteria), conforme à ADR-0007.
2. **ROME 4.0 – Métiers**, `GET https://api.francetravail.io/partenaire/rome-metiers/v1/metiers/appellation/requete?q=…` (OpenAPI `api/273/openapi`). Recherche par mots, pensée pour l'autocomplétion ; chaque résultat donne l'appellation et son `metier {code, libelle}` (le code ROME), plus `emploiCadre` en réponse complète. Débit : 1 appel/s (data.gouv.fr). Plus littéral que ROMEO.
3. **Open data du ROME**, sans compte : `https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/csv` (ou `/json`, `/xml`), une archive zip publique (vérifié : 200, `application/zip`), Licence ouverte, jeu data.gouv.fr « Répertoire Opérationnel des Métiers et des Emplois (ROME) », version 62 publiée le 2026-10-20 (CHANGELOG v61→v62). Elle contient toutes les appellations et leur code ROME : de quoi générer ou vérifier notre table `apps/worker/src/job-discovery/france-travail/rome.ts`, aujourd'hui marquée NON VÉRIFIÉE.

Et sans conversion : La Bonne Boite accepte `job` en texte libre et renvoie sa résolution dans `resolved_params.jobs`. C'est le plus simple, mais la correspondance se fait sur les libellés ROME, NAF et domaines : à éviter pour des titres anglais ou des sigles (« DAF », « CFO »).

Proposition pour #307 : `romeCodesFor` d'abord (gratuit, déterministe), ROMEO si elle ne trouve rien (en gardant le meilleur score au-dessus d'un seuil), puis `job` en dernier recours ; mettre le résultat en cache par intitulé normalisé.

## 5. Conséquences pour le code

- `apps/web/src/provider-secrets/connection-tests.ts` et `apps/worker/src/job-discovery/france-travail/api.ts` demandent `api_offresdemploiv2 o2dsoffre` : ce scope fait échouer tout le jeton tant qu'Offres d'emploi n'est pas accordée. Le test de connexion doit demander le scope de La Bonne Boite (critère d'acceptation de #307). L'adaptateur Offres d'emploi peut rester inerte ; s'il partage le client, il doit demander son jeton à part.
- Prévoir dans `external_api_usage` (#234) La Bonne Boite et ROMEO comme appels distincts.

## Questions ouvertes (à vérifier avec le vrai client, en staging)
1. Le jeu de scopes exact pour La Bonne Boite (`api_labonneboitev2` seul, ou avec `search office`).
2. Le débit réel (lire `X-Ratelimit-Burst-Capacity-Clientidlimiter`) pour La Bonne Boite et ROMEO.
3. La taille de page par défaut de `/recherche` (10 ou 20).
4. La couverture de La Bonne Boite pour les métiers cadres (ex. M1205, M1302, M1707) : `GET /nombreEntreprise` sur quelques départements donnera l'ordre de grandeur.

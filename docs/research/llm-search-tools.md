# Recherche #384 : outils de recherche natifs des LLM face aux fournisseurs de recherche

Carte : #383. Sources consultées le 2026-10-26 : documentation officielle et pages de prix de chaque fournisseur, citées par section. **NON VÉRIFIÉ** signale une affirmation que seule une source secondaire soutient, ou qu'aucune page primaire ne confirme.

Question : les outils `web_search` natifs des LLM (Anthropic, Mistral Agents, OpenAI) peuvent-ils servir de fournisseur de recherche pour la Job discovery, face à Perplexity Agent API, Brave, Tavily et Linkup ?

Contraintes appliquées : ADR-0007 (seules des requêtes construites depuis les Search Criteria ou un nom d'employeur quittent l'UE ; un fournisseur de recherche ne fait que chercher), le besoin de la Job discovery (filtre pays FR, exclusion des Forbidden sites, restriction à un domaine par Job discovery site, fraîcheur 30 jours via la date de publication, pagination, budget 0,08 € par Job Search).

## Réponse courte

**Non : aucun outil natif de LLM ne remplace un fournisseur de recherche pour la Job discovery.** Il coûte plus cher (10 $ / 1 000 recherches chez Anthropic et OpenAI, plus les résultats facturés en tokens d'entrée), il n'a ni filtre de date ni pagination ni nombre de résultats réglable, et le modèle décide seul de combien de recherches il fait. Ses résultats sont aussi peu exploitables : chez Anthropic, contenu chiffré et `page_age` qui est une date de mise à jour ; chez OpenAI, URL seulement. La recherche web de Claude passe d'ailleurs par Brave (documentation Google Cloud), que nous pouvons appeler directement pour moitié prix et sans tokens.

Recommandation :

| Fournisseur | Décision | Pourquoi |
|---|---|---|
| Perplexity | **Garder, mais passer à la Search API** (`POST /search`, `search_type: "fast"`) | Aucun LLM (ce que le code annonce déjà : « search only »), 0,001 $ par requête en fast, jusqu'à 5 requêtes par appel facturées comme une seule, 20 résultats, pays, domaines (inclusion **ou** exclusion), dates de publication **et** de mise à jour |
| Brave | **Garder** (meilleur second choix) | 5 $ / 1 000, aucun token, index indépendant, pays, `freshness` par plage de dates, 10 pages (`offset` 0-9), 50 req/s ; défaut : pas d'exclusion de domaines |
| Tavily | **Garder** en secours | 1 crédit (0,008 $) par recherche `basic`/`fast`, inclusion 300 / exclusion 150 domaines, dates ; **le pays existe** (contrairement à la carte #383) ; endpoint UE en évaluation |
| Linkup | **Retirer** | Ni date de publication ni pays ni pagination : il ne peut pas tenir la règle des 30 jours ; régions de traitement US/UE/Canada/APAC non garanties malgré son siège en France |
| Anthropic `web_search` | **Ne pas ajouter** | 10 $ / 1 000 + tokens ; pas de filtre de date ; contenu des résultats chiffré ; Brave en coulisse ; pas sur Bedrock |
| OpenAI `web_search` | **Ne pas ajouter** (seule option native à garder en tête) | 10 $ / 1 000 + tokens ; pas de date ni de pagination ; mais seul outil natif traité en UE (résidence UE, +10 %) |
| Mistral `web_search` | **Ne pas ajouter** | Aucun filtre documenté (ni domaine, ni pays, ni date), prix par appel non publié, Agents indisponibles sur l'endpoint régional UE |

## Comparatif

Prix en dollars US, prix catalogue. « Tokens » : ce que la recherche ajoute en tokens facturés au tarif du modèle.

| | Prix par recherche | Tokens | Inclure domaines | Exclure domaines | Pays | Ancienneté | Nb de résultats | Pagination | Date renvoyée | Sources structurées |
|---|---|---|---|---|---|---|---|---|---|---|
| Anthropic `web_search` | 0,010 $ | Oui : résultats = tokens d'entrée | `allowed_domains` | `blocked_domains` (pas les deux) | `user_location.country` | **Non** | Non réglable | Non | `page_age` = dernière mise à jour | URL, titre, `page_age` ; contenu chiffré ; citations ≤ 150 car. |
| OpenAI `web_search` (Responses) | 0,010 $ | Oui : « search content tokens » au tarif du modèle | `filters.allowed_domains` (≤ 100) | `filters.blocked_domains` (≤ 100) | `user_location.country` | **Non** | Non (`search_context_size` low/medium/high) | Non | **Non** | Annotations `url_citation` ; liste `sources` (URL) sur demande |
| Mistral `web_search` | **Non publié** (NON VÉRIFIÉ : 30 $ / 1 000 selon un tiers) | Oui | **Non documenté** | **Non documenté** | **Non documenté** | **Non** | Non | Non | **Non** | Chunks `tool_reference` : titre, URL, source |
| Perplexity Agent API (code actuel) | 0,0025 $ (`web`) ou 0,001 $ (`fast`) ; `fetch_url` 0,0005 $ | Oui : modèle du preset (gpt-6-luna) | `search_domain_filter` (≤ 20) | Même champ, préfixe `-` (pas les deux) | `user_location.country` | `search_recency_filter`, plages de dates de publication et de mise à jour | `max_results` 1-50 | Non (on augmente `max_results`) | `date` (publication) et `last_updated` | `search_results` : URL, titre, extrait, dates |
| Perplexity Search API | 0,005 $ (`web`) ou 0,001 $ (`fast`), par appel de 1 à 5 requêtes | **Aucun** | `search_domain_filter` (≤ 20) | Préfixe `-` (pas les deux) | `country` | Idem Agent API | `max_results` 1-20 | Non | `date` et `last_updated` | URL, titre, extrait, dates |
| Brave Search | 0,005 $ | Aucun | Opérateur `site:` dans `q` | **Non** (Goggles peut-être, NON VÉRIFIÉ) | `country` | `freshness` pd/pw/pm/py ou plage `AAAA-MM-JJtoAAAA-MM-JJ` | `count` ≤ 20 | `offset` 0-9 | `page_age` (lu par le code, #116 ; absent de la page de réponse consultée) | URL, titre, description, `extra_snippets` |
| Tavily | 0,008 $ (`basic`/`fast`/`ultra-fast` : 1 crédit), 0,016 $ (`advanced`) | Aucun | `include_domains` (≤ 300) | `exclude_domains` (≤ 150) | `country` (nom en minuscules, `topic: general`) | `time_range`, `start_date`/`end_date` | `max_results` 0-20 | Non | `published_date` (estimation, peut être une mise à jour) | URL, titre, contenu, score |
| Linkup | 0,005 $ (`flash`/`fast`/`standard`), 0,05 $ (`deep`) | Aucun | `includeDomains` (≤ 100) | `excludeDomains` | **Non** | `fromDate`/`toDate` | `maxResults` | Non | **Non** | URL, nom, contenu |

Coût indicatif d'une recherche via un outil natif : 0,01 $ de frais plus les résultats en tokens d'entrée. À 10 000 tokens de résultats (ordre de grandeur, non mesuré), cela fait 0,0025 $ de plus avec gpt-5-mini (0,25 $ / M) et 0,01 $ avec un modèle à 1 $ / M, plus la réponse du modèle. On arrive à 2 à 4 fois Brave, et 10 à 20 fois la Search API Perplexity en `fast`. Avec 6 requêtes planifiées, 1 par Job discovery site et la pagination, une Job Search ferait plusieurs dizaines de recherches : le budget de 0,08 € ne tient pas.

## Résidence des données et ADR-0007

Ce que reçoit un fournisseur de recherche reste une requête construite depuis les Search Criteria ou un nom d'employeur, nettoyée par la couche IA (`planJobSearch`, rédaction de l'amendement du 2026-10-20). La résidence n'est donc qu'un critère faible ici, comme pour les quatre fournisseurs actuels, tous classés `outside_eu`.

| | Où la requête est traitée | Rétention / ZDR | Compatible ADR-0007 |
|---|---|---|---|
| Anthropic API | Inférence `global` ou `us` seulement ; workspace geo `us` seulement. Requêtes envoyées à « un fournisseur tiers choisi par Anthropic », Brave Search (doc Google Cloud) | `web_search_20250305` éligible ZDR ; versions ≥ `20260209` seulement avec `allowed_callers: ["direct"]` | Oui pour la requête (hors UE). Mais il faudrait un appel Claude de plus, avec un prompt construit par nous, et l'outil n'est pas sur Bedrock (le chemin UE de l'ADR) |
| Claude sur Google Cloud | Région UE possible pour le modèle, mais « la résidence des données ne s'applique pas » pendant le traitement par Brave | Non précisé | Comme ci-dessus ; l'outil est désactivé par défaut (contrainte d'organisation) et bloqué sous VPC-SC |
| OpenAI | `eu.api.openai.com` : web search pris en charge en stockage **et** traitement UE ; +10 % sur les modèles sortis après le 5 mars 2026 | Résidence UE soumise à ZDR ou Modified Abuse Monitoring (avenant) | Oui ; seul outil natif traité en UE |
| Mistral | Endpoint global par défaut ; l'endpoint UE (`api.eu.mistral.ai`) n'accepte que l'appel de fonctions, pas les Agents | Non précisé pour la recherche ; moteur sous-jacent non nommé | Oui pour la requête ; l'atout « UE » de Mistral ne vaut pas pour sa recherche web |
| Perplexity | Lieu de traitement non publié | ZDR sur contrat seulement ; DPA | Oui (hors UE, déjà admis) |
| Brave | Infrastructure propre de bout en bout ; lieu non publié | ZDR « intégrée » annoncée ; stocker les résultats demande un plan avec droits de stockage | Oui (hors UE, déjà admis) |
| Tavily | Standard : non publié. Endpoint UE `api.eu.tavily.com` (Allemagne, index en France) **en évaluation, non GA** | ZDR à activer dans les réglages du compte | Oui ; seule perspective de traitement UE parmi les fournisseurs de recherche |
| Linkup | US, UE, Canada, APAC selon la charge ; « traitement local non garanti » hors contrat Enterprise | ZDR sur demande ; DPA Article 28 sur demande | Oui (hors UE, déjà admis) |

## Limites de débit

| | Limite |
|---|---|
| Anthropic | Limite d'organisation propre à la recherche web, visible dans la Console ; erreur `too_many_requests` renvoyée dans un 200 |
| OpenAI | Les limites par palier du modèle sous-jacent |
| Mistral | Limites de palier de l'organisation (aucune limite propre à la recherche documentée) |
| Perplexity Agent API | 1 req/s au palier 0, 3 au palier 1, jusqu'à 33 (paliers 4-5) |
| Perplexity Search API | 50 unités/s, rafale 50, à tous les paliers (une requête de 5 recherches compte pour 5 unités) |
| Brave | 50 req/s (plan Search), fenêtre glissante d'une seconde, HTTP 429 |
| Tavily | 100 req/min (clé de développement), 1 000 req/min (clé de production) |
| Linkup | Non publié sur la page de prix ; page de doc dédiée inaccessible (404) |

## Détail par fournisseur

### Anthropic `web_search`
Sources : https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool, https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools, https://platform.claude.com/docs/en/manage-claude/data-residency, https://docs.cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/web-search
- Prix : « $10 USD per 1,000 searches, plus standard token costs for search-generated content ». Les résultats comptent comme tokens d'entrée, sur le tour courant et les suivants. Une recherche en erreur n'est pas facturée.
- Versions : `web_search_20250305` (de base), `20260209` (filtrage dynamique par exécution de code), `20260318` (`response_inclusion`).
- Paramètres : `max_uses`, `allowed_domains` **ou** `blocked_domains` (sous-chemins acceptés, joker seulement dans le chemin), `user_location` (pays ISO à 2 lettres). Aucun paramètre de date, de nombre de résultats ou de page.
- Résultats : `url`, `title`, `page_age` (« When the site was last updated »), `encrypted_content`. Le texte lisible n'arrive que par les citations (`cited_text`, 150 caractères au plus).
- Plateformes : Claude API, Claude Platform on AWS, Google Cloud (géré par Anthropic ; seulement la version de base s'il est géré par Google), Microsoft Foundry. **Amazon Bedrock n'est pas listé.**
- Google Cloud : les requêtes partent vers « a third-party search service provider selected by Anthropic », nommé Brave Search ; CMEK et résidence des données ne s'y appliquent pas.

### OpenAI `web_search`
Sources : https://developers.openai.com/api/docs/guides/tools-web-search, https://developers.openai.com/api/docs/pricing, https://developers.openai.com/api/docs/guides/your-data
- Prix : « $10.00 / 1k calls + Search content tokens billed at model rates ». gpt-4o-mini et gpt-4.1-mini sont facturés par bloc fixe de 8 000 tokens par appel. `web_search_preview` sur un modèle sans raisonnement : 25 $ / 1 000, tokens offerts.
- Paramètres : `filters.allowed_domains` et `filters.blocked_domains` (100 chacun), `user_location`, `search_context_size`, `external_web_access` (mode cache seul). Pas de date ni de nombre de résultats : `search_context_size` « does not guarantee a specific number of sources ».
- Sorties : annotations `url_citation` (URL, titre, position) ; `include: ["web_search_call.action.sources"]` donne toutes les URL consultées. La page ne mentionne aucune date de publication.
- Résidence : la web search figure dans les listes de stockage et de traitement UE ; les points d'accès régionaux coûtent +10 % pour les modèles sortis depuis le 5 mars 2026.

### Mistral `web_search` / `web_search_premium`
Sources : https://docs.mistral.ai/agents/tools/built-in/websearch, https://docs.mistral.ai/inference/regional-inference, https://mistral.ai/pricing
- Deux outils : `web_search` (« A simple web search tool ») et `web_search_premium` (ajoute des articles de presse vérifiés). Seulement via l'API Conversations ou Agents, pas Chat Completions.
- Aucun paramètre documenté au-delà de `{"type": "web_search"}` : ni domaine, ni pays, ni date, ni nombre de résultats.
- Sorties : chunks `tool_reference` avec `title`, `url`, `source`, sans date.
- Prix : la page de prix dit seulement que « tool APIs are priced per call ». Aucun montant publié. **NON VÉRIFIÉ** : 30 $ / 1 000 selon un agrégateur tiers (curlscape.com).
- Région : l'endpoint UE n'accepte que l'appel de fonctions comme outil, et pas les Agents ; la recherche web passe donc par l'endpoint global.

### Perplexity (Agent API et Search API)
Sources : https://docs.perplexity.ai/getting-started/pricing, https://docs.perplexity.ai/docs/agent-api/tools/web-search.md, https://docs.perplexity.ai/docs/agent-api/tools/fetch-url-content.md, https://docs.perplexity.ai/docs/agent-api/presets, https://docs.perplexity.ai/docs/agent-api/models, https://docs.perplexity.ai/docs/resources/changelog.md, https://docs.perplexity.ai/api-reference/search-post.md, https://docs.perplexity.ai/docs/search/filters/domain-filter.md, https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers, https://docs.perplexity.ai/docs/resources/privacy-security.md
- Outils de l'Agent API : `web_search` coûte 2,50 $ / 1 000 (`search_type: "web"`) ou 1,00 $ / 1 000 (`"fast"`). **`fetch_url` coûte 0,50 $ / 1 000 (0,0005 $ par appel)**, avec `max_urls` de 1 à 10 par appel.
- Presets → effort (octobre 2026) : « a naming change only ». `preset` reste un alias déprécié, sans date de retrait. L'effort `fast` exécute `openai/gpt-6-luna`, `web_search` en `search_type: "fast"`, un seul pas, palier de service priority, sans `fetch_url`. Les efforts `low` et `medium` ajoutent `fetch_url`.
- Endpoint : `/v1/agent` est canonique depuis mars 2026 ; `/v1/responses` reste un alias.
- Tokens : `openai/gpt-6-luna` coûte 0,10 $ / 0,50 $ par million ; priority 2×, soit 0,20 $ / 1,00 $.
- Search API : 5 $ / 1 000 (`web`), 1 $ / 1 000 (`fast`). Une requête de 5 recherches au plus compte pour une unité facturée. `max_results` ≤ 20 en web, `country`, `search_domain_filter` (20 au plus, préfixe `-` pour exclure, pas de mélange), filtres de récence, de date de publication et de date de mise à jour ; chaque résultat porte `date` et `last_updated`. Pas de pagination.
- Confidentialité : lieu de traitement non publié ; ZDR seulement sur contrat ; pas d'entraînement sur les contenus client.

### Brave Search API
Sources : https://brave.com/search/api/, https://api-dashboard.search.brave.com/app/documentation/web-search/query, https://api-dashboard.search.brave.com/app/documentation/web-search/responses
- Plan Search : 5 $ / 1 000, 5 $ de crédit gratuit par mois, 50 req/s. Le plan Answers (avec LLM) coûte 4 $ / 1 000 plus 5 $ / M de tokens, à 2 req/s.
- `count` ≤ 20, `offset` de 0 à 9, `country` à 2 lettres, `freshness` (pd/pw/pm/py ou une plage), `extra_snippets` (5 extraits de plus au plus), `query.more_results_available` pour savoir s'il y a une page suivante.
- Pas de paramètre d'inclusion ou d'exclusion de domaines : il faut l'opérateur `site:` dans la requête. Les Goggles peuvent remonter ou rétrograder des domaines ; leur capacité à en exclure n'a pas pu être vérifiée (page 404).
- Les CGU interdisent de stocker les résultats au-delà du transitoire, sauf avec un plan qui donne des droits de stockage.

### Tavily
Sources : https://docs.tavily.com/documentation/api-reference/endpoint/search, https://docs.tavily.com/documentation/api-credits, https://docs.tavily.com/documentation/rate-limits, https://www.tavily.com/eu
- `basic`, `fast` et `ultra-fast` coûtent 1 crédit, `advanced` 2 crédits. Un crédit vaut 0,008 $ en paiement à l'usage, 0,005 $ à 0,0075 $ en abonnement ; 1 000 crédits gratuits par mois.
- `country` : nom de pays en minuscules (`france`), seulement avec `topic: "general"`. **L'adaptateur actuel ne l'envoie pas**, et la carte #383 dit à tort que Tavily n'a pas de pays.
- `include_domains_mode: "prefer"` existe à côté de `restrict` (le mode par défaut).
- `published_date` : « best estimate of when the source was published or last updated ».
- Endpoint UE `api.eu.tavily.com` : traitement en Allemagne, index en France, ZDR à activer. « It is not generally available. »

### Linkup
Sources : https://docs.linkup.so/pages/documentation/api-reference/endpoint/post-search, https://docs.linkup.so/pages/documentation/platform/pricing.md, https://docs.linkup.so/pages/security-and-privacy/data-processing-privacy.md
- Profondeurs `flash`, `fast`, `standard`, `deep`. `searchResults` coûte 0,005 $ (0,05 $ en `deep`). Les prix sont **en dollars**, alors que `cost.ts` les traite comme des euros. Endpoint Fetch : 0,001 $ à 0,011 $.
- Pas de paramètre pays, pas de pagination, et aucune date dans les résultats `searchResults`.
- Traitement : « Linkup operates infrastructure in the US, EU, Canada, and APAC » ; « Local query processing is not guaranteed » hors contrat Enterprise.

## Écarts relevés dans le code (pour #388 et la carte)

1. `cost.ts` facture Perplexity 0,0025 $ par recherche. Or le preset `fast` règle `search_type: "fast"`, soit 0,001 $. La doc ne dit pas si ce réglage tient quand on passe `tools` explicitement : il faut le vérifier sur une facture ou forcer `search_type`. Les tokens sont comptés à 0,2 / 1,2 $ ; le tarif réel de gpt-6-luna en priority est 0,20 / 1,00 $.
2. `fetch_url` (0,0005 $) est compté par `ToolTally`, mais `toolCostInEur` renvoie `null` pour tout autre outil que `web_search` : son coût n'apparaît pas dans Consommation IA. L'effort `fast` ne l'active pas ; `low` et `medium` l'activent.
3. `preset` est un alias déprécié d'`effort` ; `/v1/responses` est un alias de `/v1/agent`. Les deux marchent aujourd'hui, mais sans garantie de durée.
4. Tavily a un filtre pays que l'adaptateur n'utilise pas.
5. Linkup est facturé en dollars, pas en euros : `cost.ts` le surestime d'environ 16 %.

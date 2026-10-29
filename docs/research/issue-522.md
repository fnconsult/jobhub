# Issue #522 : entité, lieu de traitement et garantie de transfert de chaque destinataire

Partie de #494, suite de `docs/research/issue-498.md` §6 (branche `research/issue-498`). Sources lues le 2026-10-29 : DPA, conditions, politiques de confidentialité, listes de sous-traitants et documentation des fournisseurs eux-mêmes. Chaque fait porte son URL. Ce que la source primaire ne dit pas, ou que nous n'avons pas pu lire, est marqué **« non vérifié »**.

**Liste DPF du Department of Commerce : non vérifiée.** Le site `dataprivacyframework.gov` est une application JavaScript dont l'API de recherche (`dpfapi.azurewebsites.net/api/Organization/paged`) exige une authentification. Les statuts DPF ci-dessous viennent donc de la déclaration du fournisseur lui-même. Il faut les contrôler à la main sur https://www.dataprivacyframework.gov/list avant de les publier.

## En bref

1. **Anthropic (API directe) : Anthropic Ireland, Limited contracte, mais l'inférence et le stockage sont hors UE.** Le DPA repose sur les CCT (modules 2 et 3). Sur l'API directe, `inference_geo` n'accepte que `global` (par défaut : « any available geography ») ou `us`, et le seul *workspace geo* est `us`. Aucune option UE. Conservation des entrées et sorties : 30 jours ; aucun entraînement sur le contenu client.
2. **Mistral : le code n'appelle pas l'endpoint UE.** `packages/ai/src/providers/chat-completions.ts:95` vise `https://api.mistral.ai/v1` et déclare `residency: "eu"`. Or Mistral écrit que pour cet endpoint global elle « does not commit to a specific inference location ». Seul `api.eu.mistral.ai` garantit une inférence dans l'UE et l'AELE. **Cela fragilise la route d'identité sous Consentement IA UE et les tâches `euOnly`** (ADR-0007, ADR-0055). Il faut basculer sur `api.eu.mistral.ai` (+10 % de prix) et désactiver l'option d'entraînement dans l'Admin Mistral.
3. **Perplexity, Brave et Tavily sont des sociétés américaines qui ne citent pas le DPF.** Perplexity et Tavily invoquent les CCT. Le DPA de Perplexity prévient que « Perplexity Search » peut suivre une « data posture » différente. Brave exclut les requêtes de son DPA et les garde 90 jours. Tavily peut réutiliser des requêtes pour s'améliorer, sauf clause contraire.
4. **Les destinataires dans l'UE ou en pays adéquat** sont Brevo (Brevo SAS, Paris ; OVH France et GCP Belgique), Hostinger (Hostinger International Ltd, Chypre ; VPS à Paris), Kaspr (KASPR SAS, Paris), Lusha (traitement en Israël, pays adéquat) et Fantastic.jobs (Amsterdam ; DPA et hébergement non trouvés).
5. **Stripe, Apollo, Google et Microsoft se déclarent certifiés DPF**, avec les CCT en repli. Apple s'appuie sur les CCT seules. Google, Microsoft et Apple agissent comme responsables distincts pour la connexion, via leur entité irlandaise.

## 1. Tableau de synthèse

| Destinataire | Entité contractante (UE / FR) | Lieu de traitement | Garantie du transfert | Rétention, entraînement (API) | Rôle |
| --- | --- | --- | --- | --- | --- |
| **Anthropic** (API directe) | Anthropic Ireland, Limited [A1] | Hors UE : inférence `global` (toute géographie) ou `us` ; stockage `us` seulement [A3] ; serveurs aux États-Unis [A4] | CCT modules 2 et 3, droit irlandais [A2]. DPF : non mentionné [A2][A4], **non vérifié** | 30 jours, plus 2 ans (entrées et sorties) et 7 ans (scores) en cas de signalement par la sécurité ; ZDR sur accord [A5]. Pas d'entraînement [A1] | Sous-traitant |
| **Mistral** | Mistral AI SAS, 15 rue des Halles, 75001 Paris (RCS 952 418 325) [M1] | UE par défaut pour l'hébergement [M3], mais **aucun lieu d'inférence garanti sur `api.mistral.ai`**, celui qu'utilise le code [M4] ; transferts temporaires hors UE selon la fonction [M3] | Adéquation ou CCT pour les sous-traitants hors UE [M1][M3] | Fin du contrat + 30 jours [M1]. Entraînement : « isn't used » [M5] **mais** une option d'opt-out existe pour l'API dans l'Admin [M6] (contradiction, à désactiver) | Sous-traitant ; responsable pour l'entraînement si non désactivé [M1] |
| **Perplexity** (Search API) | Perplexity AI, Inc. (adresse non donnée) [P1] | Non indiqué [P1][P2] ; sous-traitants : https://trust.perplexity.ai/subprocessors (**non lu**, page JS) | CCT modules 2 et 3, addendum britannique ; DPF non mentionné [P1] | ZDR pas par défaut, sur accord écrit [P2]. Pas d'entraînement sur le contenu client [P2]. **Le DPA peut ne pas s'appliquer tel quel à « Perplexity Search »** [P1] | Sous-traitant |
| **Brave** (Search API) | Brave Software, Inc., 580 Howard Street, Unit 402, San Francisco ; droit californien [B1] | États-Unis (siège) ; lieu de traitement non indiqué [B2] | Renvoi à un DPA (**non lu** : PDF en 403) ; d'après sa propre description, il exclut les requêtes [B3] | Journaux de requêtes 90 jours ; ZDR pour l'offre Enterprise [B2]. Pas de droit d'entraînement accordé dans les conditions [B1] | Sous-traitant (requêtes hors DPA) |
| **Tavily** | AlphaAI Technologies Inc. d/b/a Tavily, 1350 Broadway, 24th Floor, New York [T1] | États-Unis ; endpoint UE `api.eu.tavily.com` réservé à des évaluations, pas disponible au public [T2] | CCT et addendum britannique (offre entreprise) ; DPF non mentionné [T1]. DPA public : **non trouvé** | Durée du compte ; **requêtes réutilisables pour améliorer le service** sauf clause contraire [T1] | Sous-traitant (responsable pour l'amélioration) |
| **Stripe** | Stripe Payments Europe, Limited (Irlande) [S1] | Transfert vers Stripe, LLC aux États-Unis et « à l'échelle mondiale » [S2] | DPF (Stripe, Inc.) [S3], CCT modules 1 à 3, addendum britannique [S2] | Sans objet | Sous-traitant, et responsable pour la fraude et la LCB-FT [S2] |
| **Brevo** (envoi) | Brevo SAS, 9-17 rue Salneuve, 75017 Paris (RCS 498 019 298) ; droit français [V1] | Hébergement OVH (France) et Google Cloud (Belgique) ; CDN Cloudflare (États-Unis et UE) [V1] | Sans objet pour OVH ; DPF et CCT pour GCP, Cloudflare, Brevo Inc. ; CCT pour Brevo CRM Solutions (Inde) [V1] | Non lu | Sous-traitant |
| **Brevo** (Inbound Parsing) | Brevo SAS [V1] | Comme l'envoi [V1] | Comme l'envoi | Non lu | Sous-traitant. **Non vérifié** : l'annexe 1 du DPA décrit l'envoi, le stockage et l'analyse ; l'entrant n'y est pas nommé [V1] |
| **Hostinger** | Hostinger International Limited, 61 Lordou Vironos str., 6023 Larnaca, Chypre [H1] | VPS dans le centre de données de Paris [H3] ; données de compte au Royaume-Uni, aux Pays-Bas, en Lituanie ou à Chypre [H4] | CCT modules 2 et 3 [H2][H4] ; DPF non mentionné | Sans objet | Sous-traitant |
| **Fantastic.jobs** | Fantastic.jobs, Jacques Veltmanstraat 31, 1065EG Amsterdam [F1] | **Non indiqué** ; API derrière Cloudflare (DNS) | **Non trouvé** : aucune condition d'API ni DPA public [F1][F2] | Non trouvé | Destinataire de requêtes |
| **Google** (connexion) | Google Ireland Limited [G1] | Mondial | DPF (Google LLC) et CCT [G2] | Sans objet | Responsable distinct |
| **Microsoft** (connexion) | Microsoft Ireland Operations Limited [MS1] | Mondial | DPF (Microsoft Corporation) et CCT [MS1] | Sans objet | Responsable distinct |
| **Apple** (connexion) | Apple Distribution International Limited (Irlande) [AP1] | Mondial | CCT ; DPF non mentionné [AP1] | Sans objet | Responsable distinct |
| **Lusha** | Lusha Systems, Inc. ; droit de New York par défaut [L1] | **Israël** (adéquation) ; hébergement AWS en Irlande [L1][L2]. Option « Europe Service » : aucun traitement dans un pays tiers [L1] | Adéquation pour Israël ; CCT module 2 (sous-traitant) ou 1 (responsable) [L1] | Non lu | Sous-traitant, et responsable pour sa propre base [L1] |
| **Apollo** | ZenLeads Inc. d/b/a Apollo.io, 440 N Barranca Ave #4750, Covina, CA [AO1] | États-Unis (« US-based data center providers ») [AO1] | DPF en premier, CCT modules 1 et 2 en repli, droit irlandais [AO1] | Non lu | Sous-traitant, et responsable indépendant |
| **Kaspr** | KASPR SAS, 8 rue Dunois, 75013 Paris (RCS 843 898 396), groupe Cognism [K1] | UE « as far as possible » ; OVH et MongoDB nommés, sans lieu ; analytics Google et HubSpot aux États-Unis [K1] | CCT, sur demande à privacy@kaspr.io [K1]. DPA client : **non lu** | Non lu | Sous-traitant (DPA à obtenir) |

## 2. Détail par fournisseur

### Anthropic (API directe, `api.anthropic.com`)

- **Entité.** Pour un client établi dans l'EEE, « Anthropic » désigne Anthropic Ireland, Limited (Commercial Terms, préambule) [A1]. Le DPA nomme comme importateur « the Anthropic entity that executed the Agreement » [A2].
- **Lieu.** La documentation Data residency indique deux valeurs d'`inference_geo` : `global` (par défaut, « Inference may run in any available geography ») et `us`. Le *workspace geo*, qui fixe le stockage au repos, n'a qu'une valeur : `us` [A3]. La politique de confidentialité parle d'un transfert vers « our servers in the US, or to other countries outside the EEA » [A4]. **Aucune option UE sur l'API directe** ; seules Bedrock et Vertex AI (Google managed) proposent des régions UE [A3].
- **Garantie.** CCT de la décision 2021/914, modules 2 et 3, option 2 de la clause 9, droit irlandais ; addenda britannique et suisse [A2]. Ni le DPA ni la politique de confidentialité ne citent le DPF [A2][A4]. **Statut DPF d'Anthropic, PBC : non vérifié.**
- **Rétention.** Suppression des entrées et sorties sous 30 jours, sauf rétention plus longue choisie par le client (Files API), accord ZDR, application de la Usage Policy (jusqu'à 2 ans, scores 7 ans) ou obligation légale [A5]. Restitution ou suppression 30 jours après la fin du contrat [A2].
- **Entraînement.** « Anthropic may not train models on Customer Content from Services » [A1].
- **Sous-traitants.** https://trust.anthropic.com/subprocessors (page JS, **non lue**) [A2].
- **Pour Jobbbox.** Le choix entre `us` et `global` reste à faire. `global` peut envoyer l'inférence hors des États-Unis. `us` coûte 1,1 fois le prix et fixe un seul pays tiers [A3]. Aujourd'hui le code ne passe pas `inference_geo`, la valeur par défaut du workspace s'applique.

### Mistral

- **Entité.** Mistral AI, société par actions simplifiée française, RCS 952 418 325, 15 rue des Halles, 75001 Paris [M1].
- **Lieu.** « By default, your data is hosted in the European Union », sauf usage explicite de l'endpoint américain. Selon la fonction, des transferts temporaires hors UE vers les sous-traitants sont possibles [M3]. **Mais pour l'inférence, la page Regional inference dit de l'endpoint global `api.mistral.ai` : « Mistral does not commit to a specific inference location for requests sent to this endpoint. »** Seul `api.eu.mistral.ai` sert à « support inference processing within the European Union », sur des centres de données de l'UE et de l'AELE. Il ne couvre pas Agents, Batch ni Files, et le plan de contrôle (clés, facturation, analytics d'usage) peut rester hors de la région [M4]. Le prix est majoré de 10 % [M5].
- **Écart avec le code.** `createMistralProvider` utilise `https://api.mistral.ai/v1` et déclare `residency: "eu"` (`packages/ai/src/providers/chat-completions.ts:93-101`). Cette déclaration n'est pas couverte par un engagement de Mistral.
- **Garantie.** Transferts vers des pays tiers sur décision d'adéquation, autres garanties appropriées ou CCT [M1] ; article 46 et CCT pour les sous-traitants hors UE [M3].
- **Rétention.** Pendant le contrat, puis inaccessibles 30 jours après la fin de l'accès [M1]. ZDR sur demande [M5].
- **Entraînement.** La page Inference affirme « Data sent through our API isn't used for model training » [M5]. Pourtant le DPA prévoit que Mistral peut utiliser les données personnelles pour entraîner ses modèles, comme responsable, sauf opt-out [M1]. Le centre d'aide décrit le bouton à couper (Admin, Privacy, « Anonymous improvement data ») pour l'API [M6]. **À désactiver et à vérifier dans la console.**
- **Sous-traitants.** https://trust.mistral.ai/subprocessors (page JS, **non lue**) [M1].

### Perplexity (Search API, `api.perplexity.ai/search`)

- **Entité.** Perplexity AI, Inc. ; le DPA ne donne pas d'adresse [P1].
- **Lieu.** Ni le DPA ni la page Privacy & Security ne le précisent [P1][P2]. Liste des sous-traitants sur https://trust.perplexity.ai/subprocessors (**non lue**).
- **Garantie.** CCT modules 2 et 3, addendum britannique. Pas de mention du DPF [P1].
- **Réserve.** Le DPA prévient que certains services, dont l'Embeddings API et **Perplexity Search**, « may operate under data postures that differ from this DPA » [P1]. C'est justement l'API qu'utilise Jobbbox.
- **Rétention et entraînement.** ZDR « available only to eligible customers through an account-level configuration under a written agreement ». Pas d'entraînement sur le contenu client selon les API Terms, sauf conditions propres à un produit [P2].

### Brave (Search API, `api.search.brave.com`)

- **Entité.** Brave Software, Inc., société du Delaware, 580 Howard Street, Unit 402, San Francisco, CA 94105 ; droit californien, tribunaux de San Francisco [B1].
- **Lieu.** « provided by Brave Software Inc located in the U.S. » ; aucun lieu de traitement précisé [B2].
- **Garantie.** Les conditions renvoient à une « data protection addendum available on the Website » [B1]. Le PDF du DPA (version du 2025-09-09) renvoie HTTP 403 : **non lu**. D'après sa description par Brave, il ne s'applique pas aux requêtes envoyées par l'API, faute de pouvoir relier une requête à une personne [B3, non lu directement].
- **Rétention.** Journaux de requêtes « retained for a maximum of 90 days » ; ZDR pour l'offre Enterprise ; données de compte 12 mois après la suppression [B2].
- **Entraînement.** Les conditions accordent à Brave une licence limitée au fonctionnement de l'API, sans droit d'entraînement [B1].

### Tavily (`api.tavily.com`)

- **Entité.** AlphaAI Technologies Inc. d/b/a Tavily, 1350 Broadway, 24th Floor, New York, NY 10018 [T1].
- **Lieu.** États-Unis. L'endpoint UE (`api.eu.tavily.com` : API en Allemagne, index en France) est réservé à des évaluations, « not generally available », et le compte, l'usage et la facturation restent aux États-Unis [T2].
- **Garantie.** CCT et addendum britannique pour les abonnements entreprise ; DPF non mentionné [T1]. **Aucun DPA ni aucune liste de sous-traitants publics trouvés.**
- **Rétention.** « for as long as you maintain an account with us » [T1].
- **Entraînement.** « we may use certain portions of your query data to improve our responses to future queries », sauf clause contraire du contrat [T1].

### Stripe

- **Entité.** Pour un compte établi en France ou dans l'EEE : Stripe Payments Europe, Limited (SSA, §12) [S1].
- **Lieu.** Le DPA décrit un transfert vers « Stripe, LLC aux États-Unis » et autorise des transferts « à l'échelle mondiale » [S2].
- **Garantie.** DPF : « Stripe, Inc. se conforme au Cadre de protection des données UE-États-Unis » (avec les extensions britannique et suisse) [S3]. CCT modules 1, 2 et 3, addendum britannique, Data Transfers Addendum [S2].
- **Rôle.** Sous-traitant pour le compte du marchand, responsable pour ses propres finalités : fraude, LCB-FT, KYC [S2]. Sous-traitants : https://stripe.com/legal/service-providers.

### Brevo (envoi et Inbound Parsing)

- **Entité.** Brevo SAS, RCS Paris 498 019 298, 9-17 rue Salneuve, 75017 Paris ; droit français, tribunal de commerce de Paris [V1].
- **Lieu et garanties (annexe des sous-traitants du DPA).** OVH, hébergement, serveurs en France, sans transfert. Google Cloud Platform, hébergement, serveurs en Belgique, avec DPF, CCT et mesures supplémentaires. Cloudflare, CDN et WAF, États-Unis et UE, avec DPF, CCT et Data Localization Suite. Les sociétés du groupe font support et maintenance : Brevo Inc. (États-Unis, DPF et CCT), Brevo CRM Solutions (Inde, CCT). Le DPA se réserve de « rely on the EU-US Data Privacy Framework for transfers to the US » [V1]. L'annexe nomme aussi Anthropic, OpenAI et Gemini comme sous-traitants IA « optionnels », seulement si l'on utilise les fonctions IA de Brevo [V1].
- **Inbound Parsing.** L'annexe 1 décrit la nature du traitement (« Collect, host, analyze… Customer Data », « Send electronic communications ») sans nommer la réception d'e-mails entrants. **Le fait que le DPA couvre l'entrant reste non vérifié** (ADR-0051 `:9`) : à confirmer avec Brevo.
- **Rétention.** Non lue.

### Hostinger

- **Entité.** Pour un client de l'UE : Hostinger International Limited, 61 Lordou Vironos str., 6023 Larnaca, Chypre (conditions générales, §2) [H1]. La France n'appartient ni au Groupe 1 ni au Groupe 2, d'après la règle par défaut ; la liste des groupes n'a pas été lue.
- **Lieu.** Centre de données de Paris, ouvert aux VPS [H3]. Les données de compte peuvent être stockées au Royaume-Uni, aux Pays-Bas, en Lituanie ou à Chypre, et certains serveurs sont hors EEE (États-Unis, Brésil, Singapour, Indonésie) [H4].
- **Garantie.** CCT modules 2 et 3, addendum britannique [H2] ; DPF non mentionné [H4].
- **Sous-traitants (annexe 3 du DPA).** AWS EMEA, Google Cloud EMEA, Cloudflare, MailChannels, Proofpoint, Anthropic Ireland, spectra tech UAB, Vonage B.V. [H2].

### Fantastic.jobs (`data.fantastic.jobs`)

- **Entité.** « Fantastic.jobs », Jacques Veltmanstraat 31, 1065EG Amsterdam ; autorité de contrôle : Autoriteit Persoonsgegevens [F1]. Numéro KvK non indiqué.
- **Lieu, garantie, rétention.** **Non trouvés.** La déclaration de confidentialité ne couvre que le site et la newsletter (Beehiiv, Cloudflare hors UE) [F1]. Aucune condition d'API ni aucun DPA publics [F2]. L'API est aussi distribuée via RapidAPI et Apify [F2]. Jobbbox n'y envoie qu'un intitulé et un lieu, sans nommer le Candidat (`issue-498.md` §2).

### Google, Microsoft, Apple (connexion OAuth)

- **Google.** Responsable pour l'EEE : Google Ireland Limited [G1]. Google LLC « has certified that it adheres to the DPF Principles » et utilise les CCT [G2].
- **Microsoft.** Responsable pour l'EEE : Microsoft Ireland Operations Limited. Microsoft Corporation « complies with the EU-U.S. Data Privacy Framework » et utilise les CCT [MS1].
- **Apple.** Responsable pour l'EEE : Apple Distribution International Limited (Irlande) ; transferts « governed by Standard Contractual Clauses » ; DPF non mentionné [AP1].
- Les trois agissent comme responsables distincts : le Candidat leur confie son compte, et Jobbbox reçoit l'e-mail et le nom.

### Lusha, Apollo, Kaspr (Contacts enrichis, désactivés)

- **Lusha.** DPA avec Lusha Systems, Inc. ; droit de New York par défaut. Le DPA constate qu'Israël bénéficie d'une décision d'adéquation et que les données y sont traitées. Avec le « Europe Service », Lusha s'engage à ne traiter aucune donnée dans un pays tiers. Sinon, CCT module 2 (sous-traitant) ou module 1 (responsable) [L1]. Hébergement AWS en Irlande, avec d'autres sous-traitants en Allemagne, en Irlande, en France et aux Pays-Bas [L2]. DPF non mentionné.
- **Apollo.** DPA avec ZenLeads Inc. d/b/a Apollo.io, 440 N Barranca Ave #4750, Covina, CA 91723. Apollo dit participer au DPF et en faire son mécanisme principal, avec les CCT modules 1 et 2 en repli, droit irlandais. Hébergement chez des « outsourced, US-based data center providers ». Sous-traitants sur https://trust.apollo.io/ [AO1].
- **Kaspr.** KASPR SAS, RCS Paris 843 898 396, 8 rue Dunois, 75013 Paris, membre du groupe Cognism. Données traitées dans l'UE « as far as possible » ; OVH et MongoDB nommés sans lieu ; Google et HubSpot aux États-Unis pour l'analytics ; CCT disponibles sur demande [K1]. **DPA client non lu** : à demander à privacy@kaspr.io.

## 3. Conséquences pour #494

| Point | Effet |
| --- | --- |
| Mistral via `api.mistral.ai` | Ni la route d'identité ni les tâches `euOnly` ne sont garanties dans l'UE. Il faut passer à `api.eu.mistral.ai` (et vérifier que les modèles utilisés y sont servis) ou corriger la promesse. Il faut aussi couper l'option d'entraînement dans l'Admin Mistral. |
| Anthropic | Le transfert hors UE est certain, inférence et stockage compris. La garantie est faite des CCT du DPA. Choisir `inference_geo` (`us` ou `global`) et le nommer dans la Recipient list. |
| Perplexity Search | Le DPA peut ne pas s'appliquer tel quel : demander à Perplexity la « data posture » de la Search API, ou un ZDR écrit. |
| Brave | Les requêtes sont hors DPA et gardées 90 jours. C'est acceptable si les requêtes ne contiennent pas de données personnelles (ADR-0007), mais à écrire. |
| Tavily | Pas de DPA public ; réutilisation des requêtes possible. À éviter tant qu'aucun contrat ne l'exclut. |
| Brevo Inbound | Vérifier par écrit que le DPA couvre la réception (ADR-0051). |
| Fantastic.jobs | Aucune information sur le traitement : demander des conditions d'API et le lieu d'hébergement. |
| Kaspr | Demander le DPA client. |

## 4. Non vérifié

- Le statut DPF de chaque société sur la liste officielle (API authentifiée).
- Les listes de sous-traitants d'Anthropic, de Mistral et de Perplexity (pages JS, non rendues).
- Le DPA de la Brave Search API (PDF en 403).
- Le DPA et les sous-traitants de Tavily, le DPA de Kaspr, les conditions d'API de Fantastic.jobs (non trouvés).
- La couverture de l'Inbound Parsing par le DPA de Brevo.
- La liste des pays des Groupes 1 et 2 de Hostinger (on suppose que la France relève du cas par défaut, Chypre).

## Sources

- [A1] Anthropic, Commercial Terms of Service : https://www.anthropic.com/legal/commercial-terms
- [A2] Anthropic, Data Processing Addendum : https://www.anthropic.com/legal/data-processing-addendum
- [A3] Claude Platform Docs, Data residency : https://platform.claude.com/docs/en/manage-claude/data-residency
- [A4] Anthropic, Privacy Policy : https://www.anthropic.com/legal/privacy
- [A5] Anthropic Privacy Center, durée de conservation (organisations) : https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data ; voir aussi https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention
- [M1] Mistral AI, Data Processing Addendum : https://legal.mistral.ai/terms/data-processing-addendum
- [M3] Mistral Help Center, « Where do you store my data » : https://help.mistral.ai/en/articles/347629-where-do-you-store-my-data-or-my-organization-s-data
- [M4] Mistral Docs, Regional inference : https://docs.mistral.ai/inference/regional-inference
- [M5] Mistral, Inference : https://mistral.ai/cloud/inference/
- [M6] Mistral Help Center, opt-out de l'entraînement : https://help.mistral.ai/en/articles/455207-can-i-opt-out-of-my-input-or-output-data-being-used-for-training
- [P1] Perplexity, Data Processing Addendum : https://www.perplexity.ai/hub/legal/dpa
- [P2] Perplexity Docs, Privacy & Security : https://docs.perplexity.ai/docs/resources/privacy-security
- [B1] Brave Search API, Terms of Service : https://api-dashboard.search.brave.com/documentation/resources/terms-of-service
- [B2] Brave Search API, Privacy notice : https://api-dashboard.search.brave.com/privacy-policy
- [B3] Brave Search API, DPA du 2025-09-09 (non lu, HTTP 403) : https://cdn.search.brave.com/search-api/web/v1/client/_app/immutable/assets/brave-search-api-dpa-2025-09-09.DRXCoye6.pdf
- [T1] Tavily, Privacy Policy : https://www.tavily.com/privacy
- [T2] Tavily Search EU : https://www.tavily.com/eu
- [S1] Stripe Services Agreement, §12 : https://stripe.com/legal/ssa
- [S2] Stripe, Data Processing Agreement : https://stripe.com/legal/dpa
- [S3] Stripe, Privacy Policy : https://stripe.com/privacy
- [V1] Brevo, Terms of Service (avec DPA et annexe des sous-traitants) : https://www.brevo.com/legal/termsofuse/
- [H1] Hostinger, Terms of Service, §2 : https://www.hostinger.com/legal/universal-terms-of-service-agreement
- [H2] Hostinger, Data Processing Addendum : https://www.hostinger.com/legal/dpa
- [H3] Hostinger, centre de données de Paris : https://www.hostinger.com/blog/french-data-center/ ; https://www.hostinger.com/vps/servers/france
- [H4] Hostinger, Privacy Policy : https://www.hostinger.com/legal/privacy-policy
- [F1] Fantastic.jobs, Privacy Statement : https://fantastic.jobs/legal
- [F2] Fantastic.jobs, About : https://fantastic.jobs/about
- [G1] Google, Privacy Policy : https://policies.google.com/privacy
- [G2] Google, Data transfer frameworks : https://policies.google.com/privacy/frameworks
- [MS1] Microsoft, Privacy Statement : https://www.microsoft.com/en-us/privacy/privacystatement
- [AP1] Apple, Privacy Policy : https://www.apple.com/legal/privacy/en-ww/
- [L1] Lusha, Data Processing Addendum : https://www.lusha.com/legal/dpa-2-2/
- [L2] Lusha, Third-Party Subprocessors : https://www.lusha.com/subprocessors/
- [AO1] Apollo, Data Processing Addendum : https://www.apollo.io/dpa
- [K1] Kaspr, Privacy Policy : https://www.kaspr.io/privacy-policy

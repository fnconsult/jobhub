# Recherche pour l'issue #497 : ce que l'AI Act impose à Jobbbox de publier

Vérifié le 2026-10-29 sur `main` (`4bb35f1f`). Part de `docs/research/issue-318.md` (art. 50), d'ADR-0007 (amendé le 2026-10-20 et le 2026-10-28), ADR-0022, ADR-0023, ADR-0036, ADR-0052, ADR-0055 et de `CONTEXT.md` (**Redaction**, **EU AI Consent**, **AI disclosure**, **Guardrail**). Carte : #494. Débloque #337 et #503.

**Ce n'est pas un avis juridique.** Les points à faire trancher par un juriste sont marqués **Juriste** et repris à la fin.

## Réponse courte

- **Rôle.** Jobbbox est **fournisseur** (art. 3(3)) de ses systèmes d'IA : l'AI Coach, le Back Office Assistant, les textes générés (Tailored Documents, Company Dossier, résumés d'offres, Action Cards). Il les met sur le marché sous son propre nom, même s'ils reposent sur Claude et Mistral. Il est aussi **déployeur** (art. 3(4)) quand ses Administrators utilisent le Back Office Assistant. Anthropic et Mistral sont fournisseurs de modèles d'IA à usage général, avec leurs propres obligations.
- **Annexe III, point 4 (emploi).** Aucun usage actuel n'y tombe. Le point 4(a) vise les systèmes destinés au recrutement ou à la sélection *par l'employeur*. Le Service Desk de la Commission classe hors champ précisément les deux outils côté candidat que fait Jobbbox : adapter un CV à une offre, aider le candidat à trouver le bon poste. Le régime haut risque ne s'applique donc pas, et l'art. 6(4) non plus. La question se rouvrirait si Jobbbox classait ou orientait des Candidates **vers des employeurs** (B2B, outplacement, Organisation), ou vendait des offres sponsorisées ciblées.
- **Ce que l'AI Act exige d'afficher.** Peu de choses, et presque rien sur une page légale :
  - l'**AI disclosure** dans le Coach (art. 50(1)), déjà livrée (ADR-0036, #324) ;
  - le **marquage lisible par machine** des textes générés (art. 50(2)), voir #337.
  
  L'AI Act n'impose pas de publier les fournisseurs, les lieux d'exécution, la Redaction ni les Guardrails. Une page « IA dans Jobbbox » ne remplace jamais l'information au point d'usage (lignes directrices art. 50, points 38 et 142).
- **Ce que la documentation publique doit quand même dire, pour d'autres raisons.**
  - Le **RGPD** (art. 13 et 14) impose de dire qui reçoit les données et où elles partent. Il faut donc publier la voie Mistral sous EU AI Consent, Claude en direct hors UE après Redaction, la lecture des emails réservée à l'UE et les transferts.
  - Le **droit de la consommation** (L121-2) interdit de survendre la Redaction ou les Guardrails.
- **Art. 4 (maîtrise de l'IA).** Ce devoir vise le personnel et les personnes qui agissent pour le compte de Jobbbox, pas les Candidates. Il ne s'impose donc pas à la documentation publique. Il concerne en revanche la **documentation interne** des Administrators (point « Not yet specified » de #494), et peut-être les Human Coaches (**Juriste**). Depuis l'Omnibus numérique (règlement (UE) 2026/1744), l'article n'exige plus de niveau « suffisant ».
- **Calendrier.**
  - Art. 4 : applicable depuis le 2 février 2025, contrôlé depuis le 2 août 2026.
  - Art. 50(1) : dû depuis le 2 août 2026, c'est fait.
  - Art. 50(2) : dû au **2 décembre 2026**, mais seulement si les fonctions génératives étaient sur le marché avant le 2 août 2026. Sinon, il est dû dès la mise sur le marché (**à confirmer**).
  - Annexe III : 2 décembre 2027, sans objet aujourd'hui.

## Sources

Textes :
- AI Act, règlement (UE) 2024/1689 : https://eur-lex.europa.eu/eli/reg/2024/1689/oj/fra.
  - EUR-Lex renvoie une page vide à notre outil, et le téléchargement direct a été refusé.
  - Les articles ont été lus sur https://artificialintelligenceact.eu (source secondaire qui reprend le JO, version consolidée avec l'Omnibus). Pages consultées : `/article/3/`, `/article/4/`, `/article/6/`, `/article/50/` et `/annex/3/`.
  - Les citations sont à vérifier sur EUR-Lex avant toute publication.
- Omnibus numérique sur l'IA, règlement (UE) 2026/1744 : https://eur-lex.europa.eu/eli/reg/2026/1744/oj/fra.
  - Non lu dans le texte, pour la même raison.
  - Publié au JO le 24 juillet 2026, en vigueur le 27 juillet 2026. Ces dates viennent de sources secondaires concordantes, par exemple https://www.lewissilkin.com/insights/2026/07/27/the-digital-omnibus-on-ai-enters-into-force-today-102nedo.
- RGPD, règlement (UE) 2016/679 : https://eur-lex.europa.eu/eli/reg/2016/679/oj/fra

Documents de la Commission :
- Lignes directrices sur les obligations de transparence de l'art. 50, C(2026) 5054, 20 juillet 2026 : https://ec.europa.eu/newsroom/dae/redirection/document/131215. Page : https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems. Citées « LD50 (n) », n étant le paragraphe, comme dans `issue-318.md`.
- Lignes directrices sur les pratiques interdites, C(2025) 5052 final, 29 juillet 2025 : https://ai-act-service-desk.ec.europa.eu/sites/default/files/2025-08/guidelines_on_prohibited_artificial_intelligence_practices_established_by_regulation_eu_20241689_ai_act_english_ied3r5nwo50xggpcfmwckm3nuc_112367-1.PDF. Citées « LD5 (n) ». Texte lu en entier.
- Projet de lignes directrices sur la classification des systèmes à haut risque, 19 mai 2026 : https://digital-strategy.ec.europa.eu/en/library/draft-commission-guidelines-classification-high-risk-ai-systems. Version finale attendue fin 2026 ; la consultation s'est close le 23 juillet 2026.
- AI Act Service Desk, exemples pour l'emploi (Annexe III point 4) : https://ai-act-service-desk.ec.europa.eu/en/employment-0. Page sans date ni statut formel, à traiter comme explicative.
- FAQ « AI literacy – Questions & Answers », mise à jour le 20 octobre 2026 : https://digital-strategy.ec.europa.eu/en/faqs/ai-literacy-questions-answers
- Code de bonnes pratiques sur le marquage et l'étiquetage des contenus générés : https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content. Signataires : https://digital-strategy.ec.europa.eu/en/news/strong-backing-code-practice-transparency-ai-generated-content

Droit français :
- Code de la consommation, art. L121-2 : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563114

## 1. Fournisseur ou déployeur

**Définitions** (art. 3).
- Le *fournisseur* (3(3)) développe un système d'IA, ou le fait développer, et le met sur le marché ou en service sous son propre nom ou sa propre marque, à titre onéreux ou gratuit.
- Le *déployeur* (3(4)) utilise un système d'IA sous sa propre autorité, sauf pour une activité personnelle à caractère non professionnel.

| Système | Rôle de Jobbbox | Fondement |
|---|---|---|
| AI Coach, Playbook Agents, Guardrails du Coach | Fournisseur | Système interactif proposé sous le nom Jobbbox (LD50 11). Le modèle tiers ne change rien (LD50 26–27). |
| Textes générés : Tailored CV et Cover Letter, Company Dossier, Job Offer Summary, Action Cards, Outreach Message | Fournisseur d'un système génératif | LD50 11. Obligation de l'art. 50(2). |
| Lecture des emails d'offres (`offer_email_reading`, ADR-0052) | Fournisseur | Extraction de données, pas de contenu présenté comme généré. Probablement hors 50(2) (LD50 65, voir `issue-318.md` §1). |
| Back Office Assistant | Fournisseur **et** déployeur | Utilisé par les Administrators sous l'autorité de Jobbbox. Un même opérateur peut cumuler les rôles (LD50 15). |
| Match Score, ATS Score | Pas un système d'IA pour l'essentiel (règles) | Seule l'extraction de champs manquants passe par l'IA (`issue-318.md` §1). |

- **Anthropic** (Claude, désormais en API directe : ADR-0007, amendement du 2026-10-28) et **Mistral** sont fournisseurs de modèles d'IA à usage général.
- Leurs obligations (art. 53) incluent de fournir aux fournisseurs en aval les informations nécessaires pour se conformer. C'est le canal à utiliser pour #337 : demander si leurs sorties portent un marquage.
- Depuis l'abandon de Bedrock, **AWS ne fait plus partie de la chaîne**. La liste de fournisseurs à interroger dans #337 doit être mise à jour : Anthropic, Mistral, et Perplexity seulement pour la recherche web.
- Le Candidate qui envoie son Tailored CV n'est probablement pas déployeur : une recherche d'emploi relève a priori de l'activité personnelle non professionnelle (3(4)). **Juriste**, déjà listé dans `issue-318.md`.

## 2. Annexe III point 4 : un service pour le candidat

**Texte.**
- Le point 4(a) vise les systèmes d'IA « intended to be used for the recruitment or selection of natural persons », notamment pour « place targeted job advertisements », filtrer les candidatures et évaluer les candidats.
- Le point 4(b) vise les décisions sur les relations de travail en cours : promotion, licenciement, attribution de tâches, évaluation.

**Exemples de la Commission** (Service Desk, page Employment).
- *Hors champ* :
  - un outil d'adaptation de CV à une offre, lancé et contrôlé par le candidat, en dehors du processus de l'employeur (exemple 14) ;
  - un outil qui aide le candidat à trouver le meilleur poste, contrôlé par le candidat (exemple 15).
- *Dans le champ* :
  - une agence d'emploi qui classe des candidats pour des postes et leur suggère des offres, parce que ses sorties orientent des candidats vers des employeurs (exemple 8) ;
  - des annonces d'emploi ciblées sur les réseaux sociaux, parce qu'elles décident qui apprend l'existence d'un poste (exemple 7) ;
  - le sourcing et le classement de candidats pour des recruteurs (exemples 1 et 2).

**Application aux fonctions de Jobbbox.**

| Fonction | Analyse | Résultat |
|---|---|---|
| Tailored CV, Cover Letter, ATS Score | Exemple 14 | Hors champ |
| Job discovery, Target Companies, Match Score, Job Digest, Email intake | Exemple 15 : classement d'offres pour le seul Candidate | Hors champ |
| AI Coach, Coaching Playbooks, Company Dossier, Outreach Message | Conseil au candidat ; aucune sortie ne va à un employeur pour le sélectionner | Hors champ |
| Coach Access d'un Human Coach | Aucune IA ne classe le Candidate pour un tiers | Hors champ |

**Conséquences.**
- L'art. 6(3) (dérogation) et sa règle « toujours haut risque en cas de profilage » ne jouent qu'**à l'intérieur** de l'Annexe III. Jobbbox n'en a pas besoin.
- L'art. 6(4) (documenter l'évaluation, s'enregistrer) ne s'applique pas non plus. Il vise le fournisseur qui estime qu'un système *relevant* de l'Annexe III n'est pas à haut risque. L'Omnibus aurait par ailleurs allégé l'enregistrement prévu à l'art. 49(2) ; ce n'est pas vérifié dans le texte.
- Bonne pratique : garder une note interne d'une page, datée, qui explique pourquoi chaque fonction est hors Annexe III, en citant les exemples 14 et 15. Il n'est pas utile de la publier.

**Ce qui ferait basculer** (à surveiller dans les ADR et les issues) :
- Toute offre B2B où l'IA classe, présélectionne ou recommande des Candidates à un employeur (ADR-0004, rôle Organisation) : on retombe dans les exemples 1, 2 et 8.
- Des offres sponsorisées par des employeurs et ciblées sur des Candidates par l'IA : on retombe dans l'exemple 7, « targeted job advertisements ».
- Un suivi par un conseiller en outplacement qui noterait ou classerait les bénéficiaires.
- Les obligations de l'Annexe III s'appliquent le 2 décembre 2027 (Omnibus). Les lignes directrices finales sur la classification sont attendues fin 2026. **Juriste** : relire cette analyse quand elles paraissent.

## 3. Ce que l'AI Act impose de publier, et où

L'AI Act n'impose aux systèmes non haut risque **aucune** documentation publique générale. L'art. 13 (notice d'utilisation) et l'art. 49 (base de données de l'UE) ne visent que le haut risque. Restent :

| Obligation | Article | Où | État |
|---|---|---|---|
| Dire au Candidate qu'il parle à une IA, de façon claire et distincte, au plus tard à la première interaction, en respectant l'accessibilité | 50(1), 50(5) ; LD50 37–40, 142 | Dans le Coach Panel. Une page légale ne suffit pas (LD50 38, 142). | Fait : AI disclosure (ADR-0036), badge « Coach IA », réponse véridique quand on le demande (#324) |
| La même chose pour le Back Office Assistant | 50(1) | Dans le Back Office | À vérifier ; `issue-318.md` §3 le recommande |
| Marquer les textes générés de façon lisible par machine, avec un moyen de détection | 50(2) ; LD50 69–77, 92 | Dans les sorties (HTML, DOCX, PDF), pas dans la doc | #337 |

La documentation publique peut **compléter** ces obligations. Les lignes directrices admettent les étiquettes visibles « as a complementary measure » (LD50 71). Elle peut :
- expliquer que le Coach est une IA et comment joindre un Human Coach ;
- une fois #337 livré, dire que les textes générés portent une marque lisible par machine et comment la vérifier (LD50 77 : la personne doit pouvoir obtenir le résultat de la détection).

## 4. Ce que la documentation publique doit dire sur chaque voie (RGPD et droit de la consommation)

Ces obligations ne viennent **pas** de l'AI Act. Elles viennent :
- du RGPD : art. 5(1)(a) loyauté et transparence, art. 12, art. 13(1)(e) destinataires, art. 13(1)(f) transferts hors UE et garanties, art. 14 données collectées indirectement, art. 7(3) retrait du consentement ;
- du Code de la consommation : L121-2, pas d'allégation trompeuse sur les caractéristiques essentielles.

Elles remplissent la section « IA dans Jobbbox » (#503, #338) et la politique de confidentialité.

### 4.1 Claude en direct après Redaction (ADR-0007, amendements du 2026-10-20 et du 2026-10-28)

- **À dire.**
  - Sans EU AI Consent, les appels d'IA partent vers Claude (Anthropic) par son API directe, **hors de l'UE**.
  - Avant chaque appel, Jobbbox retire ce qu'il sait de l'identité du Candidate (nom, nom de famille, adresse, email, téléphone) et toute adresse email ou numéro de téléphone.
  - Le prénom reste.
  - Le reste du CV part : employeurs, postes, dates, formations.
  - Les données restent **stockées** dans l'UE.
- **Pourquoi.**
  - C'est un transfert hors UE (art. 13(1)(f)) : il faut nommer la garantie, décision d'adéquation (art. 45, par exemple le Data Privacy Framework si Anthropic y est certifiée) ou clauses types (art. 46). Non vérifié pour Anthropic. **Juriste**.
  - Des données pseudonymisées restent des données personnelles (RGPD, considérant 26), et ADR-0007 le reconnaît.
- **À ne pas dire.**
  - « anonymisé », « aucune donnée personnelle ne quitte l'UE », « toutes vos données restent en Europe ». Ce serait trompeur (L121-2 ; RGPD 5(1)(a)). `CONTEXT.md` écarte déjà « anonymisation » et « masking ».
  - Les limites écrites dans ADR-0007 doivent apparaître en clair : un nom que Jobbbox ne connaît pas passe, par exemple celui d'un référent, ou celui d'un premier CV avant tout Master CV.
- **À corriger.** L'en-tête de `docs/privacy/register.md` affirme « no transfer outside the EU ». C'est faux depuis le 2026-10-20, et la carte #494 le signale déjà.

### 4.2 La voie Mistral sous EU AI Consent (ADR-0007, amendement #121)

- **À dire.**
  - L'EU AI Consent est un choix du Candidate, daté, retirable à tout moment depuis son compte (art. 7(3)).
  - Avec ce consentement, les appels qui portent son identité vont **non expurgés** à Mistral, dans l'UE.
  - Sans ce consentement, ces appels partent **expurgés** au fournisseur de la tâche, hors UE (4.1).
- **Le compromis à rendre lisible.** Le consentement envoie *plus* de données (l'identité), mais *dans l'UE*. Le refus en envoie *moins*, mais *hors de l'UE*. Le texte doit le dire tel quel, sans orienter le choix ; sinon le consentement n'est pas éclairé (art. 4(11), art. 7). **Juriste** sur la base légale : consentement, ou exécution du contrat avec une option.

### 4.3 La lecture des emails réservée à l'UE (ADR-0052, ADR-0055)

- **À dire.**
  - Les emails transférés à l'adresse de Forwarding sont lus par une IA hébergée dans l'UE (Mistral), quel que soit l'EU AI Consent.
  - Le contrôle du Guardrail « Contenu piégé dans un email » tourne aussi dans l'UE.
  - Rien de ce que l'email dit d'un recruteur ou d'un contact n'est gardé : la sortie est filtrée.
  - Un email écarté par un Guardrail apparaît comme tel au Candidate.
- **Point ouvert.** Ces emails contiennent des données de **tiers** : recruteurs, contacts. L'art. 14 (données non collectées auprès de la personne) s'applique peut-être, avec l'exception de l'effort disproportionné (art. 14(5)(b)), qui suppose de rendre l'information publique. La politique de confidentialité peut avoir besoin d'un paragraphe pour ces tiers. **Juriste**.

### 4.4 Les Guardrails (ADR-0022, ADR-0023)

- **L'AI Act n'impose pas de les décrire.**
- **Ils ne relèvent pas de la reconnaissance des émotions.**
  - Le Guardrail de détresse lit le **texte**.
  - L'interdiction de l'art. 5(1)(f) (reconnaissance des émotions au travail ou à l'école) et l'obligation de l'art. 50(3) visent seulement les systèmes fondés sur des données biométriques (art. 3(39)).
  - Les lignes directrices sur les pratiques interdites citent l'exemple : un système qui infère des émotions à partir d'un texte écrit « is not based on biometric data » et sort du champ de l'interdiction (LD5 250–251).
- **À dire, par loyauté (RGPD 5(1)(a)) et pour éviter une allégation trompeuse.**
  - Les messages au Coach et ses réponses passent par des contrôles automatiques : injection, fuite de données, conseils hors sujet, détresse.
  - Un message peut être bloqué et remplacé par un message fixe.
  - En cas de détresse, le Candidate reçoit le numéro 3114, et **personne n'est alerté** (ADR-0022).
  - Les déclenchements sont gardés 24 mois sans nommer personne.
  - Si le contrôle par IA est indisponible, seules les règles fixes s'appliquent (fail open).
  - Le contrôle par IA peut tourner hors UE, appel expurgé (CONTEXT **Guardrail**), sauf pour les emails (4.3).
- **À ne pas dire.** « sécurité garantie », « aucun contenu dangereux ». Les Guardrails échouent ouverts et ne bloquent que ce qu'ils détectent.
- **Les evals (ADR-0023)** ne demandent rien de public. On peut dire que les messages de Guardrail et les Playbooks sont validés par une personne avant d'être servis.

### 4.5 Un seul catalogue

La recommandation de `issue-318.md` §4 tient toujours : la page « IA dans Jobbbox », la politique de confidentialité et le registre lisent **un seul catalogue** de fournisseurs, avec pour chacun la tâche et le lieu (UE / hors UE). Il faut le mettre à jour pour ADR-0007 du 2026-10-28 : plus de Bedrock, Claude en direct, Mistral pour l'identité et pour les tâches `euOnly`.

## 5. Art. 4 : la maîtrise de l'IA concerne-t-elle la documentation ?

- **Texte modifié par l'Omnibus.**
  - Les fournisseurs et déployeurs « shall take measures to support the development of AI literacy » de leur personnel et des autres personnes qui utilisent les systèmes pour leur compte.
  - L'article ne les oblige plus à garantir un niveau donné pour chaque personne (art. 4(1) modifié).
  - La Commission et les États membres les soutiennent (4(2)), et le Comité de l'IA adopte des recommandations (4(3)).
  - Source : FAQ AI literacy, qui dit « no specific – or 'sufficient' - level is mandated ». Texte de l'art. 4 lu sur le miroir, non lu sur EUR-Lex.
- **Qui est concerné.**
  - Le personnel, et les prestataires ou clients qui agissent *pour le compte* de l'organisation.
  - Les clients en tant que tels ne sont pas visés, même si la FAQ juge une sensibilisation « useful », en renvoyant au considérant 20.
  - Les Candidates ne sont donc pas visés.
- **Preuve.**
  - Aucun certificat n'est exigé.
  - Un registre interne des formations est conseillé (FAQ).
  - Le contrôle revient aux autorités nationales de surveillance du marché depuis le 2 août 2026.
  - L'art. 4 n'a pas de palier d'amende propre à l'art. 99 : les sanctions relèvent du droit national. Plusieurs sources secondaires le disent, la FAQ ne donne pas de montant.
- **Pour Jobbbox.**
  - Pas d'obligation sur la **doc publique**. Une page qui explique honnêtement les limites de l'IA (le Coach peut se tromper, relire ses documents) relève plutôt de la loyauté et de la qualité.
  - Une obligation **réelle mais légère** sur la **doc interne** : les Administrators (Playbook editors, Help editors, super-admins qui règlent les Guardrails) utilisent et paramètrent l'IA. Un Help Article interne sur l'IA dans le Back Office (choix de modèle, « hors UE », Redaction, Guardrails, evals, limites), plus un registre daté de qui l'a lu ou suivi, suffit. Cela répond au point « Profondeur de la documentation interne » de #494.
  - Les **Human Coaches** sont des professionnels sélectionnés par Jobbbox qui voient les sorties de l'IA (Coach Access). Agissent-ils « pour le compte » de Jobbbox au sens de l'art. 4 ? **Juriste**. Si oui, une courte page d'aide « ce que fait l'IA, ce qu'elle ne fait pas » suffit.

## 6. Calendrier

| Date | Ce qui s'applique | Jobbbox |
|---|---|---|
| 2 févr. 2025 | Art. 4 (maîtrise de l'IA) et art. 5 (interdictions) | Art. 4 : doc interne à faire. Art. 5 : rien n'est concerné (4.4). |
| 2 août 2025 | Obligations des fournisseurs de modèles à usage général (art. 53) | Concerne Anthropic et Mistral, pas Jobbbox |
| 27 juil. 2026 | Omnibus (2026/1744) en vigueur : art. 4 recalibré, haut risque reporté | — |
| 2 août 2026 | Art. 50 applicable ; contrôle de l'art. 4 par les autorités nationales ; sanctions (art. 99) | 50(1) fait (ADR-0036) |
| **2 déc. 2026** | Art. 50(2), délai pour les systèmes génératifs **déjà sur le marché avant le 2 août 2026** (LD50 153) | #337. Si les fonctions génératives ont été mises sur le marché (production ouverte au public) après le 2 août 2026, le délai ne joue pas et le marquage est dû dès maintenant. **À confirmer** avec la date de mise en production publique. |
| fin 2026 | Lignes directrices finales sur la classification haut risque | Relire le §2 |
| 2 déc. 2027 | Obligations haut risque de l'Annexe III | Sans objet tant que le §2 tient |

Sanctions : un manquement à l'art. 50 est passible d'une amende pouvant atteindre 15 M€ ou 3 % du chiffre d'affaires mondial (art. 99(4)). Pour une PME, c'est le plus bas des deux montants (art. 99(6)).

## 7. Lien avec #337

- #337 attendait de savoir qui doit marquer et pour quoi. Réponse : **Jobbbox, en tant que fournisseur**, pour chaque sortie générative de fond (LD50 92, 143). Cela couvre les Tailored Documents, le Company Dossier, les Job Offer Summaries et le corps des Action Cards. Les libellés courts sont exemptés (LD50 68).
- Ce qui change dans #337 :
  - la liste des fournisseurs à interroger devient Anthropic (API directe), Mistral et Perplexity ; AWS sort de la liste ;
  - la date butoir dépend de la date de mise sur le marché (§6) ;
  - la doc publique pourra, une fois le marquage livré, dire comment le vérifier (LD50 71, 77).
- Rien dans l'AI Act n'impose une mention **visible** « rédigé par IA » sur un CV téléchargé (`issue-318.md` §5).

## Recommandation pour #503 (contenu « IA dans Jobbbox »)

**Doit dire** (RGPD et loyauté) :
1. Quelles fonctions utilisent l'IA, et que le Match Score et l'ATS Score reposent sur des règles.
2. Les fournisseurs nommés en texte et le lieu de chaque voie :
   - Claude (Anthropic), API directe, hors UE, après Redaction, avec la garantie de transfert ;
   - Mistral, UE, pour l'identité sous EU AI Consent et pour la lecture des emails ;
   - le fournisseur de recherche web, hors UE, qui ne reçoit que des requêtes construites à partir des critères ou d'un nom d'entreprise.
3. Ce que fait la Redaction **et ses limites**, sans le mot « anonymisé ».
4. Le choix EU AI Consent, son compromis, et comment le retirer.
5. Les Guardrails en termes simples, la conduite en cas de détresse (3114, personne n'est alerté) et le fait qu'ils échouent ouverts.
6. Le Coach est une IA (renvoi à l'AI disclosure) et un Human Coach peut être réservé.

**Peut dire** :
- le marquage des textes générés et comment le vérifier, une fois #337 livré ;
- pourquoi Jobbbox est hors Annexe III (un service pour le candidat), en une phrase.

**Ne doit pas** :
- remplacer l'information dans le produit ;
- afficher des logos de fournisseurs (`issue-318.md` §7) ;
- promettre « UE uniquement » ou « sécurité garantie ».

**Interne** (art. 4) : un Help Article Back Office sur l'IA et un registre des formations ; à voir pour les Human Coaches.

## À faire trancher par un juriste

1. Rôle de fournisseur de Jobbbox pour des systèmes bâtis sur des modèles tiers accessibles par API, et rôle de déployeur pour le Back Office Assistant.
2. Annexe III point 4 : confirmer le « hors champ » une fois les lignes directrices finales publiées, et avant toute fonction B2B, Organisation ou offre sponsorisée.
3. Date de mise sur le marché des fonctions génératives, pour savoir si le délai du 2 décembre 2026 s'applique à l'art. 50(2).
4. Garantie du transfert vers Anthropic (API directe, États-Unis) : adéquation (DPF) ou clauses types ; mention dans la politique et dans le registre.
5. Base légale de la voie Mistral (consentement ou contrat), et rédaction du compromis pour que le consentement soit éclairé.
6. Art. 14 pour les tiers nommés dans les emails d'offres lus par l'IA.
7. Art. 4 : les Human Coaches agissent-ils « pour le compte » de Jobbbox ? Contenu minimal de la formation interne.
8. Texte final de l'art. 4 et de l'art. 6(4) / 49(2) après l'Omnibus, à lire sur EUR-Lex : notre outil n'a pas pu y accéder.

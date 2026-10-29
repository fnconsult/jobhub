# Issue #500 : couverture de la doc pour l'existant et les issues ouvertes

Part of #494. Recherche sur sources locales, faite le 2026-10-29 sur `origin/main` (4bb35f1f).

## Sources croisées

- `CONTEXT.md` (glossaire du domaine, 910 lignes).
- Routes `apps/web/src/app/**/page.tsx` : pages Candidat, `espace-coach`, `admin`, pages publiques (`/`, `/connexion`, `/desabonnement`, `/compte/supprime`).
- `apps/extension` (`entrypoints/sidepanel`, `src/guest-session.ts`, `src/all-sites-detection.ts`, `src/side-panel.ts`).
- Issues GitHub, fermées et ouvertes (`gh issue list --state all --limit 500` : 289 issues).
- Help Articles `packages/help/articles/{fr,en}` : 29 articles par langue (14 `page`, 9 `glossary`, 6 `faq`), FR et EN alignés un pour un.
- `packages/help/src/index.ts` (`articleFor`) et `packages/help/src/types.ts`.

## Constats transverses

1. **Les Help Articles ne servent que le Candidate.** Ils s'affichent dans le Coach Panel (`apps/web/src/components/CoachPanel.tsx`, `CoachHelp.tsx`), monté pour le Candidate connecté (`apps/web/src/app/layout.tsx`, `CandidateCoachPanel`) ; le Back Office Assistant réutilise le panneau avec `help: false`. Ni l'`espace-coach`, ni le Back Office, ni l'extension n'importent `@jobhub/help` (grep sur `apps/web/src` et `apps/extension`). Visitor, Guest, Human Coach et Administrator n'ont aucune doc produit.
2. **Seuls trois `kind` existent** : `page`, `glossary`, `faq` (`packages/help/src/types.ts`, `HELP_ARTICLE_KINDS`). Il n'y a ni tutoriel, ni motion. Ce sont des textes courts, en Markdown, **sans image** (commentaire de `body`). Un tutoriel ou une motion demande un nouveau type ou un autre support (#504, #506).
3. **Un article `page` couvre ses Sections par préfixe** (`articleFor` : `/compte/reception-email` reçoit l'article de `/compte`). Toutes les routes Candidat ont donc un article, mais plusieurs articles parents ne citent pas les Sections livrées après eux (Réception email, Mes signalements, Entreprises cibles, Reçues par email).
4. **Aucune page publique** : pas de page légale, pas d'aide publique, pas de Nouveautés, pas de pied de page. La page `/` hors connexion n'affiche qu'un slogan, un texte d'intro et « Se connecter » (`apps/web/src/app/page.tsx`). Aucun fichier sous `apps/web/src/app` ni `apps/extension` ne parle de mentions légales, CGU, CGV ou confidentialité.
5. **Le glossaire couvre 9 termes sur plus de 150** dans `CONTEXT.md`. La liste fermée des HelpTerm (`CONTEXT.md`, « HelpTerm ») est couverte en entier. En revanche, les termes visibles du Candidate qui touchent à l'IA et au RGPD n'ont pas d'entrée : AI Coach, EU AI Consent, Redaction, AI Activity, Coach Access, Coach Memory, Action Card, Guardrail message.
6. **Nouveautés** : aucun `CHANGELOG`, aucun tag, aucune GitHub Release (constaté par #494). Les fonctionnalités livrées n'ont donc aucune trace publique.

Légende des types de doc : **page** = Help Article « Sur cette page » (how-to d'une page) ; **FAQ** ; **glossaire** ; **tutoriel** = parcours pas à pas sur plusieurs pages ; **motion** = vidéo explicative courte ou micro-animation dans l'interface (décision #494 : pas de GIF) ; **légal** = page légale publique (hors Help Articles, voir #496, #497, #502).

## Visitor (site public, sans compte)

Terme pas encore dans `CONTEXT.md` (à ajouter, #494).

| Fonctionnalité ou issue | Doc existante | Manque | Type de doc attendu |
|---|---|---|---|
| Accueil public `/` (slogan, intro, « bientôt ») | Aucune (l'article `page-home` vise le Candidate connecté) | Ce qu'est Jobbbox, à qui il s'adresse, comment commencer | page publique (#501, #470) |
| Connexion sans mot de passe `/connexion` (#2, #170, #209) | Aucune | Lien magique, fournisseurs de connexion, « je ne reçois pas l'email » | FAQ publique |
| Mentions légales, CGU/CGV, politique de confidentialité, cookies | Aucune page (constat 4) ; `docs/privacy/register.md` interne seulement | Toutes les pages légales, versionnées avec date d'effet | légal (#496, #502, #470) |
| « IA dans Jobbbox », divulgation AI Act, catalogue des fournisseurs (#338, #337, #318) | `docs/research/issue-318.md` (interne) | Page publique sur l'usage de l'IA, Mistral sous EU AI Consent, Redaction, marquage art. 50(2) | légal + page publique (#497, #503) |
| Plans et prix (#22, #103, #206) | `page-subscription`, `glossary-plan-quota` (Candidate connecté) | Plans et quotas lisibles avant inscription | FAQ publique |
| Désabonnement d'un Job Digest `/desabonnement` (#15, #472) | `glossary-job-digest` mentionne le désabonnement | Rien de bloquant ; ce que l'on garde après désabonnement | FAQ |
| Nouveautés (changelog) | Aucune (constat 6) | Un fichier par version, FR et EN, repris en GitHub Release | page Nouveautés (#505, #470) |
| Extension : quoi, où l'installer (#471, #303) | Section Outils de Mon compte (Candidate seulement) | Présentation et installation visibles sans compte | page publique + motion |
| Accessibilité, taille du texte (ADR-0009, `TextSizeControl` présent sur `/`) | `faq-text-size` (Candidate) | Version publique | FAQ publique |
| Joindre l'équipe sans compte | `faq-signalement` (exige un compte connecté) | Contact pour un Visitor | FAQ publique / légal (mentions) |
| Aide publique indexable (#494 : « indexation des Help Articles publics ») | Articles uniquement dans le Coach Panel | Choisir les articles publics et leur route | décision #501/#504 |

## Guest (extension, sans compte)

| Fonctionnalité ou issue | Doc existante | Manque | Type de doc attendu |
|---|---|---|---|
| Side Panel de l'extension (#471, ADR-0054) | Aucune | Ouvrir le panneau (icône, badge du Job Site), ce qu'il contient | tutoriel + motion |
| Capture d'une offre et Match Score en Guest (#10, #187, #76, #51) | `glossary-match-score` (web, Candidate) | Capturer une page, page non détectée, « Recalculer », « Pourquoi N ? » | page (extension) + FAQ |
| Badge « Analyser cette offre », détection sur tous les sites (`all-sites-detection.ts`, #188) | Aucune | Sur quels sites le badge apparaît, que faire sans badge | FAQ |
| Guest session : CV et offre gardés 23 h au plus, effacés sur demande (ADR-0003, `guest-session.ts`) | Aucune | Ce qui est gardé, combien de temps, comment l'effacer | FAQ + légal (confidentialité) |
| Créer un compte ou se connecter et garder son travail (#11, #66) | Aucune | Ce que devient le CV (Profile) et l'offre (Application) | tutoriel + motion |
| Extension pour un Candidate connecté : score contre un Profile (#75) | Aucune | Choisir le Chosen Profile, sauver en Application | page (extension) |
| Aide dans l'extension | Aucune intégration de `@jobhub/help` | Un point d'entrée vers l'aide (lien ou article) | décision #504 |

## Candidate

### Pages et Sections

| Fonctionnalité ou issue | Doc existante | Manque | Type de doc attendu |
|---|---|---|---|
| Accueil `/` | `page-home` | Rien | — |
| Créer un profil, téléversement du CV (#4, #166) | `page-new-profile` | Formats acceptés, CV vide, temps de lecture | FAQ |
| Page d'un profil (#6, #7, #8, #137, #238) | `page-profile` | Ne cite pas « Entreprises cibles » | page (mise à jour) |
| Entreprises cibles (#409, #406, #307, #424) | Aucune | Ce que c'est, d'où elles viennent (La Bonne Boite), logo France Travail | page (mise à jour) + glossaire « Entreprise cible » |
| Éditeur du CV de référence `/profils/[id]/cv`, versions, Restore (#6, ADR-0012) | `glossary-master-cv`, `page-profile` | Barre d'enregistrement (Save bar), restaurer une version | tutoriel |
| Télécharger le CV, modèles (#20, #67) | `page-profile` (une ligne) | Modèles de CV, PDF ou DOCX | FAQ |
| ATS Score et ATS Fixes, Senior Advice (#8, #165) | `glossary-ats-score` | Rien d'essentiel ; Senior Advice non nommé | glossaire (complément) |
| Propositions, Action Cards (#336) | `glossary-proposals` | Le terme « Action Card » reste interne : rien à ajouter côté Candidate | — |
| Critères de recherche : secteurs, lieux, plusieurs valeurs (#70, #235, #236, #237, ADR-0025) | `glossary-job-search` (partiel) | Modifier les critères, lieux suggérés, secteurs et domaines | FAQ |
| Recherches d'offres, Stop, quota rendu (#14, #330, #331, ADR-0037) | `page-job-searches`, `page-job-search` | Rien | — |
| « Reçues par email » et Email intake (#447, #441, #451, #450, #458) | Aucune (aucun article ne cite le transfert) | Adresse de transfert, assistant de transfert, expéditeurs reconnus, ce qui est lu et gardé | page (mise à jour de `page-job-searches`) + tutoriel + motion + FAQ « quels emails Jobbbox lit-il ? » |
| Réception email dans Mon compte, assistant (`/compte/reception-email/assistant`, #451) | Aucune ; `page-account` ne la cite pas | Section non décrite | page (mise à jour de `page-account`) + tutoriel |
| Job Digests (#15) | `page-job-digests`, `page-job-digest`, `glossary-job-digest` | Rien | — |
| Page d'une offre `/offres/[id]`, offre expirée, Reported Unavailable (#16, #163) | `page-job-offer` | Offre expirée ou signalée indisponible | FAQ |
| Offre privée issue d'un email (#443, ADR-0049) | Aucune | Pourquoi une offre est privée | glossaire ou FAQ |
| Candidatures, statuts, archivage (#12, #69) | `page-applications`, `page-application` | Rien | — |
| CV adapté, revue des changements, Flagged Change (#18, #161, #68, ADR-0006) | `glossary-tailored-cv`, `page-application` | Accepter ou refuser chaque changement, pourquoi Jobbbox n'invente rien | tutoriel + motion |
| Lettre de motivation, message d'approche (#19, #162) | `page-application` (une ligne) | Rien de dédié | FAQ |
| Dossier entreprise (#17, #168, #335) | `page-application` (cite la rubrique) | Sources publiques, arrêter la préparation | FAQ |
| Contacts enrichis, Reveal (#23, #77, #95, ADR-0015) | `page-application`, `glossary-plan-quota` | Ce qu'est un contact enrichi, d'où viennent les données | glossaire + FAQ + légal (sous-traitant) |
| Relances (#21) | `glossary-follow-up`, `faq-follow-up-recruiter` | Rien | — |
| Agenda : vues, entretiens, report, annulation, .ics, rappels (#246 à #254) | `page-agenda`, `page-account` (Rappels) | Ajouter à son calendrier pas à pas | tutoriel court |
| Coachs humains, Coach Access, séances, « À planifier » (#24, #248) | `page-human-coaches` | Réserver et payer une séance, retirer l'accès, avis des coachs | tutoriel + glossaire « Accès coach » |
| Abonnement, quotas hebdomadaires, coupons, paiement échoué (#22, #102 à #104, #169, #201, #207, #321, ADR-0032) | `page-subscription`, `glossary-plan-quota`, `faq-quota-renewal` | Code promo, paiement échoué, résiliation programmée | FAQ |
| Mon compte : sections (#25) | `page-account` | Manquent Réception email et Mes signalements | page (mise à jour) |
| Export et suppression du compte (#25, #171, ADR-0010) | `faq-data-export-deletion` | Rien côté aide ; à relier à la politique de confidentialité | légal (lien) |
| IA européenne, EU AI Consent (#121, ADR-0007) | `page-account` (une mention) | Ce que change le consentement, comment le retirer | glossaire + FAQ + légal (#503) |
| Préférences : langue, taille du texte, mode sombre (#473 ouvert) | `faq-text-size`, `page-account` | Mode sombre à documenter à sa livraison | FAQ (mise à jour) |
| Section Outils : l'extension (#303, #471) | `page-account` (une mention) | Installer et utiliser l'extension | tutoriel + motion (partagé avec Guest) |

### Coach Panel, IA et aide

| Fonctionnalité ou issue | Doc existante | Manque | Type de doc attendu |
|---|---|---|---|
| Coach Panel « Aide et coach », Article cards, Souvent demandé (#5, #342, #343) | `faq-help-and-ai`, `page-home` | Prise en main du panneau | motion (micro-animation) |
| AI Coach dit être une IA, badge « Coach IA » (#324, ADR-0036) | `faq-help-and-ai` (partiel) | Entrée « Coach IA » | glossaire + légal (#503) |
| Coach Conversations : nommer, rouvrir, supprimer, purge à 12 mois (#124) | Aucune | Durée de conservation, suppression | FAQ + légal |
| Coach Memory, vue et modifiable (#125) | Aucune | Ce que le coach retient, le confirmer, le corriger | glossaire + FAQ |
| AI Activity : sources, modèles, outils, Stop, raisons d'échec (#314, #326 à #336, #367 à #369, ADR-0034) | Aucune (aucun article ne cite « Activité IA ») | Lire le volet, arrêter une tâche, comprendre un échec | page de fonction + glossaire + motion |
| Guardrail message (dont 3114) (#228, ADR-0022) | Aucune | Pourquoi le coach répond par un message fixe | FAQ |
| Signalements : Bug, Idée, Question, Mes signalements, notification (#278, #345, #374 à #377) | `faq-signalement` | Suivre ses signalements dans Mon compte | FAQ (mise à jour) |
| Unanswered Questions (#344, ADR-0041) | `faq-help-and-ai` | Rien | — |
| Help Articles relus par une personne dans le Back Office (#346 ouvert) | — | Effet nul côté Candidate | — |

### Issues ouvertes qui toucheront le Candidate

| Issue | Doc existante | Manque | Type de doc attendu |
|---|---|---|---|
| #457, #458 lancement Email intake ; #455 guides Free et SFR ; #453 DPIA et politique de confidentialité | Aucune | Assistant par fournisseur de messagerie, mention dans la politique | tutoriel + motion + légal |
| #337 marquage art. 50(2) des textes générés | Aucune | Expliquer le marquage | FAQ + légal (#503) |
| #338 page « IA dans Jobbbox » | Aucune | Page entière | légal (#503) |
| #339 logos des fournisseurs dans AI Activity | Aucune | Rien (affichage seulement) | — |
| #424 logo France Travail à côté des Entreprises cibles | Aucune | Mention de la source | glossaire « Entreprise cible » |
| #467, #468, #469 pages Candidat dans le Design System | Articles existants | Revoir les libellés cités dans les articles après migration | page (relecture) |
| #470 pages publiques Légal et Nouveautés | — | Contenu fourni par la carte #494 | légal + Nouveautés |
| #473 mode sombre | `faq-text-size` | Choix dans Préférences | FAQ |
| #101 pertinence du Match Score ; #96 efficacité de la Job Search | `glossary-match-score` | À relire si le calcul change | glossaire (relecture) |

## Human Coach

Aucune doc : l'`espace-coach` n'a ni Coach Panel ni Help Articles (`apps/web/src/app/espace-coach/page.tsx`, constat 1).

| Fonctionnalité ou issue | Doc existante | Manque | Type de doc attendu |
|---|---|---|---|
| Coach space `/espace-coach` : ses séances, ses Candidates (#24, ADR-0016) | Aucune | Rôle, ce que l'on voit, connexion par email | page + tutoriel d'arrivée |
| Saisir ou corriger la date et le lien d'une Coaching Session (#249, ADR-0027) | Aucune | Pas à pas, lien avec Cal.com | tutoriel + FAQ |
| Lecture seule des Profiles et Applications sous Coach Access `/espace-coach/[candidateId]` | Aucune | Ce que permet l'accès, ce qui se passe quand il est retiré | page + FAQ |
| Coach Review sur un Tailored Document `/espace-coach/[candidateId]/candidatures/[applicationId]` | Aucune | Rédiger un avis, ce que le Candidate en garde | tutoriel |
| Retired Human Coach | Aucune | Ce qui reste après retrait | FAQ |
| Remboursement d'une séance (#255 ouvert) | Aucune | Côté coach : effet sur l'agenda | FAQ (à la livraison) |
| Cadre légal du coach (traitement des données des Candidates) | Aucune | Engagements, confidentialité | légal (#496, #498) |

## Administrator

Aide existante : le Back Office Assistant (#205) et les Explainable labels (#407), tous deux par IA ; aucun Help Article ne vise le Back Office. La profondeur de cette doc reste « Not yet specified » dans #494.

| Fonctionnalité ou issue | Doc existante | Manque | Type de doc attendu |
|---|---|---|---|
| Connexion Back Office, Require SSO (#209, `/connexion/back-office`) | Aucune | Procédure de connexion et de secours | page (interne) |
| Back Office Roles, Administrateurs, super-admins `ADMIN_EMAILS` (#204, #193, #397) | Termes dans `CONTEXT.md` | Quel rôle voit quelle section | page + glossaire (interne) |
| Dashboard, Consommation IA, Coût coach (#218, #408, #127) | Back Office Assistant, Explainable labels | Lecture des indicateurs | page (interne) |
| Activité : Recherches, Appels IA, Emails reçus, Actions (#404, #449) | Idem | Rien de rédigé | page (interne) |
| Journal, Journaux IA, Failure Reasons (#203, #259 à #264, #234 ; #265 ouvert) | Idem | Lire une raison d'échec | glossaire (interne) |
| Paramètres par type d'outil, Clés, Outils, Sites, Recherche web (#298 à #304, #396, #398 à #402, #233, #188, ADR-0033, ADR-0042) | Idem | Ordre Back Office > env > défaut, effet d'un changement | page + tutoriel (interne) |
| Plans, Codes promo, Quotas (#206, #207) | Idem | Créer un Plan, lier un prix Stripe | tutoriel (interne) |
| Coaching Playbooks, Human-validated, Eval Cases (#225, #231 ; #130, #131 ouverts ; ADR-0019, 0021, 0023) | Idem | Circuit de validation par une personne | tutoriel (interne) |
| Garde-fous et Guardrail messages (#228, #446, ADR-0022) | Idem | Modifier et valider un message, FR et EN | page (interne) |
| Signalements, statuts, réponse (#376) | Idem | Trier et répondre | page (interne) |
| Questions sans réponse, rôle Help editor (#344) | Idem | Transformer une question en Help Article | tutoriel (interne) |
| Help Articles éditables et validés dans le Back Office (#346 ouvert) | Aucune | Le circuit lui-même, à sa livraison | tutoriel (interne) |
| Email intake : Sources, expéditeurs reconnus, Held back (#448, #450 ; #457 ouvert) | Idem | Accepter un expéditeur, valider le Task Playbook | page (interne) |
| Coachs humains, Retired Human Coach (`/admin/coachs`) ; remboursement (#255 ouvert) | Idem | Ajouter, retirer, rembourser | page (interne) |
| Design System `/admin/design-system` (#463) | Interne aux développeurs | Hors doc publique | — |

## Synthèse

- Couvert : le parcours web du Candidate, page par page, avec 29 Help Articles FR/EN ; la liste des HelpTerm est complète.
- Manque côté Candidate : 4 articles `page` à mettre à jour (Mon compte, Profil, Recherches d'offres, Abonnement pour les coupons) ; Email intake, AI Activity, Coach Memory et EU AI Consent sans doc ; aucun tutoriel ni motion (aucun type prévu dans `packages/help`).
- Rien pour Visitor, Guest et Human Coach. Rien de rédigé pour l'Administrator, hormis l'aide par IA.
- Rien de légal ni de Nouveautés publics.
- Le support manque autant que le contenu : un article `page` ne sait viser que le web connecté, et l'extension, l'`espace-coach` et le site public ne montrent pas d'aide. Ces points relèvent de #501 (architecture de l'information) et #504 (aide publique, FAQ et tutoriels par rôle).
- Pour les issues à venir, la règle de doc de #508 pourrait exiger, dans toute issue `ready-for-agent` qui ajoute une page ou une Section, la mise à jour de l'article `page` parent : c'est la cause des quatre écarts relevés.

# Issue #427 : accès à Gmail (API Gmail, OAuth Google, évaluation CASA)

Question : Jobbbox peut-il lire les emails d'offres d'un Candidat sur Gmail (et Google Workspace) ? Faisable pour le MVP, à quel coût et en combien de temps ?

Vérifié le 2026-10-27 sur les documentations Google. « Non documenté » signifie que la source primaire est muette ; les chiffres de laboratoires tiers sont signalés comme tels.

## Réponse courte

- **Toute lecture du contenu des emails passe par un scope restreint.** `gmail.readonly`, `gmail.metadata`, `gmail.modify` et le scope IMAP `https://mail.google.com/` sont tous restreints. Aucun scope non restreint ne permet de lire seulement les messages d'un expéditeur donné ou d'un libellé.
- Pour une application publique, un scope restreint impose : vérification de la marque et de l'app OAuth, cas d'usage admis, justification du scope minimal, vidéo de démonstration, puis **évaluation de sécurité CASA annuelle** par un laboratoire agréé (500 à 4 500 USD selon Google, 2 à 3 semaines pour le tier 2), plus le respect des exigences « Limited Use ».
- **Recommandation : pas de connexion Gmail au MVP.** Utiliser le filtre Gmail + transfert vers une adresse Jobbbox (aucun scope Google, aucune vérification). Réévaluer l'intégration OAuth après le MVP, quand le volume d'utilisateurs justifie un budget récurrent d'environ 1 000 à 5 000 € par an et 1 à 3 mois de procédure la première fois.

## 1. Scopes de l'API Gmail et leur classement

Source : https://developers.google.com/workspace/gmail/api/auth/scopes

| Scope | Classement | Ce qu'il permet |
|---|---|---|
| `gmail.labels` | Non sensible | Voir et modifier les libellés (pas les messages) |
| `gmail.send` | Sensible | Envoyer des emails |
| `gmail.addons.current.message.readonly` / `.metadata` | Sensible | Lire le message ouvert, seulement quand un module complémentaire Workspace est actif |
| `gmail.readonly` | **Restreint** | Lire messages et paramètres |
| `gmail.metadata` | **Restreint** | En-têtes et libellés, sans le corps |
| `gmail.modify`, `gmail.compose`, `gmail.insert`, `gmail.settings.basic` | **Restreint** | — |
| `https://mail.google.com/` | **Restreint** | Accès complet, et seul scope valable pour IMAP/POP/SMTP |

Lire seulement un expéditeur ou un libellé :
- `users.messages.list` accepte `q` (syntaxe de recherche Gmail, par ex. `from:`) et `labelIds`, mais exige l'un des scopes `mail.google.com`, `gmail.modify`, `gmail.readonly` ou `gmail.metadata`, tous restreints. `q` est même interdit avec `gmail.metadata`. Source : https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- Le filtrage se fait donc après l'accord du scope. Google ne propose pas de scope « un libellé seulement » ou « un expéditeur seulement ».
- Les scopes `gmail.addons.*` (sensibles) ne servent qu'à un module complémentaire Gmail exécuté dans l'interface Gmail, sur le message ouvert par l'utilisateur. Ce n'est pas une lecture en arrière-plan de la boîte.

## 2. Vérification de l'application OAuth

Sources : https://support.google.com/cloud/answer/13464323 , https://support.google.com/cloud/answer/13464321 , https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification , https://support.google.com/cloud/answer/7454865

- **Sans vérification** : une app qui demande un scope sensible ou restreint affiche l'écran « application non validée » et est plafonnée à **100 nouveaux utilisateurs au total** (sur toute la vie du projet). Le plafond s'applique aussi en mode développement / test / staging. Une app « interne » à une organisation Workspace n'a ni écran d'avertissement ni plafond, mais Jobbbox s'adresse à des Candidats extérieurs, donc ce n'est pas notre cas.
- **Exigences de vérification pour un scope restreint** :
  1. Vérification de la marque (nom, logo, page d'accueil), environ 2 à 3 jours ouvrés.
  2. Domaine(s) autorisé(s) vérifié(s) dans Google Search Console par un propriétaire ou éditeur du projet.
  3. Politique de confidentialité sur le même domaine que la page d'accueil, liée depuis celle-ci et depuis l'écran de consentement, qui décrit l'accès, l'usage, le stockage et le partage des données Google.
  4. Vidéo de démonstration : tout le parcours, l'écran de consentement complet (en anglais) avec les scopes exacts, et les fonctions qui les utilisent. Si les données servent à entraîner un modèle d'IA, la vidéo doit montrer le consentement explicite de l'utilisateur.
  5. Justification du scope minimal : expliquer pourquoi un scope plus étroit ne suffit pas. Ne pas demander de scope pour une fonction future.
  6. Cas d'usage admis : Google vérifie que l'app est d'un type autorisé pour les scopes restreints Gmail (en gros, des fonctions de productivité visibles par l'utilisateur). Regrouper les emails d'un utilisateur à son profit est cité comme exemple admis (https://developers.googleblog.com/2018/10/elevating-user-trust-in-our-api.html, billet de 2018). Un assistant de recherche d'emploi qui extrait les offres reçues entre dans cette logique, mais Google décide au cas par cas.
  7. Évaluation de sécurité CASA (section 3).
- **Délais** : Google parle de « plusieurs semaines » pour la vérification des scopes restreints, et parfois de « plusieurs mois ». Aucun délai garanti. Toute modification ultérieure (scopes, nom, URI de redirection) entraîne une nouvelle vérification.

## 3. Évaluation de sécurité CASA

Sources : https://support.google.com/cloud/answer/13465431 , https://appdefensealliance.dev/casa/tier-2/tier2-overview , https://developers.google.com/health/app-verification

- Obligatoire pour toute app dont les données de scopes restreints transitent par un serveur tiers (le nôtre). Elle se fait chaque année, au plus tard 12 mois après la date de la lettre d'évaluation. Google (Trust & Safety) indique quand la lancer, en dernière étape de la vérification.
- Référentiel : CASA de l'App Defense Alliance, fondé sur OWASP ASVS. Le niveau (tier 2 / AL1, tier 3 / AL2) est fixé par Google selon le nombre d'utilisateurs, les scopes et d'autres signaux de risque. Il peut monter d'une année sur l'autre et ne redescend pas une fois au tier 3.
- Tier 2 : l'auto-scan seul est **déprécié**. Il faut un laboratoire agréé qui valide nos scans (DAST/SAST) et délivre une Letter of Validation, que l'on transmet ensuite à Google.
- **Coût et délai selon Google** (page Google Health, qui suit le même processus) : 2 à 3 semaines pour le tier 2, 4 à 6 semaines pour le tier 3, avec des frais payés au laboratoire de **500 à 4 500 USD** selon la complexité de l'app.
- Prix observés chez les laboratoires (sources secondaires, à recontrôler) : TAC Security environ 540 à 1 800 USD au tier 2 avec la remise négociée par Google ; Leviathan 3 000 à 6 000 USD selon la date de démarrage (https://leviathansecurity.com/programs/google-casa-cloud-application-security-assessment).
- Les certifications existantes (ISO 27001, SOC 2…) peuvent réduire les contrôles demandés.

## 4. Exigences « Limited Use » et usage de l'IA

Sources : https://developers.google.com/terms/api-services-user-data-policy , https://developers.google.com/workspace/workspace-api-user-data-developer-policy

- Les données ne servent qu'à fournir ou améliorer des fonctions visibles par l'utilisateur dans l'app. Elles ne peuvent pas être transférées sauf exceptions (fonction consentie par l'utilisateur, sécurité, obligation légale, fusion), ni servir à la publicité ou à une décision de crédit. Aucun humain ne les lit, sauf accord explicite de l'utilisateur, besoin de sécurité, obligation légale ou données agrégées pour les opérations internes.
- **IA** : la politique Workspace interdit d'utiliser ces données « pour créer, entraîner ou améliorer un modèle d'IA/ML » au-delà du modèle personnalisé de l'utilisateur concerné. **Analyser un email avec un LLM pour en extraire une offre au profit du Candidat est une fonction visible par lui, donc admise.** Entraîner ou affiner un modèle général, ou réutiliser les emails dans les évals et les jeux de données, est interdit.
- Envoyer le contenu à un fournisseur LLM (Anthropic, Mistral) est un transfert pour fournir la fonction demandée. La politique ne cite pas nommément les sous-traitants IA (non documenté). Il faut le déclarer dans la politique de confidentialité et s'assurer que les fournisseurs ne conservent pas ces données et ne s'en servent pas pour l'entraînement (zero data retention ou équivalent).

## 5. IMAP Gmail (XOAUTH2 ou mot de passe d'application)

- IMAP avec OAuth (XOAUTH2) exige le scope `https://mail.google.com/`, qui est restreint et le plus large de tous. Les contraintes sont donc les mêmes que pour l'API, en pire (justification encore plus difficile). Source : https://developers.google.com/workspace/gmail/imap/xoauth2-protocol
- Mot de passe d'application : il faut que la validation en deux étapes soit activée. L'option est souvent absente pour les comptes Workspace, les comptes Advanced Protection et ceux qui n'utilisent que des clés de sécurité. Google le « déconseille ». Il est révoqué quand l'utilisateur change de mot de passe et donne un accès complet à la boîte. Demander au Candidat ce mot de passe revient à stocker un identifiant d'accès total, ce qui est contraire à nos règles de sécurité. **À exclure.** Source : https://support.google.com/accounts/answer/185833

## 6. Quotas, push et polling

Sources : https://developers.google.com/workspace/gmail/api/reference/quota , https://developers.google.com/workspace/gmail/api/guides/push

- Quotas : 1 200 000 unités par minute et par projet, 6 000 unités par minute et par utilisateur. Coûts unitaires : `messages.list` 5, `messages.get` 20 (60 en format `full`/`raw`), `history.list` 2, `watch` 100. Ce n'est pas un frein à l'échelle de Jobbbox.
- Push : un topic Cloud Pub/Sub sur lequel `gmail-api-push@system.gserviceaccount.com` a le droit de publier. `users.watch` peut être filtré par `labelIds`. Il faut renouveler le watch au moins tous les 7 jours (Google recommande une fois par jour). La notification ne contient que l'adresse et le `historyId`, puis on appelle `history.list`. Limite : 1 événement par seconde et par utilisateur, et les notifications peuvent être perdues, d'où un polling de secours via `history.list`.
- Polling seul (`history.list` toutes les N minutes) : plus simple, pas de GCP Pub/Sub, et largement dans les quotas.

## 7. Alternative sans scope restreint : filtre Gmail + transfert

Source : https://support.google.com/mail/answer/10957

- Le Candidat ajoute une adresse de transfert (par ex. `prenom.xyz@in.jobbbox.ai`). Gmail envoie un message de vérification à cette adresse, avec un lien à cliquer : notre réception entrante doit donc afficher ce message ou ce lien au Candidat dans l'app.
- Le Candidat crée ensuite un filtre (`from:` alertes LinkedIn, Indeed, APEC, France Travail…) avec l'action « Transférer à ». Seuls les emails choisis sortent, et Gmail affiche un rappel pendant une semaine.
- Aucun scope Google, aucune vérification, aucun CASA, aucune donnée de boîte hors du périmètre choisi par le Candidat. C'est aussi le choix le plus respectueux du RGPD (minimisation).
- Limites : l'installation se fait à la main (environ 2 minutes, depuis un navigateur sur ordinateur), et l'administrateur d'un compte Workspace peut interdire le transfert automatique (non documenté sur cette page). Ce point rejoint le ticket « adresse de transfert ».

## Recommandation

| Option | Faisable au MVP ? | Coût | Délai |
|---|---|---|---|
| API Gmail `gmail.readonly` (OAuth) | Non (plafond de 100 utilisateurs avant vérification) | 500 à 4 500 USD par an (CASA) + temps de dossier et remédiation | Souvent 1 à 3 mois la première fois, à refaire chaque année |
| IMAP XOAUTH2 | Non | Idem, avec un scope encore plus large | Idem |
| IMAP avec mot de passe d'application | Non (sécurité, Workspace) | — | — |
| Filtre Gmail + transfert vers Jobbbox | **Oui** | Coût de la réception entrante seulement | Quelques jours de développement |

1. MVP : filtre Gmail + adresse de transfert Jobbbox, avec un guide pas à pas et l'affichage du lien de vérification Gmail dans l'app.
2. Facultatif pendant le MVP : une app OAuth en mode test (moins de 100 utilisateurs, testeurs déclarés) pour mesurer la valeur d'une connexion directe, en sachant que les jetons de rafraîchissement d'une app « externe » en mode test expirent au bout de 7 jours (constat de la communauté, à vérifier).
3. Après le MVP, si la connexion directe se justifie : demander uniquement `gmail.readonly` et lire par `q=from:…` / libellé, polling via `history.list`, aucune réutilisation des emails pour les évals ou l'entraînement, des fournisseurs LLM sans rétention. Prévoir un budget CASA annuel et l'inscrire dans un ADR.

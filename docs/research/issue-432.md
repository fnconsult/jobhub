# Issue #432 : format des emails d'alerte des job boards

Carte : #426 (offres reçues par email). Sources consultées le 2026-10-27. Chaque affirmation cite sa source. **NON VÉRIFIÉ** marque ce que seules des sources secondaires (parseurs open source, connaissance générale) soutiennent : à confirmer sur le corpus réel du ticket #433.

Contraintes rappelées : ADR-0001 (aucune intégration LinkedIn), ADR-0002 (robots.txt, CGU et protections anti-bot respectés), ADR-0007 (résidence UE ; contenu porteur d'identité vers Mistral sous l'EU AI Consent), ADR-0031 (Fantastic.jobs `active-ats`). LinkedIn, Indeed et Glassdoor sont des **Forbidden sites** (`CONTEXT.md`) : jamais ouverts côté serveur.

## En bref

1. **Aucun job board ne publie le format de ses alertes.** Les pages d'aide donnent au mieux le domaine d'envoi et la fréquence. La structure des mails ne se connaît que par des exemples réels (#433) et par les parseurs open source.
2. **Pas de données structurées à attendre.** Le balisage email de Gmail (schema.org) ne prend pas en charge `JobPosting`. Il faut donc extraire depuis le texte ou le HTML.
3. **On authentifie l'expéditeur par le domaine plus DMARC.** Six des sept domaines publient un DMARC `p=reject` ou `quarantine`. APEC est en `p=none` : son domaine seul ne prouve rien.
4. **On extrait par l'IA, avec un petit gabarit par expéditeur pour les liens.** L'IA extrait les offres depuis la partie `text/plain`, plus robuste qu'un gabarit HTML. Un code déterministe par expéditeur se charge seulement d'extraire l'identifiant d'offre et de retirer les jetons de suivi propres au destinataire.
5. **L'identifiant d'une offre LinkedIn se lit dans le chemin du lien** (`/comm/jobs/view/<id>/`) sans ouvrir la page. Pour Indeed, la clé `jk` est probable mais NON VÉRIFIÉE. Retrouver l'offre à son ATS est possible via Fantastic.jobs `active-ats` (filtres `organization` + `title`), pour un coût d'environ 1 requête et quelques crédits par offre.
6. **Les CGU de LinkedIn, d'Indeed et de WTTJ ne parlent pas des alertes lues par un tiers mandaté.** Leurs clauses générales (pas de copie ni d'usage des contenus « obtenus des Services », pas d'accès automatisé) laissent une **zone grise juridique** pour LinkedIn et Indeed. Elle demande une revue juridique et un amendement d'ADR-0001.

## Expéditeurs connus

| Job board | Expéditeur / domaine | Source | DMARC du domaine (lu le 2026-10-27) | Offres par mail | Lien d'offre |
|---|---|---|---|---|---|
| LinkedIn | `LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>` | Parseurs open source (secondaire) | `p=reject` | Plusieurs (digest) | `linkedin.com/comm/jobs/view/<id>/?…` |
| Indeed | `donotreply@jobalert.indeed.com` (NON VÉRIFIÉ) ; domaines officiels `@indeed.com`, `@indeedemail.com`, `@indeedmail.com` | Aide Indeed (primaire) + PR open source | `p=reject; sp=reject` (sous-domaines compris) | Plusieurs, environ 20, sponsorisées comprises | redirection de clic Indeed (NON VÉRIFIÉ : `/rc/clk?jk=…`, `/pagead/clk…`) |
| Welcome to the Jungle | adresse inconnue ; domaine `welcometothejungle.com` probable | DNS | `p=reject` | inconnu | `welcometothejungle.com/…/jobs/…` (NON VÉRIFIÉ) |
| APEC | adresse inconnue ; domaine `apec.fr` | DNS | **`p=none`** | inconnu | `apec.fr/…` |
| HelloWork | adresse inconnue ; domaine `hellowork.com` | DNS | `p=quarantine` | inconnu | `hellowork.com/…` |
| Cadremploi | adresse inconnue ; domaine `cadremploi.fr` | DNS | `p=reject` | inconnu | `cadremploi.fr/…` |
| France Travail | domaine `@francetravail.fr` | FAQ France Travail (primaire) | `p=reject` | inconnu | `francetravail.fr/…/offre/<id>` (NON VÉRIFIÉ) |

Détail par source :

- **LinkedIn.** Les alertes sont envoyées par jour ou par semaine, par email, par notification de l'app, ou par les deux. Une nouvelle alerte est quotidienne et utilise les deux canaux par défaut. Un compte a au plus 20 alertes ([aide LinkedIn a511279](https://www.linkedin.com/help/linkedin/answer/a511279)). L'aide ne donne pas d'adresse d'envoi. Les parseurs open source ciblent `jobalerts-noreply@linkedin.com` ([Dawitstar/Job-agent](https://github.com/Dawitstar/Job-agent), [juniortlr/ai-job-search#2](https://github.com/juniortlr/ai-job-search/issues/2)). Le second relève les en-têtes `X-LinkedIn-Class: SAVEDSEARCH` et `X-LinkedIn-Template: email_job_alert_digest_01`, utiles pour reconnaître le type de mail.
  - **Structure (secondaire).** La partie `text/plain` répète un bloc par offre : titre, employeur, lieu, des badges facultatifs (« Actively recruiting », « 3 connections »), puis une ligne `View job: https://www.linkedin.com/comm/jobs/view/<id>/…` ([Job-agent](https://github.com/Dawitstar/Job-agent)). Le lieu porte parfois « (Remote) » ou « (Hybrid) » ([kafyrov/Linkedin-mail-alerts-parser](https://github.com/kafyrov/Linkedin-mail-alerts-parser)). Ni salaire, ni contrat, ni date de publication n'y apparaissent (NON VÉRIFIÉ).
  - **Liens.** Ils portent des paramètres propres au destinataire, `midToken`, `midSig`, `otpToken` et `eid` ([juniortlr#2](https://github.com/juniortlr/ai-job-search/issues/2)). Un `otpToken` est un jeton à usage unique : **il faut le retirer avant tout stockage ou journal.** Le mail contient aussi des liens qui ne sont pas des offres (« See all jobs », gérer l'alerte, désabonnement) : il faut les ignorer.
- **Indeed.** Les mails d'Indeed viennent toujours de `@indeed.com`, `@indeedemail.com` ou `@indeedmail.com` ([aide Indeed 211829163](https://www.indeed.com/help/job-seekers/articles/211829163-how-to-verify-emails-from-indeed)). Les alertes y figurent parmi les types de mails. Un pré-parseur open source cible `donotreply@jobalert.indeed.com` et compte 22 offres dans un mail type, en distinguant les offres sponsorisées ([tpruittguitar/forge-coordination#75](https://github.com/tpruittguitar/forge-coordination/pull/75)). Le format des liens n'est documenté nulle part.
- **Welcome to the Jungle.** Les alertes se gèrent dans Mon compte, onglet Mes notifications, bouton « Email alert » ([aide WTTJ](https://help.welcometothejungle.com/en/delete-email-alerts-and-remove-bookmarks-from-your-welcome-to-the-jungle-workspace)). Ni l'adresse d'envoi ni la fréquence ne sont publiées. Les mails de service sortent aussi de `wttj.co` (SPF Google, HubSpot, Zendesk). Le site bloque les robots ([job-sources.md](job-sources.md)).
- **APEC.** L'APEC propose des alertes et des notifications de nouvelles offres (fiche de l'app APEC). Rien n'est publié sur le format. Le site est derrière DataDome ([job-sources.md](job-sources.md)). Son DMARC `p=none` ne permet pas de rejeter un faux mail « apec.fr » sur le seul domaine : il faut exiger un SPF ou un DKIM aligné qui passe.
- **HelloWork, Cadremploi.** Aucune page d'aide officielle trouvée sur leurs alertes. HelloWork envoie entre autres via Mailjet (SPF). Cadremploi envoie via `spf.figarocms.net` (groupe Figaro). Les CGU de Cadremploi n'ont pas pu être lues : le fetch est refusé.
- **France Travail.** Les mails viennent de « @francetravail.fr ». Un abonnement à une recherche est valable un an ([FAQ France Travail](https://www.francetravail.fr/faq/candidat/ma-recherche-demploi/les-offres-demploi/sabonner-aux-offres/je-suis-abonne-et-je-ne-recois-a.html)). L'alerte prévient « automatiquement par e-mail des nouvelles offres » ([France Travail, recevoir les offres par mail](https://www.francetravail.fr/region/corse/candidat/recevez-mail-offres-emploi.html)). La fréquence et le contenu ne sont pas publiés. L'API *Offres d'emploi* est retirée ([job-sources.md](job-sources.md)) : on ne peut donc pas compléter une offre par l'API.

## Données structurées

- **Le balisage Gmail ne couvre pas les offres d'emploi.** Les types pris en charge sont les actions (One-Click, Go-To), les commandes, colis et factures, les réservations, et des types de base (Event, Offer, Organization…). `JobPosting` n'y figure pas ([référence du balisage Gmail](https://developers.google.com/workspace/gmail/markup/reference)). Un expéditeur doit en plus être enregistré chez Google pour que ce balisage soit affiché ([Registering with Google](https://developers.google.com/workspace/gmail/markup/registering-with-google)). Aucun job board n'a donc de raison d'inclure du JSON-LD `JobPosting` dans ses alertes.
- Il reste à vérifier sur le corpus #433 qu'aucun mail ne contient de `<script type="application/ld+json">`. Si un mail en contient, il faut le lire en priorité, puisque le code de Capture sait déjà lire `JobPosting`.

## Méthode d'extraction

| Option | Pour | Contre |
|---|---|---|
| Gabarit HTML par expéditeur (sélecteurs) | Gratuit, déterministe | Casse à chaque refonte. Sept gabarits à maintenir, multilingues (le parseur LinkedIn teste EN/PT/ES). Les CSS d'emails sont illisibles |
| Gabarit `text/plain` par expéditeur | Plus stable que le HTML (approche des parseurs LinkedIn) | Certains expéditeurs n'envoient peut-être pas de partie texte (à voir sur #433). Casse aussi |
| **IA sur le texte nettoyé** | Un seul extracteur pour tous les expéditeurs et pour les messages de recruteurs (aussi dans le périmètre de #426). Tolère les changements de gabarit. Sortie structurée | Coût par mail. Risque d'hallucination. Le mail porte le nom et l'email du Candidat, donc **Mistral sous l'EU AI Consent** |
| **Hybride (recommandé)** | L'IA lit les champs. Un code par expéditeur ne fait que le travail de liens (identifiant d'offre, suppression des jetons) | Deux couches |

Précisions sur l'hybride :

- **Reconnaître l'expéditeur.** On le reconnaît au domaine du `From` aligné, avec un DMARC `pass` dans `Authentication-Results`. Un mail transféré par le Candidat perd souvent cet en-tête : il faut alors lire le `From` d'origine dans le corps et marquer l'offre comme « non authentifiée ». À trancher avec le ticket sur l'adresse de transfert.
- **Préparer le texte.** On prend la partie `text/plain`, sinon le HTML converti en texte. On retire le pied de page et les liens hors offre. Sur un mail Indeed, cette étape fait passer le texte d'environ 26 000 à environ 5 800 caractères ([forge-coordination#75](https://github.com/tpruittguitar/forge-coordination/pull/75)), ce qui réduit le coût de l'IA.
- **Extraire avec l'IA.** Elle renvoie, pour chaque offre, titre, employeur, lieu, contrat, salaire, date (souvent absente) et l'URL telle qu'elle figure dans le mail. Un contrôle déterministe vérifie que chaque URL renvoyée existe bien dans le mail, contre l'hallucination.
- **Normaliser les liens par expéditeur.** LinkedIn donne `linkedin:<id>` depuis `/jobs/view/<id>/`. Indeed donne `indeed:<jk>` si le paramètre est présent. France Travail donne l'identifiant d'offre du chemin. Les paramètres de suivi et les jetons propres au destinataire sont retirés. **On ne suit jamais une redirection** : la résoudre ouvrirait le site, Forbidden ou protégé.
- **Déduplication.** Elle se fait sur l'identifiant normalisé, sinon sur un hachage employeur + titre + lieu, comme ADR-0013 pour les Job Offers.
- **Robustesse.** Le corpus #433 sert de fixtures et d'évals : nombre d'offres par mail, champs, identifiants. Un mail reconnu dont on tire zéro offre est une alerte de dérive de gabarit (raison d'échec dans le Journal), pas un silence.

## Liens vers des Forbidden sites

- **LinkedIn.** L'identifiant numérique est dans le chemin (`/comm/jobs/view/4359970532/`) : on le lit sans requête ([kafyrov](https://github.com/kafyrov/Linkedin-mail-alerts-parser), [Job-agent](https://github.com/Dawitstar/Job-agent)). Il sert de clé de déduplication et de lien gardé jamais ouvert, ce que la Capture par l'extension reste capable d'ouvrir.
- **Indeed.** La clé d'offre `jk` (16 caractères hexadécimaux) se trouve probablement dans l'URL de redirection (NON VÉRIFIÉ, à confirmer sur #433). Si le lien est une redirection opaque, on ne peut pas tirer d'identifiant sans appeler indeed.com, ce qui est interdit. On déduplique alors par employeur + titre + lieu.
- **Retrouver l'offre chez l'employeur.**
  - **Fantastic.jobs `active-ats`.** Il accepte les filtres `organization`, `organization_advanced`, `title` et `title_advanced` ([référence API Fantastic.jobs](https://developer.fantastic.jobs/api/beta)). Une recherche coûte 1 requête plus 1 crédit par offre renvoyée (ADR-0031). Avec `limit` à 1–3, comptez environ €0.01–0.03 par offre retrouvée. Le taux de réussite n'est pas mesuré : il dépend de la présence de l'employeur sur l'un des 58 ATS indexés.
  - **Greenhouse, Lever, Ashby en direct.** C'est gratuit, mais seulement si l'on connaît déjà le slug du board de l'employeur.
  - **Ne jamais utiliser `active-jb`**, qui contient les offres LinkedIn (ADR-0031).
  - **Statut.** La carte (#426) range déjà ce point dans « Not yet specified ». Recommandation : hors MVP, puis mesure du taux de réussite sur le corpus #433.

## Conditions d'utilisation

Aucune CGU ne traite explicitement de la lecture des alertes par un tiers mandaté par le destinataire. Voici ce qui s'en approche. Ce n'est pas un avis juridique.

- **LinkedIn ([User Agreement](https://www.linkedin.com/legal/user-agreement)).**
  - §1.1 : les « Services » comprennent les « communications » de LinkedIn.
  - §8.2 interdit de « Copy, use, display or distribute any information (including content) obtained from the Services », y compris par des tiers, sans le consentement du propriétaire du contenu. Il interdit aussi les « bots or other unauthorized automated methods to access the Services ».
  - §2.2 interdit de partager son compte.
  - Lire un mail déjà livré dans la boîte du Candidat n'accède pas aux serveurs de LinkedIn. Mais réutiliser son contenu dans un produit commercial tombe dans le libellé de §8.2. ADR-0001 dit « no LinkedIn integration of any kind » ; la carte prévoit au contraire de construire l'offre depuis le mail. **Il faut un nouvel ADR, ou un amendement d'ADR-0001, après revue juridique.**
- **Indeed ([Terms](https://www.indeed.com/legal)).**
  - §D.21 interdit d'« Access any data […] by automated means or otherwise, without permission ». Il interdit aussi de « crawl, scrape, extract data from, reproduce, duplicate, copy […] any part of the Site », et tout « automated system (bots, scrapers, spiders, AI or Agentic AI) to access, data-mine ».
  - « Site » couvre les « online and mobile services […] any software, service, feature ».
  - §E.1 cite les « job alert emails that you have subscribed to » comme un système de recommandation d'Indeed.
  - Le risque est du même ordre que pour LinkedIn, voire plus élevé, puisque la mention « AI or Agentic AI » est explicite.
- **Welcome to the Jungle ([CGU](https://www.welcometothejungle.com/fr/pages/terms)).**
  - §10 interdit les robots et la copie ou le téléchargement des Contenus.
  - §19.2 donne une licence d'usage « exclusivement à des fins personnelles ».
  - On peut soutenir que lire l'alerte pour l'usage personnel du Candidat, à sa demande, en relève. Republier l'offre à d'autres utilisateurs n'en relève pas.
- **HelloWork, Cadremploi, APEC.** Rien de lu. Les CGU de HelloWork sont sur hellowork-group.com, celles de Cadremploi sont inaccessibles au fetch, et celles de l'APEC sont derrière DataDome ([job-sources.md](job-sources.md)). À lire à la main pendant la revue juridique.
- **France Travail.** Ses offres sont un service public. Le retrait de l'API vise les « usages automatisés massifs par certaines solutions d'intelligence artificielle » ([job-sources.md](job-sources.md)). Lire les alertes d'un Candidat, offre par offre, n'est pas un usage massif, mais c'est le même sujet. À mentionner dans la demande d'accès à l'API.
- **Point commun qui réduit le risque.** On lit à la demande du destinataire, depuis sa boîte, avec son consentement. Une Job Offer « reçue par email » reste rattachée à ce seul Candidat : on ne la republie pas, et on n'ouvre aucun lien. Il faut aussi minimiser les données : ne pas garder les noms de recruteurs ni les « connections » LinkedIn affichées dans le mail.

## Recommandation

**Expéditeurs reconnus pour le MVP**, identifiés par domaine aligné plus DMARC `pass` :

| Ordre | Expéditeur | Motif |
|---|---|---|
| 1 | France Travail (`francetravail.fr`) | Public, français, DMARC `reject`, API indisponible : l'alerte est la seule voie |
| 2 | APEC (`apec.fr`) | Cœur de cible cadres. Site fermé aux robots. **Exiger SPF ou DKIM aligné** (DMARC `p=none`) |
| 3 | Welcome to the Jungle (`welcometothejungle.com`, `wttj.co`) | Site fermé aux robots. Licence d'usage personnel |
| 4 | HelloWork (`hellowork.com`), Cadremploi (`cadremploi.fr`) | Audiences françaises |
| 5 | LinkedIn (`linkedin.com`, `jobalerts-noreply@`) et Indeed (`indeed.com`, `indeedemail.com`, `indeedmail.com`) | Les plus gros volumes. **Mode « contenu du mail seul »** : lien gardé, jamais ouvert, jetons retirés. **Conditionné** à la revue juridique et à l'amendement d'ADR-0001 |

Les autres expéditeurs (messages de recruteurs, autres boards) passent par une classification IA, « contient une offre ou non », sans gabarit de liens.

**Méthode** : hybride.

- L'IA (Mistral sous l'EU AI Consent) extrait les champs depuis le `text/plain` nettoyé, en une passe par mail qui sort N offres.
- Un petit module par expéditeur reconnu extrait l'identifiant d'offre et nettoie les liens.
- Pas de JSON-LD attendu. Pas de suivi de redirection. Pas de recherche à l'ATS au MVP.
- Le corpus #433 sert de fixtures et d'évals avant de figer les gabarits de liens.

**À confirmer sur le corpus #433** :

- les adresses exactes de WTTJ, APEC, HelloWork, Cadremploi et France Travail ;
- le nombre d'offres par mail et les champs présents (salaire, contrat, date) ;
- le format des liens d'Indeed (`jk`) et de France Travail ;
- la présence d'une partie `text/plain` dans chaque mail ;
- l'absence de JSON-LD.

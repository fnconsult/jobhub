# Déclarations aux stores de l'app Jobbbox : brouillons

_#708, ADR-0076. Rédigé le 2026-11-12 à partir de `docs/privacy/register.md` et des relevés de #706. **Rien n'est saisi ni soumis** : l'entité éditrice n'existe pas encore. Chaque rubrique dit quelle issue doit la confirmer ; tant qu'elle est ouverte, la rubrique reste un brouillon. Les intitulés des questionnaires changent : à la saisie, répondre à chaque question dans l'esprit de la réponse notée ici, et corriger ce fichier si une question n'y figure pas._

Ces déclarations engagent l'éditeur : elles sont signées par [ENTITÉ À CONFIRMER], pas par l'agent qui les a préparées.

## 1. Classification par âge

**Statut : brouillon, à confirmer par #707** (l'âge minimal des CGU, s'il y en a un, décide du « public cible » de Google Play).

### App Store Connect (questionnaire, repris dans `../store.config.json`, `apple.advisory`)

| Question | Réponse | Pourquoi |
| --- | --- | --- |
| Violence (dessin animé, réaliste, prolongée), horreur, armes | Aucune | Rien de tel dans l'app. |
| Contenu sexuel, nudité, thèmes adultes ou suggestifs | Aucun | |
| Grossièretés, humour cru | Aucun | Les Guardrails filtrent les messages et les réponses du coach IA. |
| Alcool, tabac, drogues | Aucun | |
| Informations médicales ou de traitement ; santé et bien-être | Aucune ; non | Le coach parle d'emploi. Pour une détresse, un Guardrail répond par un texte fixe (le 3114), sans conseil médical. |
| Jeux d'argent, simulés ou réels ; concours ; coffres à butin | Aucun ; non | |
| Accès web sans restriction | Non | Les WebViews n'ouvrent que jobbbox.ai ; toute autre adresse s'ouvre dans le navigateur du système (ADR-0076). |
| Contenu généré par les utilisateurs | Non | Rien de ce qu'une personne écrit n'est publié à d'autres utilisateurs ; un Coach Review n'est lu que par le candidat concerné. |
| Messagerie et discussion | **À trancher (#707)** : « non » dans le brouillon | La conversation est tenue avec une IA, pas entre utilisateurs. Si Apple vise aussi les assistants IA, répondre « oui » : la classification monte, sans autre effet. |
| Publicité | Non | Aucune publicité, aucun identifiant publicitaire. |
| Contrôle parental, vérification de l'âge | Non | |
| Conçue pour les enfants (catégorie Enfants) | Non | |

Classification attendue : la plus basse (4+), ou le palier au-dessus si la question « Messagerie et discussion » reçoit « oui ».

### Google Play (questionnaire IARC, puis « Public cible et contenu »)

- Catégorie du questionnaire : utilitaire, productivité, communication ou autre.
- Violence, sexualité, langage, substances, jeux d'argent : non à tout.
- Les utilisateurs peuvent-ils interagir ou échanger du contenu entre eux ? Non (même raison que ci-dessus ; **à trancher avec #707** pour le coach IA).
- Partage de la position avec d'autres utilisateurs : non. Achats de biens numériques : non.
- Public cible : **18 ans et plus** (brouillon : à aligner sur les CGU, #707). L'app ne s'adresse pas aux enfants.
- Publicités : non.
- Contenu généré par IA (politique de Google Play) : l'app en contient (les réponses du coach IA). Le signalement exigé existe dans l'app : « Signaler un problème », sous chaque conversation.
- Application d'actualités, de santé, financière, gouvernementale : non.

## 2. App Store : confidentialité de l'app (« étiquette nutritionnelle »)

**Statut : brouillon, à confirmer par #706 (ce que dit la politique) et #707 (ce que dit l'étiquette).** L'étiquette couvre tout ce que l'app collecte, WebViews de jobbbox.ai comprises.

**Suivi (tracking) : non.** Aucune donnée n'est reliée à celles d'autres sociétés à des fins publicitaires, aucun identifiant publicitaire, l'invite App Tracking Transparency n'est jamais affichée (registre, « Crash reports »).

Toutes les données ci-dessous servent la **fonctionnalité de l'app** seulement : ni publicité, ni mesure d'audience, ni personnalisation commerciale.

| Type de données (Apple) | Ce que c'est dans Jobbbox | Liée à la personne | Entrée du registre |
| --- | --- | --- | --- |
| Coordonnées : adresse e-mail | L'adresse du compte, ou celle que transmet Google, Apple ou Microsoft | Oui | Candidate accounts and sign-in |
| Coordonnées : nom | Prénom, nom, prénom d'usage | Oui | Candidate accounts and sign-in |
| Coordonnées : numéro de téléphone, adresse postale | Ceux que porte le CV de la personne | Oui | Master CV, Profiles and CV reading. **À trancher (#707)** : les déclarer à part, ou sous « Autre contenu utilisateur » |
| Contenu utilisateur : autre contenu | CV, profils, candidatures, entretiens, documents adaptés, messages au coach IA, lien ou texte d'une offre partagée | Oui | Master CV… ; Applications… ; Coach Conversations ; Share capture |
| Contenu utilisateur : assistance client | Les Signalements (bug, idée, question) | Oui | Signalements |
| Historique de recherche | Les critères et les recherches d'offres | Oui | Job Searches, Job discovery and Job Digests. **À trancher (#707)** : ce type, ou « Autre contenu utilisateur » |
| Identifiants : identifiant utilisateur | L'identifiant du compte | Oui | Candidate accounts and sign-in |
| Identifiants : identifiant de l'appareil | Le jeton de notification (APNs), si la personne autorise les notifications | Oui | Push notifications of the app |
| Achats : historique d'achats | L'offre (Plan) et les commandes de Coaching Sessions | Oui | Subscriptions… ; Orders |
| Données d'utilisation : interaction avec le produit | Le décompte des utilisations par outil sur la période de facturation | Oui | Consommation ; AI Usage. **À trancher (#707)** |
| Diagnostic : données de plantage | Les rapports de plantage, sans identifiant une fois stockés | **Non** | Crash reports |

**Non collecté** (ne pas cocher) : position ; contacts du carnet d'adresses ; photos, vidéos, audio ; santé et forme ; données sensibles ; historique de navigation ; données publicitaires ; informations de paiement (la carte est saisie sur la page de Stripe, dans le navigateur intégré : Jobbbox ne la reçoit pas ; **à confirmer par #707**) ; données biométriques (Face ID et l'empreinte sont traités par le système seul, registre « App lock on the device »).

**Gardé sur l'appareil seulement, donc hors étiquette** : la session (trousseau), le cache de lecture, les documents téléchargés, le réglage du verrouillage. À relire avec #706 : le cache peut partir dans la sauvegarde de l'appareil.

**Manifeste de confidentialité** (`PrivacyInfo.xcprivacy`, `app.json`, `ios.privacyManifests`) : `NSPrivacyTracking` à `false` et les raisons des API à déclarer sont posés. `NSPrivacyCollectedDataTypes` est **à ajouter quand #707 a validé le tableau ci-dessus** (changement natif : une build).

## 3. Google Play : Sécurité des données

**Statut : brouillon, à confirmer par #706 et #707.**

- **L'app collecte-t-elle ou partage-t-elle des données ?** Oui, elle en collecte.
- **Toutes les données sont-elles chiffrées en transit ?** Oui (HTTPS seul ; une build des stores refuse le HTTP, `app.config.ts`).
- **Les utilisateurs peuvent-ils demander la suppression de leurs données ?** Oui : dans l'app (Mon compte, « Mes données », « Supprimer mon compte ») et par le lien de la fiche (`fr.md`).
- **Création de compte** : par lien ou code reçu par e-mail, ou par Google, Apple ou Microsoft.
- **Partage avec des tiers : aucun**, au sens de Google. Les sous-traitants qui agissent pour Jobbbox (hébergement, fournisseurs d'IA après Redaction, e-mail, Stripe, Apple et Google pour acheminer les notifications, Sentry) ne comptent pas comme un partage ; la lecture par un coach humain se fait à la demande de la personne (Coach Access). **À confirmer par #707**, fournisseur par fournisseur.

| Catégorie (Google) | Type | Collecté | Obligatoire | Finalité |
| --- | --- | --- | --- | --- |
| Informations personnelles | Nom ; adresse e-mail ; identifiants utilisateur | Oui | Oui | Fonctionnement de l'app, gestion du compte |
| Informations personnelles | Adresse, numéro de téléphone (ceux du CV) | Oui | Non | Fonctionnement de l'app. **À trancher (#707)** |
| Informations financières | Historique des achats | Oui | Non | Fonctionnement de l'app |
| Messages | Autres messages dans l'application (conversations avec le coach IA) | Oui | Non | Fonctionnement de l'app |
| Fichiers et documents | CV et documents adaptés | Oui | Non | Fonctionnement de l'app |
| Activité dans les applications | Historique des recherches dans l'application ; autre contenu généré par l'utilisateur (candidatures, entretiens, Signalements) ; interactions (décompte par outil, **à trancher**) | Oui | Non | Fonctionnement de l'app |
| Infos et performances des applications | Journaux de plantage | Oui | Oui (aucun réglage ne les coupe) | Fonctionnement de l'app (diagnostic) |
| Appareil ou autres ID | Jeton de notification (FCM) | Oui | Non (après autorisation) | Fonctionnement de l'app |

Non collecté : position, contacts, photos et vidéos, fichiers audio, agenda (l'ajout au calendrier est en écriture seule, par la feuille du système : rien n'est lu), santé, navigation web, informations de paiement (**à confirmer**, comme pour Apple).

## 4. Conformité à l'exportation (chiffrement)

**Statut : posé dans `app.json` (`ios.config.usesNonExemptEncryption: false`), à relire par l'éditeur à la première soumission.**

- L'app n'utilise que le chiffrement du système : HTTPS (TLS) pour ses appels, le trousseau (Keychain, Keystore) pour la session, les passkeys du système. Elle ne contient aucun algorithme de chiffrement propre ou tiers.
- Réponse à App Store Connect : l'app n'utilise **aucun chiffrement non exempté** ; aucune documentation à fournir, aucune déclaration française de moyen de cryptologie demandée dans ce cas. La clé `ITSAppUsesNonExemptEncryption` vaut `false` dans chaque build : la question n'est plus posée à chaque envoi.
- Google Play : la même réponse à la question sur les lois d'exportation des États-Unis à l'acceptation des conditions.
- Une dépendance qui apporterait son propre chiffrement change la réponse : `e2e/store-listings.e2e.test.ts` garde la clé, le relecteur garde la raison.

## 5. Paiements et contenu : les positions de #707

**Statut : brouillon, à confirmer par #707 avant toute soumission.** Elles sont reprises dans les notes pour la revue (`review-notes.md`).

1. Aucun achat intégré. L'offre (Plan) est affichée sans prix, avec « Votre abonnement se gère sur jobbbox.ai. », sans lien d'achat (règle 3.1.3(b)).
2. Une Coaching Session, service en direct et en tête-à-tête entre deux personnes, se paie par Stripe Checkout dans le navigateur intégré (règle 3.1.3(d)) ; côté Google Play, l'exception de la politique de paiement pour les services rendus hors de l'app.
3. Les Masterclasses ne sont vendues que sur le web (ADR-0100) : l'app n'en vend pas.
4. La rétractation reste sur sa page web, ouverte depuis l'app.
5. Suppression du compte dans l'app (5.1.1(v)) ; Sign in with Apple proposé dès que Google l'est (4.8).

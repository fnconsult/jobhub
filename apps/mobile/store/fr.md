<!--
Fiches de l'app Jobbbox sur l'App Store et Google Play (#708, ADR-0076), en français : le texte fait foi. La version
anglaise est en.md. À recopier dans App Store Connect et la Play Console, champ par champ (docs/ops/mobile.md,
« Fiches des stores et première soumission ») ; store.config.json en reprend les champs de l'App Store pour
`eas metadata:push`. Les libellés entre « » sont ceux de l'interface, mot pour mot.

BROUILLON tant que l'entité éditrice n'existe pas : rien n'est soumis. Chaque champ qui attend son nom porte
[ENTITÉ À CONFIRMER] ; mobile.yml refuse une build `production` tant que ce marqueur est dans ce dossier. Un champ noté
« brouillon, #706 » ou « brouillon, #707 » attend la Legal Review de l'issue nommée. Sous chaque titre, la limite du
store : e2e/store-listings.e2e.test.ts la vérifie.
-->

# Les deux stores

- **App** : Jobbbox, `ai.jobbbox.app` (iPhone, iPad, Android ; une seule app pour les candidats et les coachs humains)
- **Langue par défaut** : français (France), `fr-FR` ; l'anglais par sa fiche localisée (`en.md`, `en-US`)
- **Pays** : France, Belgique, Suisse, Luxembourg, Canada
- **Prix** : gratuite, sans achat intégré
- **Catégorie, App Store** : Économie et entreprise (`BUSINESS`), puis Productivité (`PRODUCTIVITY`)
- **Catégorie, Google Play** : Professionnel (Business) ; type : application
- **Site web (URL marketing)** : https://jobbbox.ai
- **URL d'assistance** : https://jobbbox.ai/aide (Centre d'aide)
- **Politique de confidentialité** : https://jobbbox.ai/legal/confidentialite (brouillon, #706 : la version qui couvre l'app doit être en vigueur avant la soumission)
- **Suppression du compte (Google Play, lien exigé)** : https://jobbbox.ai/aide/utiliser/faq-data-export-deletion (à vérifier à la saisie ; dans l'app : Mon compte, « Mes données », « Supprimer mon compte »)
- **Éditeur affiché, vendeur, copyright** : [ENTITÉ À CONFIRMER]
- **E-mail de contact affiché (Google Play, obligatoire)** : [ENTITÉ À CONFIRMER] (une adresse de l'entité, relevée par une personne)
- **À confirmer avant la soumission** : dans la description, le paragraphe des coachs humains et l'absence d'achat intégré (brouillon, #707), le paragraphe des données (brouillon, #706)
- **Captures d'écran** : `screenshots/`, en français ; la fiche anglaise montre celles de la langue par défaut
- **Icône** : provisoire, le mot Jobbbox sur l'accent indigo (ADR-0053), `../assets/icon.png`

## Description (4 000 caractères au plus)

Jobbbox vous accompagne dans votre recherche d'emploi après 40 ans : un coach IA, vos candidatures, vos recherches d'offres et votre agenda, sur votre téléphone et votre tablette.

L'app utilise le même compte que jobbbox.ai : ce que vous faites sur l'un se retrouve sur l'autre. Pas de mot de passe : vous vous connectez par un lien ou un code reçu par e-mail.

Votre coach IA
Écrivez-lui comme dans une conversation : préparer un entretien, relancer un recruteur, comprendre une offre. Le coach est une intelligence artificielle, pas une personne : il le dit au début de chaque conversation. Il propose, vous décidez de chaque changement. Comme toute IA, il peut se tromper : relisez ce qu'il écrit.

Vos candidatures
Chaque candidature a sa fiche : son statut, ses entretiens, son score de correspondance avec votre profil. Ajoutez, déplacez ou annulez un entretien. Ouvrez, partagez ou téléchargez votre CV adapté et votre lettre de motivation.

Vos recherches d'offres
Les offres trouvées pour vous attendent dans une boîte : suivez celles qui vous intéressent, écartez les autres. Depuis une autre app, partagez une offre vers Jobbbox pour l'enregistrer.

Votre agenda
Vos entretiens et vos séances, jour par jour, à ajouter au calendrier de votre appareil. Jobbbox ne lit pas votre calendrier.

Des coachs humains
Pour parler à une personne, réservez une séance avec un coach humain, un professionnel RH sélectionné par Jobbbox. La séance se tient en visio, en direct et en tête-à-tête.

Et aussi
• Les notifications que vous choisissez : nouveaux résultats, rappel d'un entretien, avis d'un coach. Leur texte ne nomme jamais une entreprise, un poste ni une personne.
• Hors ligne, vous relisez ce que vous avez consulté en dernier.
• Verrouillage de l'app par la biométrie ou le code de votre appareil.
• Le texte suit la taille choisie dans votre appareil, le thème sombre aussi ; l'app se lit avec le lecteur d'écran de votre appareil.
• En français et en anglais.

Vos données
Pas de publicité, pas de mesure d'audience, pas de suivi publicitaire. Vous pouvez télécharger vos données ou supprimer votre compte à tout moment, dans Mon compte.

Aide : https://jobbbox.ai/aide
Politique de confidentialité : https://jobbbox.ai/legal/confidentialite

# App Store

## Nom (30 caractères au plus)

Jobbbox

## Sous-titre (30 caractères au plus)

Votre coach IA pour l'emploi

## Texte promotionnel (170 caractères au plus)

Votre coach IA, vos candidatures, vos offres et votre agenda dans votre poche. Le même compte que sur jobbbox.ai, sur iPhone et iPad.

## Mots-clés (100 caractères au plus, séparés par des virgules)

emploi,candidature,CV,lettre de motivation,entretien,coach,offres,recrutement,senior,carrière

## Nouveautés de cette version (4 000 caractères au plus)

Première version de l'app Jobbbox sur iPhone et iPad.

_Ensuite : le texte que `npm run store-whats-new -w @jobhub/help` tire de la Release Note de la Version (docs/ops/mobile.md)._

# Google Play

## Titre (30 caractères au plus)

Jobbbox

## Description courte (80 caractères au plus)

Votre coach IA, vos candidatures et vos offres d'emploi, sur votre téléphone.

## Notes de version (500 caractères au plus)

Première version de l'app Jobbbox sur Android.

_Ensuite : `whatsnew-fr-FR`, écrit par `npm run store-whats-new -w @jobhub/help`._

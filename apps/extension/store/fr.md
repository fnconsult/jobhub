<!--
Fiches Chrome Web Store de l'extension Jobbbox (#563, ADR-0063), en français : le texte fait foi. À recopier dans le
tableau de bord du Chrome Web Store, champ par champ, quand le texte change (docs/ops/extension.md). La version
anglaise est en.md. Les libellés entre « » sont ceux de l'interface, mot pour mot.
-->

# Fiche publique

- **Visibilité** : publique
- **Nom** : Jobbbox (`__MSG_extName__`, `public/_locales/fr/messages.json`)
- **Build** : `jobbbox-extension-X.Y.Z-chrome.zip`, branchée sur la Production (`https://jobbbox.ai`)
- **Catégorie** : Productivité
- **Langue** : français (l'anglais par sa fiche localisée, `en.md`)
- **Politique de confidentialité** : https://jobbbox.ai/legal/confidentialite
- **URL d'assistance** : https://jobbbox.ai/aide/extension (Centre d'aide, rubrique « L'extension »)
- **Site web** : https://jobbbox.ai

## Résumé (132 caractères au plus)

Capturez une offre d'emploi et préparez votre candidature avec votre coach Jobbbox.

## Description

L'extension Jobbbox enregistre dans Jobbbox l'offre d'emploi que vous lisez sur un site d'offres, et calcule son score de correspondance avec votre CV, sans copier-coller.

Sur la page d'une offre, elle ajoute le bouton « Analyser cette offre ». Vous pouvez aussi l'ouvrir dans le panneau latéral du navigateur et cliquer sur « Capturer cette page ».

Sans compte : déposez votre CV, l'extension calcule le Match Score de l'offre, puis efface tout au plus tard 24 heures après.

Avec un compte Jobbbox : « Se connecter », dans l'extension, et l'offre rejoint vos candidatures, où votre coach vous aide à préparer un CV adapté et une lettre de motivation.

Sur les sites d'offres, l'extension reconnaît une offre dans votre navigateur ; elle n'envoie une page à Jobbbox que lorsque vous cliquez. Pour voir « Analyser cette offre » aussi sur les sites carrières des employeurs, cochez « Détecter les offres sur tous les sites » dans le panneau : votre navigateur vous demande alors l'autorisation.

Aide : https://jobbbox.ai/aide/extension
Politique de confidentialité : https://jobbbox.ai/legal/confidentialite

## Objectif unique

Enregistrer dans Jobbbox l'offre d'emploi consultée et en calculer le score de correspondance avec le CV de la personne.

## Justification des autorisations

- **activeTab, scripting** : lire la page de l'offre que la personne consulte, quand elle clique sur « Capturer cette page » ou « Analyser cette offre ». Le script de contenu des sites d'offres reconnaît une offre pour afficher ce bouton, sans envoyer la page.
- **storage** : garder la session de la personne sans compte, en mémoire, et ses réglages.
- **alarms** : effacer la session sans compte à l'heure prévue, au plus tard 24 heures après.
- **sidePanel** : l'extension s'ouvre dans le panneau latéral du navigateur, à côté de l'offre.
- **Autorisations d'hôte (jobbbox.ai et sites d'offres)** : partager la session de la personne sur jobbbox.ai, et lire l'offre d'un site d'offres, y compris quand elle est affichée dans un cadre d'une autre page.
- **Autorisation d'hôte facultative (tous les sites)** : demandée seulement si la personne coche « Détecter les offres sur tous les sites ».
- **Code distant** : aucun. Tout le code est dans le paquet.

# Fiche beta

- **Visibilité** : non répertoriée (accessible par son lien, pour les testeurs)
- **Nom** : Jobbbox (bêta) (`__MSG_extNameBeta__`), avec l'icône orange marquée β
- **Build** : `jobbbox-extension-X.Y.Z-chrome-beta.zip`, branchée sur la Beta (`https://staging.jobbbox.ai`)
- **Catégorie** : Productivité
- **Politique de confidentialité** : https://staging.jobbbox.ai/legal/confidentialite
- **URL d'assistance** : https://staging.jobbbox.ai/aide/extension
- **Site web** : https://staging.jobbbox.ai

## Résumé (132 caractères au plus)

Version bêta de l'extension Jobbbox, reliée à la Beta : pour tester les nouveautés avant leur publication.

## Description

Version bêta de l'extension Jobbbox, réservée aux testeurs. Elle est reliée à la Beta de Jobbbox (staging.jobbbox.ai), et non au site public : utilisez-la avec votre compte sur la Beta.

Pour l'usage courant, installez l'extension Jobbbox publique.

Elle fait la même chose que l'extension publique : sur la page d'une offre, « Analyser cette offre » ou « Capturer cette page » l'enregistre dans Jobbbox et calcule son score de correspondance avec votre CV.

Aide : https://staging.jobbbox.ai/aide/extension
Politique de confidentialité : https://staging.jobbbox.ai/legal/confidentialite

## Objectif unique et justification des autorisations

Les mêmes que la fiche publique, jobbbox.ai devenant staging.jobbbox.ai.

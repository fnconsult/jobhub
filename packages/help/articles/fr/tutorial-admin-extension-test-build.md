---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Charger une version de test de l'extension
synonyms: [extension, version de test, identifiant, EXTENSION_ORIGINS, ne reconnaît pas, automatique hors production, listée, dernière version, extension version, zip, bêta, chrome-beta, non empaquetée, charger l'extension non empaquetée, mode développeur, chrome://extensions, télécharger le zip, tester l'extension]
---
Avant sa publication sur le Chrome Web Store, un administrateur peut charger dans Chrome la dernière version de l'extension, celle que sert le serveur. Les candidats ne voient pas ce bloc.

1. Dans Mon compte, ouvrez « Outils ». Sous le bouton du Chrome Web Store, le bloc « Dernière version de l'extension » indique la « Version de l'extension », la « Version d'API servie » et l'« Identifiant de l'extension ». Il dit aussi si ce serveur reconnaît ce zip, et pourquoi : sur la Beta, il le reconnaît automatiquement, sans rien ajouter. En Production, il ne le reconnaît que si son origine est listée dans le réglage de déploiement EXTENSION_ORIGINS : s'il affiche « Ce serveur ne reconnaît pas encore ce zip », faites ajouter l'origine indiquée et redéployer avant de continuer, sans quoi l'extension chargée affiche « Jobbbox ne reconnaît pas cette installation de l'extension » à chaque capture. Le lien vers Paramètres › Environnement montre la même chose.
2. Cliquez sur « Télécharger », suivi du nom du zip : `-chrome-beta.zip` sur la Beta (branché sur staging.jobbbox.ai), `-chrome.zip` en Production. Le serveur le fournit lui-même : aucun accès à GitHub n'est nécessaire. Décompressez-le.
3. Ouvrez chrome://extensions et activez le « Mode développeur ».
4. Cliquez sur « Charger l'extension non empaquetée » et choisissez le dossier décompressé.

Le zip garde le même identifiant quel que soit le dossier où vous le décompressez : une fois reconnu, chaque nouvelle version l'est aussi. Une extension chargée ainsi ne se met pas à jour seule : recommencez à chaque nouvelle version. Si le serveur ne sert plus sa version d'API, l'extension demande de se mettre à jour. Si le bloc indique que ce serveur ne sert pas de zip, c'est un serveur de développement : seuls les déploiements en portent un.

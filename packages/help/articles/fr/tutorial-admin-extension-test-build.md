---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Charger une version de test de l'extension
synonyms: [extension, version de test, identifiant, EXTENSION_ORIGINS, ne reconnaît pas, dernière version, extension version, zip, bêta, chrome-beta, non empaquetée, charger l'extension non empaquetée, mode développeur, chrome://extensions, télécharger le zip, tester l'extension]
---
Avant sa publication sur le Chrome Web Store, un administrateur peut charger dans Chrome la dernière version de l'extension, celle que sert le serveur. Les candidats ne voient pas ce bloc.

1. Dans Mon compte, ouvrez « Outils ». Sous le bouton du Chrome Web Store, le bloc « Dernière version de l'extension » indique la « Version de l'extension », la « Version d'API servie » et l'« Identifiant de l'extension ». S'il affiche « Ce serveur ne reconnaît pas encore ce zip », ajoutez l'origine indiquée au réglage de déploiement EXTENSION_ORIGINS et redéployez avant de continuer : sans cela, l'extension chargée affiche « Jobbbox ne reconnaît pas cette installation de l'extension » à chaque capture.
2. Cliquez sur « Télécharger », suivi du nom du zip : `-chrome-beta.zip` sur la Beta (branché sur staging.jobbbox.ai), `-chrome.zip` en Production. Le serveur le fournit lui-même : aucun accès à GitHub n'est nécessaire. Décompressez-le.
3. Ouvrez chrome://extensions et activez le « Mode développeur ».
4. Cliquez sur « Charger l'extension non empaquetée » et choisissez le dossier décompressé.

Le zip garde le même identifiant quel que soit le dossier où vous le décompressez : une fois l'origine ajoutée, chaque nouvelle version est reconnue. Une extension chargée ainsi ne se met pas à jour seule : recommencez à chaque nouvelle version. Si le serveur ne sert plus sa version d'API, l'extension demande de se mettre à jour. Si le bloc indique que ce serveur ne sert pas de zip, c'est un serveur de développement : seuls les déploiements en portent un.

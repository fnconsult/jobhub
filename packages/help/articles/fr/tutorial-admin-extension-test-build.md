---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Charger une version de test de l'extension
synonyms: [extension, version de test, dernière version, extension version, zip, bêta, chrome-beta, non empaquetée, charger l'extension non empaquetée, mode développeur, chrome://extensions, github, releases, extension-v, tester l'extension]
---
Avant sa publication sur le Chrome Web Store, un administrateur peut charger dans Chrome la dernière version de l'extension, celle que sert le serveur. Les candidats ne voient pas ce bloc.

1. Dans Mon compte, ouvrez « Outils ». Sous le bouton du Chrome Web Store, le bloc « Dernière version de l'extension » indique la « Version de l'extension » et la « Version d'API servie ».
2. Cliquez sur « Voir les versions sur GitHub ». La page s'ouvre dans un nouvel onglet ; le dépôt est privé : il faut y avoir accès.
3. Dans la version `extension-v` de cette version de l'extension, téléchargez le zip que nomme le bloc : `-chrome-beta.zip` sur la Beta (branché sur staging.jobbbox.ai), `-chrome.zip` en Production. Décompressez-le.
4. Ouvrez chrome://extensions et activez le « Mode développeur ».
5. Cliquez sur « Charger l'extension non empaquetée » et choisissez le dossier décompressé.

Une extension chargée ainsi ne se met pas à jour seule : recommencez à chaque nouvelle version. Si le serveur ne sert plus sa version d'API, l'extension demande de se mettre à jour.

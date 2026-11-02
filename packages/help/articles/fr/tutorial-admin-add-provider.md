---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Ajouter un fournisseur et le rendre actif
synonyms: [ajouter un fournisseur, nouveau fournisseur, rendre actif, fournisseur actif, changer de fournisseur, brancher un service, clé d'api, recherche web, perplexity, brave, tavily]
---
Un fournisseur s'ajoute en saisissant sa clé sur sa fiche, puis devient le fournisseur actif de son onglet. Seuls les super-admins saisissent une clé ; « Technique » peut rendre actif un fournisseur dont la clé est déjà saisie.

1. Ouvrez Paramètres, puis l'onglet du fournisseur, par exemple « Recherche web ».
2. Cliquez sur « + Ajouter », choisissez le type « Fournisseur », puis le fournisseur dans la liste « Fournisseur », et cliquez sur « Ouvrir sa fiche ». Vous pouvez aussi cliquer sur son nom dans « Fournisseurs possibles ».
3. Dans la rubrique « Clés » de sa fiche, ouvrez « Remplacer … » pour sa clé, collez-la dans « Nouvelle valeur de … », puis cliquez sur « Tester et enregistrer … ». La clé est testée auprès du fournisseur, chiffrée, et ne sera plus jamais affichée.
4. Vérifiez le message « … remplacée : le test de connexion a réussi. » et, dans « Fournisseurs possibles », l'« État » « Configuré ».
5. Dans la colonne « Actions » de sa ligne, cliquez sur « Rendre actif ». Il passe dans la carte « Fournisseur actif » et sert dès le prochain appel, sans redémarrage.

Un fournisseur rendu actif sans sa clé est accepté, avec l'avertissement « Sans clé : les appels échoueront tant qu'elle n'est pas saisie. » Pour un modèle d'IA, il n'y a pas de fournisseur actif : choisissez le fournisseur de chaque tâche dans l'onglet « IA ». Si le fournisseur traite des données hors UE, lisez d'abord « Activer un destinataire hors UE ».

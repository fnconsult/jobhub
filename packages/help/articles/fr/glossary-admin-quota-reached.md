---
kind: glossary
audience: administrator
topic: fournisseurs-et-tools
title: Quota atteint
synonyms: [quota atteint, quota épuisé, limite atteinte, quota, crédit épuisé, plan épuisé, limite de débit, rate limit, 429, facturation, renouveler le quota, bandeau, e-mail, alerte]
---
Un outil a son **quota atteint** quand son fournisseur refuse de l'appeler pour une question de quota. Seuls les outils à API qui en ont un sont concernés : les modèles d'IA, la recherche web, l'enrichissement de contacts et Fantastic.jobs. Il y a deux états :

- **« limite atteinte »** : le fournisseur limite le débit (trop d'appels en peu de temps, HTTP 429) ;
- **« quota épuisé »** : le crédit ou le plan payé chez le fournisseur est épuisé.

Chaque état commence au premier refus du fournisseur et dure tant qu'il refuse : il prend fin au premier appel accepté de cet outil, ou à la date de renouvellement donnée par le fournisseur. Un test de connexion réussi ne suffit pas : il vérifie la clé, pas le quota.

Tant qu'au moins un outil a son quota atteint, le bandeau « Quota atteint » s'affiche en tête de chaque page du Back Office, pour tout Administrator, quel que soit son rôle. Il disparaît de lui-même dans la demi-minute qui suit le retour à la normale. Chaque ligne nomme l'outil, son état et depuis quand.

Le premier quota atteint de la journée (heure de Paris) envoie aussi un e-mail à chaque Administrator, quel que soit son rôle, dans sa langue : il liste les outils dont le quota est encore atteint, avec les deux mêmes liens. Il en part au plus un par jour : un autre outil atteint le même jour figure dans l'e-mail du lendemain s'il l'est encore. Aucun e-mail ne part quand un quota redevient disponible.

Pour y remédier, chaque ligne donne deux liens :

- « Facturation de … » ouvre, dans un nouvel onglet, la page du fournisseur où se paie ou se renouvelle le quota ;
- « Configurer … » mène là où l'outil se règle dans le Back Office : sa fiche dans Paramètres quand sa clé s'y saisit, sinon sa page dans Outils. Ce lien n'apparaît qu'aux rôles qui peuvent ouvrir ces pages (super-admin, Technique et Support).

La page qu'ouvre « Facturation de … » se règle dans les paramètres de l'outil, sur sa fiche dans Paramètres, section « Facturation » : celle du catalogue par défaut, une URL https seulement, et « Rétablir » y revient. Le bandeau, le bloc « API » du tableau de bord et l'e-mail suivent la valeur saisie.

Un refus HTTP 401 « insufficient_quota » de Perplexity compte comme « quota épuisé », pour une recherche comme pour un test de connexion, de même que le plafond de dépense mensuel de Claude.

Une « limite atteinte » se lève souvent seule après quelques instants. Un « quota épuisé » demande de recréditer le compte ou de changer de plan chez le fournisseur, ou, en attendant, de choisir un autre fournisseur dans Paramètres.

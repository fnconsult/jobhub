---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Paramètres
synonyms: [paramètres, vidéos d'aide, origine des vidéos, réglages, configuration, fournisseur, fournisseur actif, fournisseurs possibles, clé, onglet, environnement, valeur par défaut, rétablir, ajouter]
route: /admin/parametres
---
Paramètres réunit les réglages de la plateforme, par type d'outil, en onglets : « Recherche web », « IA », « Sources », « Enrichissement de contacts », « E-mail », « Paiement », « Connexion », « Extension » et « Environnement ». L'onglet est dans l'adresse : un rechargement le garde. « Extension » tient aussi la « Page de l'app sur l'App Store (lien de la page d'accueil) » et la « Page de l'app sur Google Play (lien de la page d'accueil) » : tant qu'une page n'est pas renseignée, la page d'accueil ne montre pas de lien vers ce magasin. « Environnement » tient aussi le « Parcours des coachs humains sur le site public (à activer avec l'espace coach) » : tant qu'il est désactivé, la page des coachs humains répond 404 et la page d'accueil ne propose pas le choix entre candidat et coach humain. Il tient aussi l'« Origine des vidéos d'aide (Explainer Videos du centre d'aide) » : l'adresse d'où le centre d'aide lit ses vidéos, https://media.jobbbox.ai par défaut ; les pages n'acceptent de vidéo que de cette origine.

Un onglet de fournisseurs montre d'abord la carte « Fournisseur actif », avec les réglages de l'onglet, puis le tableau « Fournisseurs possibles » : chaque fournisseur avec ses clés, son « Dernier test », son « État » et ce qu'il sert (« Utilisé par »). Cliquez sur le nom d'un fournisseur pour ouvrir sa fiche sur le côté : ses clés, ses paramètres, ses prix et le lien « Ses appels, ses échecs et son coût dans Outils ». « Rendre actif » choisit le fournisseur de la recherche web ou des contacts enrichis.

L'onglet « IA » réunit aussi le groupe « Coach IA » : « Coach Actions activées (le coach IA lit et propose) », à false par défaut, et « Tours d'appels de Coach Actions par réponse, au plus » (2 par défaut, de 0 à 4). Leurs outils sont rangés sous « Routes locales » dans Outils.

Chaque réglage montre sa « Valeur en vigueur » et sa « Source » : une valeur saisie dans le back office l'emporte sur l'environnement du serveur, qui l'emporte sur le « Défaut du code ». « Enregistrer » applique une nouvelle valeur en quelques secondes, sans redémarrage ; « Rétablir » efface la valeur du back office. Un réglage marqué « Se règle dans l'environnement » ne se change pas ici.

« + Ajouter » ajoute ce que l'onglet contient : un fournisseur, une clé, un modèle, une source, un site ou un fournisseur de connexion. Chaque modification et chaque tentative refusée est inscrite dans Activité. Les super-admins changent tout ; « Technique » change les réglages et les sites sans jamais voir ni remplacer une clé ; le Support lit tout et ne change rien.

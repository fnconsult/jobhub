---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Outils
synonyms: [outils, tools, routes locales, coach actions, outil externe, service tiers, état, appels, échecs, coût, résidence, hors UE, fiche d'un outil, derniers appels, raison]
route: /admin/outils
---
Outils liste chaque outil externe que Jobbbox appelle, depuis l'app web et le worker, rangé par catégorie : à quoi il sert (« Usage »), qui l'appelle (« Appelé par »), où il traite les données (« Données traitées » : « Dans l'UE », « Hors UE » ou « Non établi »), son « État », ses « Clés », ses « Appels (30 j) », ses « Échecs » et son « Coût (30 j) ». Ni le contenu des appels ni les clés ne sont affichés.

L'« État » dit si l'outil peut être appelé : « Configuré », « Sans clé », « Clé manquante », « Paramètre manquant », « Désactivé », « Non configuré » ou « En attente d'accès ». Le badge « env » signale un réglage venu de l'environnement qui diffère de la valeur par défaut du code.

« Fiche » ouvre la page d'un outil : ses chiffres des « 30 derniers jours », ses « Derniers appels » avec leur « Résultat » et leur « Durée », pour un modèle d'IA le tableau « Échecs et avertissements par raison (30 j) », et ses « Paramètres », en lecture seule. Un outil hors UE activé sans être nommé par la politique de confidentialité en vigueur y garde l'avertissement « … : destinataire hors UE non couvert ».

Les outils rangés sous « Routes locales » ne sont pas des services externes : ce sont les groupes de Coach Actions, le code de Jobbbox que le coach IA appelle pour lire les données du candidat ou lui préparer une modification, qu'il applique lui-même. Sans appel d'IA ni clé, dans l'UE, ils sont un par groupe : « Candidatures », « Agenda », « Profil », « Recherches d'offres », « Job Digests » et « Documents ». Chaque appel compte dans leurs « Appels (30 j) » sous le nom de la Coach Action, sans le candidat ni ce qu'elle a lu ou préparé ; un appel refusé, jamais exécuté (outil inconnu, arguments invalides, proposition de trop), est un échec de raison « Appel refusé : outil inconnu ou arguments invalides ». Ils restent « Désactivé » tant que « Coach Actions activées (le coach IA lit et propose) » est à false, sa valeur par défaut : le coach IA n'a alors aucun outil et répond comme avant. Ce réglage s'allume dans Paramètres, onglet « IA », groupe « Coach IA », d'abord sur la Beta, avec « Tours d'appels de Coach Actions par réponse, au plus » : 2 par défaut, de 0 à 4, 0 revenant à répondre sans eux. Allumés, ils sont « Sans clé ».

APNs (Apple, pour iPhone et iPad) et FCM (Google, pour Android), rangés sous « Notifications de l'app », envoient depuis le worker les notifications de l'app Jobbbox : la clé .p8 d'APNs et le compte de service de FCM se saisissent dans Paramètres, onglet « Environnement ». Leur fiche montre en plus « Notifications de l'app » : celles qui n'ont pas été remises ces 90 derniers jours, avec leur événement, leur raison et leur statut HTTP, jamais le jeton, le compte ni le texte ; un appareil dont le jeton n'est plus valide est retiré. Un super-admin y trouve « Envoyer une notification de test », qui l'envoie à ses propres appareils de cette plateforme, quels que soient ses réglages de Rappels.

GitHub, rangé sous « Livraison », sert la page Livraison : son jeton en lecture seule se saisit dans Paramètres, onglet « Environnement ».

Outils se lit seulement : une clé, un réglage ou un fournisseur se change dans Paramètres. « Tous les outils » ramène à la liste.

La réservation Cal.com d’équipe utilise un événement à un seul hôte, vérifié et rattaché depuis « Coachs humains ». Les paramètres de l’équipe et la confirmation des rappels désactivés restent dans Paramètres ; les clés API et de webhook restent des Provider Secrets. Les anciens liens cal.eu sont signalés pour revue. Une création dont le résultat est inconnu n’est jamais répétée automatiquement : retrouvez l’événement dans Cal.com puis rattachez son identifiant. La réservation intégrée attend les textes requis et leur préavis.

La fiche Stripe répertorie la clé API, la signature du webhook de facturation et la signature distincte des événements de comptes connectés (`STRIPE_CONNECT_WEBHOOK_SECRET`). Ces signatures se règlent dans Provider Secrets pour leurs points de livraison respectifs ; leur présence ne remplace pas les conditions légales d’activation du coaching.

La signature Connect est une clé complémentaire : son absence ne désactive ni les abonnements existants ni la mention de Stripe dans les destinataires. Les opérations Connect conservent leur contrôle de configuration propre.

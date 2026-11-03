---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Ajouter un site de l'extension ou une source de la recherche d'offres
synonyms: [job site, site de l'extension, badge, motif d'adresse, ajouter un site, job discovery, source, recherche d'offres, site de la recherche, domaine, activer une source, france travail, fantastic.jobs, ats]
---
Les super-admins et « Technique » ajoutent les sites et les sources ; le Support les lit seulement.

Pour qu'un site d'offres affiche le badge « Analyser cette offre » de l'extension (un Job Site) :

1. Ouvrez Paramètres, onglet « Extension ».
2. Sous « Ajouter un site à l'extension », saisissez le « Motif d'adresse » : un motif https, par exemple https://*.exemple.fr/* pour le site et ses sous-domaines. Jamais tous les sites.
3. Si ses pages d'offre ne publient pas de données JobPosting, remplissez « Pages d'offre (facultatif) » avec un motif sur le même site.
4. Cliquez sur « Ajouter le site à l'extension ». Le message « Site ajouté à l'extension. » le confirme ; l'extension le reçoit en quelques minutes à quelques heures.

Pour une source de la recherche d'offres (Job discovery) :

1. Ouvrez Paramètres, onglet « Sources ». Le tableau « Sources de la recherche d'offres » dit, pour chaque source, sa « Disponibilité ».
2. Pour une source désactivée, cliquez sur « Activer … » dans sa colonne « Interrupteur », ou sur « + Ajouter », type « Source », choisissez-la dans « Source à activer » et cliquez sur « Activer la source ».
3. Si sa « Disponibilité » dit « Indisponible : clé manquante (…) », ouvrez la fiche de son fournisseur et saisissez sa clé.

Pour qu'un site soit cherché exprès par la recherche web, ouvrez l'onglet « Recherche web » et, sous « Ajouter un site », saisissez son « Domaine », par exemple apec.fr, puis « Ajouter le site ». Un site qui interdit l'exploration dans ses conditions d'utilisation est refusé : seule l'extension le couvre.

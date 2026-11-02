---
kind: page
audience: administrator
topic: plateforme
title: Email intake (réception par email)
synonyms: [email intake, réception par email, emails reçus, email d'offres, alerte emploi, adresse de transfert, boîte reliée, expéditeur reconnu, expéditeurs proposés, expéditeur non reconnu, plafond atteint, écarté par un garde-fou, mta, transfert]
route: /admin/activite/emails-recus
---
L'Email intake, ou réception par email, transforme en offres les emails d'offres que les candidats transfèrent à leur adresse de transfert : alertes des sites d'emploi, alertes d'un site carrière, message d'un recruteur. Seuls les emails d'un expéditeur reconnu sont lus, par une IA hébergée dans l'UE, une fois passé le garde-fou des emails piégés.

L'onglet « Emails reçus » d'Activité liste chaque email d'offres reçu : « Reçu le », le « Domaine de l'expéditeur », le type (« Alerte », « Recruteur » ou « Autre »), les « Offres nouvelles / déjà là », le verdict du « Garde-fou » et le résultat. Ce résultat peut être « Offres trouvées », « Expéditeur non reconnu », « Écarté par un garde-fou », « Plafond atteint », « Confirmation de transfert », « En attente de lecture », « Autre » ou « Échec ». Filtrez avec « Résultat », « Type » et « Période », puis cliquez sur « Afficher ». Aucun nom, e-mail ni identifiant de candidat ici, et rien de ce que disent les emails.

Les réglages et les listes d'expéditeurs sont dans Paramètres, onglet « Sources », sur la fiche de MTA Jobbbox (Haraka). « Expéditeurs reconnus » liste ceux de la plateforme, reconnus par leur domaine, ou par leur adresse complète quand le domaine envoie pour plusieurs entreprises. Chacun a un libellé ; « Désactiver … » le garde listé sans le lire, « Supprimer … » le retire. « Expéditeurs proposés » liste ceux que des candidats ont ajoutés pour eux seuls : combien de candidats, jamais lesquels. Les accepter les ajoute pour tous.

Les super-admins, Technique et le Support lisent « Emails reçus ». Les super-admins et Technique modifient les expéditeurs ; chaque changement est inscrit dans Actions des administrateurs, section « Expéditeurs reconnus (Réception par email) ».

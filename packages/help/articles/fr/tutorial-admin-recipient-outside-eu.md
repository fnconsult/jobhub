---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Activer un destinataire hors UE
synonyms: [hors ue, destinataire hors ue, transfert, politique de confidentialité, préavis, rgpd, non couvert, résidence, recipient list, sous-traitant, activer un fournisseur]
---
Un outil qui reçoit des données personnelles, ou des requêtes tirées d'elles, hors de l'UE (ou là où ce n'est pas établi) est un destinataire hors UE. En ajouter un change la politique de confidentialité de façon substantielle : sa nouvelle version, et son préavis de 30 jours, passent avant l'activation en production.

1. Dans Outils, repérez l'outil : la colonne « Données traitées » dit « Hors UE » ou « Non établi ».
2. Avant toute activation en production, demandez à l'équipe Jobbbox une nouvelle version de la politique de confidentialité qui le nomme. Le responsable produit la fait relire, fixe sa date d'effet et la publie : les personnes concernées sont prévenues 30 jours à l'avance.
3. Une fois cette version en vigueur, activez l'outil dans Paramètres : saisissez sa clé, rendez-le actif ou activez sa source.
4. Vérifiez qu'aucun avertissement « … : destinataire hors UE non couvert » ne s'affiche.

Paramètres ne bloque jamais l'activation, pour qu'un changement d'urgence reste possible. Activé sans être nommé par la politique en vigueur, l'outil déclenche l'avertissement « Ce destinataire est hors UE et la politique de confidentialité en vigueur ne le couvre pas. », dans Paramètres et sur sa page dans Outils, avec la version de la politique en vigueur. Une ligne « Destinataires hors UE » est écrite dans Actions des administrateurs. La Beta avertit aussi, pour le tester ; seule la production compte pour la liste des destinataires.

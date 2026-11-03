---
kind: faq
audience: administrator
topic: fournisseurs-et-tools
title: Pourquoi un outil est-il « En attente d'accès » ?
synonyms: [en attente d'accès, accès refusé, france travail, api offres d'emploi, la bonne boite, romeo, habilitation, outil indisponible, source indisponible, awaiting access]
---
Un outil est « En attente d'accès » quand sa clé est valide mais que son fournisseur lui refuse une API au dernier test de connexion. Aujourd'hui, c'est le cas de France Travail tant que l'API Offres d'emploi n'est pas ouverte à l'application.

Dans Outils, il affiche « Indisponible : accès refusé par France Travail ». Dans l'onglet « Sources » de Paramètres, la source affiche « En attente d'accès » : les recherches d'offres continuent sans elle, avec les autres sources.

Pour savoir quelle API manque, ouvrez la fiche de France Travail dans l'onglet « Sources » : le tableau « Accès aux API France Travail » donne l'« État » de chaque API (« ok », « accès refusé » ou « erreur ») au dernier test. Demandez l'accès à l'API refusée dans votre espace partenaire France Travail ; une fois accordé, un super-admin clique sur « Tester … » sur la fiche. Le test réussi, l'outil repasse à « Configuré », sans rien d'autre à changer.

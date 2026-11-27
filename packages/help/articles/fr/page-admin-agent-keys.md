---
kind: page
audience: administrator
topic: ia-et-conformite
title: Clés d'agent
synonyms: [clés d'agent, clé d'agent, agent key, jeton d'agent, tri des signalements, triage-beta, triage-prod, agent ia, api, révoquer, échéance, journal des appels, empreinte]
route: /admin/parametres?tab=cles-agent
---
L'onglet « Clés d'agent » de Paramètres, réservé aux super-admins, crée les clés qui laissent un agent IA lire la file des signalements pour les trier. Une clé n'ouvre aucune page du back office, ne vaut pour aucune autre partie de l'API et n'est jamais la session d'un administrateur : ailleurs que dans sa portée, Jobbbox l'ignore et répond comme sans elle, de sorte que les pages publiques et le contrôle de santé de l'application répondent normalement à l'agent. Elle appartient à l'environnement, pas à la personne qui l'a créée.

« Créer une clé » demande un « Nom » (lettres minuscules, chiffres et tirets, par exemple triage-beta), une « Portée » (aujourd'hui « Signalements » seulement) et une « Échéance, en jours » de 90 jours au plus. La valeur de la clé s'affiche une seule fois, juste après sa création : copiez-la tout de suite. Jobbbox n'en garde que l'empreinte et ne peut jamais la réafficher.

La liste montre chaque clé avec sa portée, sa date de création, son échéance, son « Dernier usage » et son « État » (active, révoquée ou échue). « Révoquer » coupe la clé tout de suite : la révocation et l'échéance sont relues à chaque appel. « Journal » montre ses 50 derniers appels dans sa portée : la date, le chemin demandé et le résultat (accepté, ou refusé parce que la clé est révoquée, échue ou a dépassé la limite de débit), jamais le contenu rendu. Un appel hors de sa portée n'y figure pas et ne compte pas comme « Dernier usage ».

Avec la portée « Signalements », l'agent lit seulement les signalements envoyés avec la mention « Un outil d'IA peut lire votre message pour nous aider à le traiter. », anonymisés : le nom, l'e-mail et le téléphone du candidat sont remplacés par « [NOM] », « [E-MAIL] »…, la page sort sans ses identifiants (/candidatures/:id), et jamais l'e-mail, le nom, l'offre ni l'identifiant du candidat. Il ne peut que marquer « Vu » : Signalements affiche alors « vu par triage-beta ».

Chaque clé créée ou révoquée est inscrite dans Actions des administrateurs par son nom, jamais par sa valeur.

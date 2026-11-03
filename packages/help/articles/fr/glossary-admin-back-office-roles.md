---
kind: glossary
audience: administrator
topic: equipe
title: Rôles du back office
synonyms: [rôles, rôle, back office role, droits, permissions, accès, super-admin, responsable des offres, responsable coaching, support, rédacteur de playbooks, rédacteur de l'aide, technique, donner un rôle, retirer un rôle, lecture seule]
---
Un rôle du back office dit ce qu'un administrateur peut voir et changer. Vos rôles s'affichent sur le Dashboard. Ils sont fixés dans le code ; seuls les super-admins les donnent et les retirent, dans Administrateurs (menu Équipe), à une personne qui a déjà un compte Jobbbox.

- **Super-admin** : tout le back office, dont les administrateurs, les clés des fournisseurs, les garde-fous, Activité › Appels IA et Actions des administrateurs.
- **Responsable des offres** : les offres, leurs quotas et les codes promo.
- **Responsable coaching** : les coachs humains ; lit le coût de l'AI Coach.
- **Rédacteur de playbooks** : écrit, évalue, valide et archive les playbooks de coaching, le socle et la liste des sources.
- **Rédacteur de l'aide** : lit les questions sans réponse et les marque « Article écrit » ou les écarte ; lit les questions des signalements, sans l'e-mail ni l'offre du candidat.
- **Technique** : règle les paramètres non secrets, les sources et sites de recherche et les prix des outils. Voit les clés par leur source et leurs 4 derniers caractères, sans les changer. Lit le Dashboard, Consommation IA, les outils, Livraison, Activité › Recherches, Emails reçus et Actions des administrateurs.
- **Support** : traite les signalements et les rétractations ; lit tout le reste sans rien modifier, sauf les secrets des fournisseurs, les appels IA et les actions des administrateurs.

Une section qu'aucun de vos rôles ne lit n'apparaît pas dans le menu. Une section que vous lisez sans pouvoir la changer s'affiche en lecture seule. Un rôle retiré ne donne plus accès dès la page suivante. Il reste toujours au moins un super-admin, et un super-admin permanent (ADMIN_EMAILS) ne se retire pas depuis le back office.

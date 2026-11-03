---
kind: tutorial
audience: administrator
topic: offre
title: Relier une offre à Stripe
synonyms: [relier une offre à stripe, produit stripe, prod_, identifiant de produit, créer une offre, proposer une offre, tarif par défaut, prix, abonnement payant, plan stripe]
---
Une offre payante est vendue par son produit Stripe : le tarif par défaut récurrent de ce produit est celui vendu au paiement, et tous ses tarifs donnent l'offre. Il vous faut le rôle Responsable des offres ou Super-admin.

1. Dans Stripe, créez le produit avec un tarif par défaut récurrent (par jour, semaine, mois ou année), puis copiez l'identifiant du produit, qui commence par « prod_ ». Un identifiant de tarif (« price_… ») ne convient pas.
2. Dans le back office, ouvrez Offres (menu Offre).
3. Pour une nouvelle offre, remplissez la carte « Créer une offre » : la « Clé » (en minuscules, chiffres et tirets ; elle ne change plus), le « Nom en français », le « Nom en anglais », le « Produit Stripe » et ses « Fonctionnalités ». Cliquez sur « Créer l'offre ». Elle est créée masquée, au-dessus des autres, avec les quotas de l'offre juste en dessous.
4. Pour une offre existante sans produit, saisissez l'identifiant dans le champ « Produit Stripe » de sa carte « Modifier l'offre … », puis cliquez sur « Enregistrer l'offre … ».
5. Jobbbox vérifie le produit auprès de Stripe. S'il est refusé, le message en dit la raison : produit inconnu (vérifiez l'identifiant et le mode, test ou production), archivé, sans tarif par défaut récurrent, ou déjà celui d'une autre offre.
6. Réglez les quotas de l'offre dans Quotas.
7. Revenez sur sa carte, cochez « Proposée aux candidats » puis cliquez sur « Enregistrer l'offre … ». Elle apparaît dans la comparaison et au paiement.

Une fois choisi, le produit Stripe ne change plus : ses abonnés restent dessus. Pour les faire changer d'offre, passez par Stripe. Les prix se changent aussi dans Stripe, jamais dans le back office.

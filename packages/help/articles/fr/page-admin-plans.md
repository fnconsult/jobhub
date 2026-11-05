---
kind: page
audience: administrator
topic: offre
title: Offres et codes promo
synonyms: [offres, plans, plan, abonnement, stripe, produit stripe, prix, tarif, offre masquée, rang, fonctionnalités, codes promo, code promo, coupon, réduction, remise, lien à partager, désactiver un code]
route: /admin/offres
---
Les sections Offres et Codes promo (menu Offre) règlent ce que les candidats peuvent acheter.

**Offres** liste les offres dans l'ordre de la comparaison, de la plus basse à la plus haute. Chacune a une clé, un nom en français et en anglais, un statut (« proposée » ou « masquée »), un « Produit Stripe » et ses « Fonctionnalités ». Les prix se règlent dans Stripe : le tarif par défaut du produit est celui vendu au paiement. Les quotas se règlent dans la section Quotas, avec deux limites du contexte du coach par offre (messages lus et taille en jetons, vides = illimité) ; les baisser passe par une réduction de quota. Chaque offre a sa carte « Modifier l'offre … » ; les flèches « Monter l'offre … » et « Descendre l'offre … » changent l'ordre. L'offre Gratuite est intégrée : toujours la première et proposée, sans produit Stripe ; seuls son nom et ses quotas changent. Une offre n'est jamais supprimée. Masquée, elle disparaît de la comparaison, du paiement et des invitations à passer à l'offre supérieure, mais ses abonnés la gardent. Une fois choisi, le produit Stripe d'une offre payante ne change plus. Retirer une fonctionnalité d'une offre que des candidats paient demande une raison et une date d'effet au moins 30 jours plus tard.

**Codes promo** liste les codes que les candidats saisissent au paiement, ou reçoivent par un « Lien à partager ». Chacun montre sa « Réduction », ses « Offres », « Expire le », ses « Utilisations » et son statut. Un code est créé dans Stripe, qui compte ses utilisations, avec des conditions qui ne changent plus. Pour en changer, cliquez sur « Désactiver le code … » puis créez-en un autre avec « Créer un code promo » : les réductions déjà accordées vont à leur terme. Les séances de coaching ne prennent pas de code promo.

Les responsables des offres et les super-admins modifient ces sections ; le Support les lit. Chaque modification est inscrite dans Actions des administrateurs.

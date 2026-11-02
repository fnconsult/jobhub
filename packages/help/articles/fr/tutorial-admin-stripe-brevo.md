---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Configurer Stripe et Brevo
synonyms: [stripe, brevo, paiement, facturation, abonnement, webhook, prix stripe, e-mail, envoi des e-mails, expéditeur, smtp, clé api brevo]
---
Stripe encaisse les paiements ; Brevo envoie les e-mails. Seuls les super-admins saisissent leurs clés.

Pour Stripe :

1. Ouvrez Paramètres, onglet « Paiement », puis la fiche de Stripe.
2. Dans « Clés », remplacez STRIPE_SECRET_KEY, puis STRIPE_WEBHOOK_SECRET, par « Remplacer … » et « Tester et enregistrer … ». Utilisez les clés du même mode, test ou production, que l'environnement.
3. Vérifiez la carte « Fournisseur actif » : STRIPE_PRICE_STANDARD, STRIPE_PRICE_PREMIUM, STRIPE_PRICE_COACHING_SESSION et STRIPE_PRICE_COACHING_SESSION_PREMIUM y sont marqués « Se règle dans l'environnement » : ils ne se changent pas ici.

Pour Brevo :

1. Ouvrez l'onglet « E-mail » : Brevo y a deux fiches, « Brevo (API) » et « Brevo (SMTP) ».
2. Sur la fiche de celui que vous utilisez, remplacez sa clé, BREVO_API_KEY ou SMTP_URL, par « Remplacer … » et « Tester et enregistrer … ».
3. Dans la carte « Fournisseur actif », changez au besoin l'« Expéditeur des e-mails » et cliquez sur « Enregistrer ». L'« Envoi des e-mails » se règle dans l'environnement : avec MAIL_TRANSPORT=console, les e-mails ne partent pas.

Stripe traite les données hors UE, Brevo là où ce n'est pas établi : leur activation suit « Activer un destinataire hors UE ». Les appels et les échecs de l'un et de l'autre se lisent dans Outils.

---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Set up Stripe and Brevo
synonyms: [stripe, brevo, payment, billing, subscription, webhook, stripe price, email, email sending, sender, smtp, brevo api key]
---
Stripe takes the payments; Brevo sends the emails. Only super-admins enter their keys.

For Stripe:

1. Open Settings, « Payment » tab, then Stripe's sheet.
2. Under « Keys », replace STRIPE_SECRET_KEY, then STRIPE_WEBHOOK_SECRET, with « Replace … » and « Test and save … ». Use keys of the same mode, test or live, as the environment.
3. Check the « Active provider » card: STRIPE_PRICE_STANDARD, STRIPE_PRICE_PREMIUM, STRIPE_PRICE_COACHING_SESSION and STRIPE_PRICE_COACHING_SESSION_PREMIUM are marked « Set in the environment » there: they are not changed here.

For Brevo:

1. Open the « Email » tab: Brevo has two sheets there, « Brevo (API) » and « Brevo (SMTP) ».
2. On the sheet of the one you use, replace its key, BREVO_API_KEY or SMTP_URL, with « Replace … » and « Test and save … ».
3. In the « Active provider » card, change the « Email sender » if needed and click « Save ». « Email sending » is set in the environment: with MAIL_TRANSPORT=console, emails are not sent.

Stripe processes data outside the EU, Brevo where that is not established: switching them on follows « Switch on a recipient outside the EU ». The calls and failures of both are read in Tools.

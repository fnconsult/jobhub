---
kind: tutorial
audience: administrator
topic: offre
title: Tie a Plan to Stripe
synonyms: [tie a plan to stripe, stripe product, prod_, product id, create a plan, offer a plan, default price, price, paid subscription, stripe plan]
---
A paid Plan is sold through its Stripe product: that product's recurring default price is the one sold at checkout, and every price of it gives the Plan. You need the Plans manager or Super-admin role.

1. In Stripe, create the product with a recurring default price (each day, week, month or year), then copy the product's ID, which starts with « prod_ ». A price ID (« price_… ») will not do.
2. In the back office, open Plans (Offer menu).
3. For a new Plan, fill in the « Create a Plan » card: the « Key » (lower case letters, digits and dashes; it never changes), the « Name in French », the « Name in English », the « Stripe product » and its « Features ». Click « Create the Plan ». It is created hidden, above the others, with the quotas of the Plan just below.
4. For an existing Plan with no product, enter the ID in the « Stripe product » field of its « Edit the … Plan » card, then click « Save the … Plan ».
5. Jobbbox checks the product with Stripe. If it is refused, the message says why: unknown product (check the ID and the mode, test or live), archived, no recurring default price, or already another Plan's.
6. Set the Plan's quotas in Quotas.
7. Back on its card, tick « Offered to Candidates » and click « Save the … Plan ». It shows in the comparison and at checkout.

Once chosen, the Stripe product no longer changes: its subscribers stay on it. To move them to another Plan, use Stripe. Prices are changed in Stripe too, never in the back office.

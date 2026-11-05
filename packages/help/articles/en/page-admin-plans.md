---
kind: page
audience: administrator
topic: offre
title: Plans and coupons
synonyms: [plans, plan, subscription, stripe, stripe product, price, hidden plan, rank, features, coupons, coupon, promo code, discount, link to share, deactivate a code]
route: /admin/offres
---
The Plans and Coupons sections (Offer menu) set what Candidates can buy.

**Plans** lists the Plans in the comparison's order, from the lowest to the highest. Each has a key, a name in French and in English, a status (« offered » or « hidden »), a « Stripe product » and its « Features ». Prices are set in Stripe: the product's default price is the one sold at checkout. Quotas are set in the Quotas section, with two Coach context limits per Plan (messages read and size in tokens, empty = unlimited); lowering one goes through a quota reduction. Each Plan has its « Edit the … Plan » card; the arrows « Move the … Plan up » and « Move the … Plan down » change the order. The Free Plan is built in: always first and offered, with no Stripe product; only its name and quotas change. A Plan is never deleted. Hidden, it leaves the comparison, checkout and Upgrade Prompts, but its subscribers keep it. Once chosen, a paid Plan's Stripe product no longer changes. Removing a feature from a Plan Candidates pay for takes a reason and an effective date at least 30 days ahead.

**Coupons** lists the codes Candidates type at checkout, or receive through a « Link to share ». Each shows its « Discount », « Plans », « Expires on », « Redemptions » and status. A code is created in Stripe, which counts its redemptions, with terms that no longer change. To change them, click « Deactivate the code … » and create another with « Create a coupon »: discounts already given run their course. Coaching Sessions take no coupon.

Plans managers and super-admins change these sections; Support reads them. Each change is recorded in Administrator actions.

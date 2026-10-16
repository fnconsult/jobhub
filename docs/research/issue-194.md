# Research for issue #194: tying database-defined Plans to Stripe prices

Question (from #194, map #191): how should a Plan we define in our database point at Stripe so the webhook (ADR-0014) maps a subscription to a Plan: price IDs, product IDs or `lookup_key`s? How do monthly and yearly prices, archived prices and price changes behave? What does the current code do, and what would move?

Standing choices from #191 apply: Stripe stays the source of truth for prices, and the Back Office never creates Stripe products or prices.

Stripe sources fetched 2026-10-16. Repo state: `main` at c13d23e.

## Stripe facts

1. **A Price's amount and interval cannot change.** After creation only `metadata`, `nickname`, `active` (plus `lookup_key`, `currency_options` and `tax_behavior` in the API) can be updated. To change an amount, Stripe says to create a new price, switch to the new ID, then deactivate the old one. Sources: https://docs.stripe.com/products-prices/manage-prices ("Modifier un tarif", "Créer un tarif"); https://docs.stripe.com/api/prices/update (the parameter list has no `unit_amount` and no `recurring`).
2. **Archiving a price (`active=false`) does not touch existing subscriptions.** Subscriptions already on it stay active until they are cancelled. The price just cannot be used for new purchases. The same is true for archiving a product. Prices that have been used cannot be deleted. Source: https://docs.stripe.com/products-prices/manage-prices ("Archiver un tarif", "Archiver un produit", "Supprimer un tarif"); `active` is described as "Whether the price can be used for new purchases" at https://docs.stripe.com/api/prices/object.
   - So a Plan can have Candidates on several prices at once: the current one plus any older archived ones. Stripe does not move existing subscribers to a new price for you. That takes a subscription update per subscriber. Source: https://docs.stripe.com/billing/subscriptions/change-price.
3. **One product holds many prices.** Stripe's own example is a single product priced at 10 USD/month, 100 USD/year and 9 EUR one-off. A product has one `default_price`, which must be active. Source: https://docs.stripe.com/products-prices/manage-prices ("Créer un tarif", "Définir un tarif par défaut"); https://docs.stripe.com/api/products/object.
4. **A price always names its product.** `price.product` is a product ID string unless you expand it. Source: https://docs.stripe.com/api/prices/object.
5. **The subscription item in a webhook embeds the whole Price object.** That includes `id`, `product` (an ID), `lookup_key`, `metadata`, `recurring.interval`, `recurring.interval_count` and `active`. So the webhook can map on any of these without an extra API call. Source: https://docs.stripe.com/api/subscription_items/object (example payload and the `price` attribute, "The price the customer is subscribed to").
6. **Lookup keys are mutable pointers to the current price.** A `lookup_key` is a string of up to 200 characters. You can set it on create or update. `transfer_lookup_key=true` "will atomically remove the lookup key from the existing price, and assign it to this price". Stripe's documented use is to show and charge the current price without hard-coding its ID: create the new price with `transfer_lookup_key=true` when the amount changes. You can list by `lookup_keys[]` (up to 10 per call). Sources: https://docs.stripe.com/api/prices/create, https://docs.stripe.com/api/prices/list, https://docs.stripe.com/products-prices/manage-prices ("Clés de recherche").
   - Consequence: after a transfer, a subscriber who is still on the old price has a price with **no** lookup key. A webhook that maps by `lookup_key` would no longer recognise that subscriber.
7. **Customer portal plan switching is configured by product and price ID.** `features.subscription_update.products` lists up to 10 products, each with the price IDs a subscription can switch to. `default_allowed_updates` includes `price` ("Allow switching to a different price"). Monthly to yearly is one such switch. The `schedule_at_period_end` conditions talk about it explicitly ("changing from a yearly to monthly pricing interval"). Source: https://docs.stripe.com/api/customer_portal/configurations/object?query=features.
8. **A price switch arrives as `customer.subscription.updated`.** Stripe lists "le changement de plan" among the triggers. If the interval changes (month to year), the billing date resets to the date of the switch. Sources: https://docs.stripe.com/billing/subscriptions/webhooks (event table); https://docs.stripe.com/billing/subscriptions/change-price ("Périodes de facturation").
9. **Test-mode and live-mode objects are separate.** "Copier en mode production" creates a separate live product, and its later test-mode edits do not carry over. Every ID is therefore different in each mode, and the database for each environment has to store its own mode's IDs. Source: https://docs.stripe.com/products-prices/manage-prices ("Tests").

## What the code does today

All of this is in `apps/web/src/billing/`, as of c13d23e.

- **Plans are a fixed code enum.** `PLANS = ["free", "standard", "premium"]` (`packages/shared/src/domain.ts:26`). `plan_quota.plan` has a SQL `CHECK (plan IN (...))` built from it, and `candidate_plan.plan` references `plan_quota(plan)` (`index.ts:109-118`). `STARTING_PLAN_QUOTAS` seeds the three Plans (`index.ts:92`). The Upgrade Prompt's "next Plan up" walks `PLANS` order (`upgradeFor`, `index.ts:403`).
- **Each Plan is tied to Stripe by exactly one price ID from env.** `STRIPE_PRICE_STANDARD` and `STRIPE_PRICE_PREMIUM` are required in production and must start with `price_` (`config.ts:7`, `requirePriceIds`). They land in `StripeConfig.prices: { standard, premium }` (`index.ts:81`).
- **The webhook maps by equality on `items.data[0].price.id`** (`applySubscription`, `index.ts:356-359`):
  ```ts
  const paidPlan: Plan | undefined = price === prices.standard ? "standard" : price === prices.premium ? "premium" : undefined;
  if (!paidPlan) return; // Not one of our Plans' prices.
  ```
  Any other price is ignored outright. That includes a yearly price, an older price after an amount change, and portal switches to a price not in env. The status, `ends_at`, `charged` and even `customer.subscription.deleted` are all dropped for it.
- **Checkout uses the same single ID** (`line_items: [{ price: stripeConfig.prices[plan] }]`, `index.ts:512`).
- **The displayed price comes from Stripe.** `planPrices()` calls `prices.retrieve` for each configured ID, caches the result, and accepts only `interval_count === 1` with interval day, week, month or year (`index.ts:273-291`, `601-614`). The Free Plan is shown at 0 in the Standard price's currency and interval. Yearly is already a valid `BillingInterval`, but only one interval per Plan can be configured.
- **Coaching Session prices** (`STRIPE_PRICE_COACHING_SESSION[_PREMIUM]`) are one-off prices and not Plans. They are outside this question.

### A hazard in the current mapping (relevant to any migration)

Suppose the Standard amount changes the way Stripe recommends: create a new price, point `STRIPE_PRICE_STANDARD` at it, and archive the old one. Existing subscribers stay on the old price (fact 2). From then on, every event for those subscribers is ignored, including cancellation. Their `candidate_plan` row stays on the paid Plan indefinitely. Monthly to yearly switches through the portal have the same problem. Any database-defined mapping must recognise **every** price a Plan has ever had, not just the current one.

## Options

| Plan points at | Webhook maps by | Checkout needs | Amount change | Monthly + yearly | Old/archived prices |
|---|---|---|---|---|---|
| **A. Price IDs** (a `plan_price` list per Plan) | `price.id` in that list | a chosen price per interval | an Administrator must add the new ID (and keep the old one) | one row per interval | stay mapped only if never removed from the list |
| **B. Product ID** (one Stripe product per Plan) | `price.product` | a current price per interval, resolved from Stripe (fact 3) | no change on our side: the new price is under the same product | automatic | automatic: every price of the product maps |
| **C. Lookup keys** | `price.lookup_key` | `prices.list?lookup_keys[]=` | transfer the key (fact 6) | one key per interval | **lost** after a transfer: old prices have no key |

C is unsafe as the webhook's mapping key, because of fact 6. Lookup keys are still a good way to **pick the checkout price** (option B + lookup keys below).

## Recommendation (input for the spec, not a decision)

Use option B for the mapping and a resolved price for checkout:

1. **Each database Plan stores one Stripe product ID** (`prod_…`), unique across Plans. Free has none. The webhook maps `subscription.items.data[0].price.product` to the Plan row. No extra API call is needed (fact 5). Every price under that product maps automatically: monthly, yearly, current and archived (facts 2, 3). This also fixes the hazard above.
2. **Checkout and the price display resolve "the current price for interval X" from Stripe.** This keeps Stripe the source of truth, and the Back Office never creates prices. There are two workable ways, so pick one in the spec:
   - (a) List the product's active recurring prices (`prices.list?product=…&active=true&type=recurring`) and require exactly one per offered interval. Otherwise the Back Office reports the Plan as misconfigured. Nothing extra to configure in Stripe.
   - (b) Use a lookup-key convention per Plan and interval (for example `<plan-slug>_month`, `<plan-slug>_year`), with the keys moved by `transfer_lookup_key` when an amount changes (fact 6). This is more explicit, but it is a convention someone has to follow in the Stripe Dashboard. It is used only for checkout and display, never for the webhook.
3. **Validate when an Administrator saves the link**, the way `requirePriceIds` does for env today. Retrieve the product, reject a `price_…` pasted where a `prod_…` belongs (the inverse of today's hint), reject an archived product, and show the resolved prices. IDs differ per Stripe mode (fact 9), so each environment's database holds its own mode's IDs.
4. **Customer portal:** its `subscription_update.products` configuration (fact 7) must list the same products and their current prices so that Plan changes in the portal stay within known Plans. Whether we keep the Dashboard-managed default portal configuration or set one through the API is a separate decision (the Back Office does not create prices, but a portal configuration is not a price).

If the spec prefers option A (more explicit, no product-per-Plan rule), it must keep retired price IDs mapped indefinitely. It should also store `interval` per row, so that checkout can tell monthly from yearly.

## What would move

- `PLANS` enum / `Plan` union type (`packages/shared/src/domain.ts`). It becomes database rows, possibly with a stable `slug` and an order column for `upgradeFor`. Callers that switch on literal Plans need review: `apps/web/src/app/abonnement/page.tsx`, `apps/web/src/app/admin/quotas/page.tsx`, `apps/web/src/admin/plan-quotas-form.ts`, `apps/web/src/app/api/billing/checkout/route.ts`, `apps/web/src/job-digests/index.ts`, and the Premium-only Coaching Session discount (`index.ts:525`, `540`).
- `plan_quota.plan CHECK (...)` and `STARTING_PLAN_QUOTAS` seeding (`index.ts:92-165`). The check goes, and the seed becomes the first Plan rows.
- `StripeConfig.prices`, `STRIPE_PRICE_STANDARD`/`STRIPE_PRICE_PREMIUM`, `requirePriceIds` for them (`config.ts`), and `.env.example` lines 122-123. These are replaced by the Plan rows. Coaching Session price env vars are unaffected.
- `applySubscription` mapping (`index.ts:356-359`): from env equality to a database lookup by product (or price).
- `startCheckout` (`index.ts:512`): from `prices[plan]` to the resolved price for the chosen Plan and interval. The checkout UI and route gain an interval choice if yearly is offered.
- `planPrices()` (`index.ts:601-614`): from two fixed IDs to N Plans × offered intervals. `PlanPrice` stays as is, and `BILLING_INTERVALS` already allows `year`.
- `fake-stripe.ts`/tests: the fake would need to serve `price.product` and `prices.list`.
- Existing `candidate_plan` rows keep working if the new Plan rows reuse `standard`/`premium` as keys or slugs. That is part of #191's "Migration and rollout" open item.

## Not verified

- Whether `lookup_key` is unique per account and mode. The transfer semantics imply it, but no page fetched states it outright.
- Whether "Copy to live mode" copies lookup keys and metadata onto the live prices.
- Whether a portal configuration can list a product whose prices include archived ones. The docs only describe `prices` as IDs "which, when subscribed to, a subscription can be updated".
- Behaviour with more than one subscription item. Today's code reads only `items.data[0]`, and nothing in our flows creates multi-item subscriptions.

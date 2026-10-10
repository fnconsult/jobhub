# Human Coaches are identified by email; Coaching Sessions are recorded from the Stripe webhook

A Human Coach signs in with the same passwordless accounts as Candidates (ADR-0011) and is recognised by matching their verified email against the active rows of the `human_coach` table, which Administrators edit in the Back Office. We rejected a role column or a separate account system: coaches are few, and a retired coach loses access by leaving the table, with nobody able to grant themselves access. This answers the "revisit when Human Coaches need accounts" note in ADR-0014. A coach reads only what a Candidate granted through Coach Access, never for a retired coach.

A Coaching Session is paid through a one-off Stripe Checkout with two Stripe Prices, regular and Premium, chosen on the server from the Candidate's Plan. The session is recorded only from the signed webhook (`checkout.session.completed`, or `async_payment_succeeded` for delayed methods), once per Checkout Session even under concurrent deliveries, never on the redirect (same reasoning as ADR-0014). Coaches are paid outside the platform.

Cal.com is only the coach's public booking link, shown once payment is confirmed. We could not confirm a way to tag a Cal.com booking with a paid session, so bookings are not linked back to payments.

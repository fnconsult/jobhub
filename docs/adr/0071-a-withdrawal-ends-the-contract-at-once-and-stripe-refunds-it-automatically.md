# A Withdrawal ends the contract at once, and Stripe refunds it automatically

Status: accepted (#511; product owner's grilling of 2026-10-29). The CGV clauses: « Légal : » #579.

Since 19 June 2026 a contract concluded online must offer a free « Renoncer au contrat ici » function for its whole Withdrawal period (C. conso. L221-21 al. 3, D221-5), and what was paid must be refunded within 14 days (L221-24). « Confirmer la rétractation » does both itself, with no one in the loop. This touches money and the subscription's lifecycle, so it is costly to undo.

- **The contract ends at once.** A Plan's subscription is cancelled in Stripe now (`DELETE /v1/subscriptions/{id}`), never a Scheduled Cancellation at the end of the paid period, with no proration and no final invoice; the Candidate is on Free here at once, without waiting for the webhook. A Coaching Session is cancelled and its Human Coach told.
- **Everything paid is refunded in full, automatically, through Stripe's Refunds API**: each payment taken on the subscription's paid invoices (`amount_paid`, after any Coupon), or the Coaching Session's Checkout payment. A 100 % Coupon left nothing to refund: the Withdrawal is recorded all the same and Stripe is not asked.
- **Each refund attempt has its own idempotency key** (`withdrawal-refund-<refund id>-<attempt>`): a double click on « Confirmer la rétractation » never refunds twice, and a retry is a new refund, never the failed one replayed.
- **A refund can fail later.** Stripe usually reports a failure days after the refund was made, from the bank (`refund.updated`, `refund.failed`), so the signed webhook listens for both. Those events are in `STRIPE_WEBHOOK_EVENTS`, the one list the webhook's handlers are keyed by and the setup instructions read (the Back Office Assistant's guide, `docs/ops/billing.md`). A failed refund, at once or later, shows as « Échoué » in the Back Office's « Rétractations », where Support retries it or refunds by bank transfer.
- **The acknowledgement goes whatever happens to the refund**, by email (Brevo), with the Withdrawal's content, date and time and the amount refunded.
- **The Withdrawal period follows L221-18 and L221-19**: 14 days from the day after the contract was concluded, to the end of the 14th day, French time, run on to the end of the next working day when that day is a Saturday, a Sunday or a public holiday of metropolitan France. #511's criterion « au 15e jour, il ne le voit plus » holds when the 14th day is a working day; otherwise the 15th day is still in the period, as the law requires.
- **The period runs from the subscription's start**: a Plan changed in the customer portal is the same contract and opens no new period (an assumption without a lawyer, to be written in the CGV).

## Considered Options

- **A Scheduled Cancellation at the end of the paid period**: the Candidate would keep a Plan they renounced, and the full refund would pay back days they still use.
- **A refund queue that Support works through by hand in the Stripe Dashboard**: slower than the law's 14 days at busy times, and a manual step on every Withdrawal; set aside at the grilling. Support still acts by hand, but only on a refund Stripe refused.
- **Stripe's customer portal**: it offers cancellation, not a withdrawal with its acknowledgement; the function must be Jobbbox's own page.
- **A prorated refund (L221-25)**: only due when the Candidate expressly asked for the service to start during the period. That request is collected by the page before Checkout, a later issue; until then nothing is owed, and the refund is in full.
- **The 14th day as a hard limit, whatever the weekday**: simpler, but shorter than L221-19 allows on a weekend or a public holiday.

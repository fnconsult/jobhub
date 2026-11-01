# The Order page collects the CGV and the Immediate Performance Request, and a Withdrawal then refunds the prorata

Status: accepted (#512). Completes ADR-0071, whose « prorated refund » option waited for this page. The CGV clauses: « Légal : » #623.

Before Stripe Checkout, a Candidate confirms an Order on Jobbbox's own page (`/abonnement/commande`, `/coachs/commande`), as the Code de la consommation requires for a paid online contract (L221-14, L221-13). This touches money and proof, so it is costly to undo.

- **The server decides, not the form.** While a CGV version is in effect, no Checkout Session is created unless the CGV box names that version. The Immediate Performance Request is optional and never pre-ticked.
- **One Order per Checkout Session**, kept in `checkout_order`; the CGV Acceptance is written with that Checkout Session id and the request, which is the proof that outlives the account (ADR-0073).
- **The Order Confirmation is sent once per paid Checkout, from Stripe's signed webhook**, never from the browser's return. If Brevo fails the webhook answers an error, so Stripe's retry sends it.
- **A Plan bought with the request is refunded the amount paid less the prorata** of whole days elapsed since the start of the period paid for (`withdrawals/prorata.ts`), the day begun not counted, in the Candidate's favour. Without the request, or when Stripe gave no period, the refund is in full.
- **A Coaching Session bought with the request can no longer be withdrawn once held** (L221-28 1°). One bought without it can, held or not, refunded in full, keeping its date. This changes #511, which closed the Withdrawal at the session's date.

## Considered Options

- **No request, a full refund always**: simplest, but the Candidate would have a Plan for 14 days for nothing, and Jobbbox could never rely on L221-25.
- **A pre-ticked request**: refused, the request must be an express act (L221-25).
- **The confirmation sent when the Candidate returns from Stripe**: it would be lost when the browser is closed before the return.
- **Days begun counted as elapsed**: closer to the service used, but against the Candidate on doubt.

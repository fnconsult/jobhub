# The app orders a Coaching Session in the in-app browser and waits for the webhook

Status: accepted (#694)

The Jobbbox app lets a Candidate order a Coaching Session from a Human Coach. Four choices follow, hard to change once the app is in the stores.

- **Stripe Checkout opens with `openBrowserAsync`, not `openAuthSessionAsync`.** The Candidate may pay, cancel or close the browser; no result of the browser is trusted. The return address is the Checkout return (`/coachs/paiement`, `?annule=1` when cancelled), claimed by the app like the sign-in link (ADR-0080) and served as a public web page otherwise.
- **The app treats a return, or the browser closing, as "maybe paid" and waits.** A session counts as recorded only when one appears that was not known before; the page re-reads every 2 s and says « La confirmation tarde » with « Actualiser » after 60 s. Only Stripe's signed webhook records a payment (ADR-0074).
- **The app shows no Plan name, regular price or discount**, only the price the Candidate pays for the session, as in the WebViews (ADR-0084). The Withdrawal is one tap from the session, in a WebView of the web page.
- **The CGV are accepted on the app's own Order screen** through `/api/coaching/order`, which goes through `Orders.place` like the web Order page. The Acceptance is recorded with the origin `mobile` (before, a payment's was always `web`).

Whether a real iOS or Android in-app browser hands the Checkout return to the app is still to be confirmed on devices; if it does not, the Candidate lands on the web page and taps « Revenir dans l'app Jobbbox ».

## Considered Options

- **`openAuthSessionAsync`**: rejected: it resolves on a redirect, which would read as a payment proof it is not.
- **Trusting the return to show "paid"**: rejected: the webhook can come after, or the Candidate can close the browser after paying.
- **Checkout in the system browser**: rejected: leaves the app with no sure way back.

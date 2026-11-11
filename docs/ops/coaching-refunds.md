# Contractual coaching refunds (#883 foundation)

`coaching-refunds` records one full-refund entitlement per original Checkout. Only the trusted cancellation transaction may request one, after checking participant ownership and the contractual refund rule. This foundation exposes no public cancellation-intake endpoint; the reason/deadline/three-choice flow follows in #883. Existing legal Withdrawal remains a separate business process.

The intent freezes the original account, Checkout, amount, currency and known PaymentIntent. A third-party sale missing its account context is quarantined, never guessed to be a platform charge. Every attempt re-reads the Checkout in that frozen account and checks the paid amount/currency/PaymentIntent. Connected-account refunds return the proportional application fee. Prior nonfailed partial/pending refunds count towards the total entitlement, so only the remaining amount is requested.

An advisory lock serializes each entitlement across Workers and Support. The attempt number, amount and start are committed before the remote write, with a stable idempotency key and opaque metadata. Recovery reads refund resources before creating anything, including after Stripe’s idempotency window. An aged unknown outcome or changed outstanding amount is `needs_review`, with no blind second write. A conclusive rejection or terminal failure permits a new numbered attempt through Support retry. A failed earlier partial refund remains visible and Support can complete the outstanding amount. Successful/pending refunds are never duplicated.

The minute Worker reconciles pending entitlements; failed ones await Support. Platform and connected-account refund events re-read the authoritative payment in the correct account. A refund event from another account cannot alter an entitlement. Processor outages retain the debt; they do not change its account or amount. Records survive purchaser erasure with Candidate/session references set to null, allowing the owed refund to finish without retaining an email or private note.

Proposed retention, pending human #890: ten years after full resolution; unresolved accounting stays until reconciliation. Account export includes only owned entitlement and attempt facts, without processor routing or credentials. No legal wording or approval is supplied, and this foundation does not activate the future cancellation policy (#889/#518).

Tests use Stripe’s real SDK against a local HTTP fake, not a real account or money. They cover concurrent workers, partial/pending refunds, lost response and late recovery after account erasure, bank failure, explicit retry, interrupted attempt persistence and wrong-account events.

## Contractual cancellation orchestration (#883)

Jobbbox authenticates Candidate/Coach actions itself. Candidate cancellation and
rescheduling use the original instant with a 24-hour notice, including at DST
transitions. A Coach must provide a reason. Their cancellation offers a full
refund, reopening the same paid service, or an approved Peer at no higher price;
no choice after seven days requests the owed full refund even if new-sale gates
have subsequently closed. A Peer is a different contract: refund first, then an
explicit new Order, rechecking the frozen original price cap before Checkout.
There is no wallet, silent new charge, or reassignment of the original Sale.

Cal event creation sets `disableRescheduling.minutesBefore=1440`. With the
cancellations capability active, event attachment and each private embed read
require that setting from the provider. Cal v6.0.13 validates the original
booking's `minimumRescheduleNotice` in `RegularBookingService` and exempts only an
authenticated organizer; the UI also closes controls at the boundary. A signed
Cal cancellation does not authenticate who requested it. It opens a confirmation
record, preserving the original instant: a late Candidate cannot obtain a refund
by cancelling at Cal. The Coach must confirm a reason in Jobbbox before the
seven-day remedy window starts. Support resolves disagreements; no actor is
inferred from an attendee or `cancelledBy` email. Jobbbox never disables provider
cancellation globally, which would also break its own cancellation outbox.

Private Case reasons/history/notices go with account erasure. Already-owed
refunds are frozen before that cascade and complete from detached financial
routing. Retirement opens remedies for unheld services. Legacy date/cancellation
writers cannot reopen refunded services or bypass pending choices. Same-Coach
reopening invalidates old claims and retains anonymous cancellation-only routing
for late provider descendants. No activation is granted here: current human
CGV, Coach contract and privacy versions must declare `cancellations` coverage.

Cancellation notice recovery checkpoints each recipient and channel independently.
A later recipient/queue failure does not resend a completed email; keyed push
queueing retains its existing deduplication. As with other transactional emails,
a process loss between the provider accepting an email and the local checkpoint
cannot be inferred as a failure or a guaranteed delivery.

Support's contractual-refund list starts from retained financial entitlements,
including debts whose personal Case and account have been erased. It does not
reconstruct deleted contacts or reasons. A privileged retry request is audited
before the numbered financial retry; audit failure performs no retry. Financial
attempts then record the authoritative outcome separately.

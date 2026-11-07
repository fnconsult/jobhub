# Coaching Sessions are booked on Jobbbox's Cal.com team after payment, linked by signed metadata

Status: accepted (map #841; #844, #853)

ADR-0027 let the Candidate or the Human Coach enter a Coaching Session's date by hand, because a Cal.com booking could not be tied to a payment. Research #844 found that it can: metadata passed through Cal.com's embed comes back in the booking webhook's payload. The product owner chose to book through Cal.com and to keep entering by hand as a fallback.

- **One Cal.com team account for Jobbbox (Teams plan)**, each Human Coach with an event type of their own, of a kind team webhooks fire for (Collective or Round Robin with one host). The Human Coach sets availability in Cal.com and connects their own Google, Outlook or iCloud calendar there; Jobbbox shows it and stores none of it.
- **Pay first, then book.** The Coaching Session exists only at Stripe's webhook (ADR-0016); the Candidate then picks a slot in the Cal.com embed on the same flow, with a signed token in the booking's metadata naming the session. The signed team webhook sets the date; a booking without a valid token is ignored. No slot is held during payment. A paid session with no booking stays an Unscheduled Coaching Session.
- **Entering a date by hand stays as a fallback** (Cal.com unavailable, a booking made elsewhere), with the same Reschedule rules.
- **Rescheduling and cancelling**: the Candidate may until 24 hours before, after which the session is due; a Human Coach may at any time, giving a reason, and the Candidate then chooses a refund, another slot with the same coach, or a Peer Human Coach. A Withdrawal also cancels the Cal.com booking, never blocking the refund.
- **Each Human Coach has a time zone (IANA)**; everyone sees times in their own zone, with French time beside it when it differs.
- **Reminders are Jobbbox's**: the Candidate and the Human Coach the day before and one hour before (with « Rejoindre »), the coach's morning summary; Cal.com's own reminders are switched off.

## Considered Options

- **An aggregator (Nylas, Cronofy)**: 15–20 days of work; Cronofy is the only one wholly in the EU, at about 819 $/month.
- **Building availability and calendar sync**: 12–35 days, four integrations.
- **Cal.com per coach, as today**: no link between booking and payment.

## Consequences

- Amends ADR-0027 (date by hand becomes the fallback) and ADR-0028 (times no longer all in French time). ADR-0029 stands: the Candidate still gets a Calendar file, the Human Coach's calendar is synced by Cal.com.
- **Cal.com, Inc. is a new recipient outside the EU** (cal.eu closed on 2026-11-01): a substantial privacy policy version, announced 30 days ahead (ADR-0064, ADR-0072). Cal.com's offer for platforms (coss.com) is assessed before signing.
- The embed needs its entry in the Content Security Policy. Human Coaches' `cal.eu` booking links are reviewed one by one.

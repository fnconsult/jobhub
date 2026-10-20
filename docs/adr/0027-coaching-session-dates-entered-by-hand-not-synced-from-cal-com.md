# Coaching Session dates are entered by hand, not synced from Cal.com

The Agenda needs each Coaching Session's date, but Jobbbox only records a Coaching Session when Stripe confirms its payment (ADR-0016). The time is booked afterwards on the Human Coach's own Cal.com page, and Jobbbox never learns it. We let the Candidate enter that date and time, and let the Human Coach enter or correct it from their Coach space. A paid session without a date is an Unscheduled Coaching Session, shown at the top of the Agenda with the coach's booking link. Each change made after the first hour is kept as a Reschedule, with who made it.

## Considered Options

- **Cal.com webhooks** (BOOKING_CREATED, RESCHEDULED, CANCELLED): every Human Coach owns their Cal.com account, so each one would have to set up a webhook to us. A booking would also have to be matched to a paid session by the attendee's email, which breaks as soon as the Candidate books with another address. ADR-0016 already rejected linking bookings to payments for this reason.
- **A Jobbbox Cal.com team account**: it would give one webhook and real booking ids, but it means moving every coach's calendar under our account. That is too much for a handful of coaches.
- **Booking inside Jobbbox** (our own slots and availability): it would replace Cal.com and would need the coaches' availability. That is a product of its own.

## Consequences

- An Agenda date can be wrong or missing if nobody enters it. The « À planifier » box and the coach's ability to correct it make up for that.
- Revisit this with a team account or an organisation-level Cal.com webhook if the number of Human Coaches grows. Data entered by hand would then become a fallback, and Reschedule history would keep working.

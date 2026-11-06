# Each Coaching Offer has a Seller: Jobbbox, a Human Coach or an Association

Status: accepted (map #841; #849, #851)

Until now Jobbbox sold every Coaching Session at one Coaching Session Price, recorded it from Stripe's webhook, and paid Human Coaches outside the platform (ADR-0016). The product owner wants a case-by-case model: several kinds of offer between the platform, Human Coaches and Associations, flexible while earning money. Who sells decides the law that applies (C. conso. L111-7, the DSA, DAC7, the mediator), so it is costly to change once Candidates have bought.

- **Seller is a property of each Coaching Offer, not of the platform.** A Coaching Offer is sold by Jobbbox (at the price Jobbbox sets: the Coaching Session Price and its Plan Feature discount) or by a Human Coach or an Association (at the price they set), with a Commission for Jobbbox, set per Seller by Administrators.
- **The Order and the Order Confirmation always say « Vendu par »**, with the Seller's identity and, for a third-party Seller, that Jobbbox is the marketplace that collects the payment on their behalf. Without it Jobbbox would lose the hosting exemption (DSA art. 6(3)).
- **A Coaching Offer sold by a third party makes Jobbbox a marketplace operator for that offer**: information duties (L111-7, D111-7), notice and action open to anyone (DSA art. 16, 17), the Seller's own consumer mediator, DAC7 reporting and the information of Sellers on their tax and social duties (CGI 242 bis). A Coaching Offer sold by Jobbbox keeps today's Order, CGV and Withdrawal.
- **Payouts go through Stripe Connect**, monthly, once each payment's Withdrawal period is over; Jobbbox no longer pays Human Coaches outside the platform. The account type (Express or Accounts v2) is chosen at implementation (#848 errata).
- **A Coaching Session is still recorded only from Stripe's signed webhook**, once per Checkout Session (ADR-0016 kept on this point).

## Considered Options

- **Jobbbox sells everything** (#848's first recommendation): simplest in law, but every price set by Jobbbox keeps the risk of C. trav. L7342-1 (a platform that sets the price of the service owes a social responsibility) and leaves no room for Associations or coaches with their own rates.
- **A pure marketplace**: every offer by its coach; rejected, as Jobbbox wants to keep selling its own sessions and its Plan discount.

## Consequences

- Amends ADR-0016 (« Coaches are paid outside the platform »; one price).
- The risk under C. trav. L7342-1 (and, for a Masterclass, vocational training law) is to be reviewed by a lawyer later; the product owner asked it to be weighed from v0. A Seller's own price for its own offers lowers it; Jobbbox's single price keeps it.
- New Legal Text Versions: CGV (third-party Sellers), privacy policy (Stripe Connect, DAC7), the B2B contract (#518) for Human Coaches and Associations.

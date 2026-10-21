# Plan Quotas count per week, from Monday 00:00 in Paris

Plan Quotas that count uses (Match Scores, ATS Scores, Job Searches, Enriched Contacts) now count per week, from Monday 00:00 Europe/Paris, instead of per calendar month (ADR-0014). A week is short enough that a Candidate who runs out is back within days, and the Usage Meter in the Sidebar can show a bar that fills and empties at a pace they feel; it lines up with the weekly Job Digest, sent on Mondays. `quota_usage` keys each count by the Monday its week starts on (`week`, "2026-10-12"), with the same conditional upsert, so concurrent requests still never exceed a limit.

The starting amounts are the monthly ones divided by the weeks of a month (52 / 12) and rounded up: Free 1 Match Score, 1 ATS Score and 1 Job Search a week, Standard 7 Job Searches, Premium 5 Enriched Contacts. The migration does this once, when it renames `month` to `week`, and only to amounts still at their monthly starting value: an amount an Administrator changed, or a Plan they created, keeps its number, now per week, for them to review in the Back Office. Uses counted by the month stay in `quota_usage` under their month ("2026-10") as history, which the week never counts: every Candidate starts the week of the deployment at nothing.

Administrators who may change Plan Quotas can reset the current week's usage of every Candidate (`/admin/quotas`), for instance after an outage used Job Searches for nothing. They must give a reason and confirm; the reset is one Back Office Audit entry (`plan_quotas`, the week, `reset`, with the reason and the number of Candidates). Earlier weeks are never reset.

Stripe is not affected: Plan Prices stay monthly or yearly, and the quota period never followed the billing interval.

## Considered Options

- **Keep counting per calendar month**: a Candidate who runs out early waits up to a month, and a monthly bar barely moves.
- **Keep the monthly amounts, per week**: about 4.3 times more generous on every Plan, which changes what each Plan is worth.
- **Divide every amount, edited ones included**: rejected; an Administrator's choice is not ours to rescale. They see the new unit ("par semaine") next to each amount.
- **Follow each subscription's billing period**: ties quotas to Stripe's cycle, differs between Candidates, and Free has no cycle.
- **A rolling seven days**: no clear moment when the quota renews, which the Upgrade Prompt must be able to name ("chaque lundi").

## Consequences

- `WEEKLY_QUOTAS` replaces `MONTHLY_QUOTAS`, `entitlements().usedThisWeek` replaces `usedThisMonth`, and every text says "par semaine" / "cette semaine"; the Upgrade Prompt says the quota renews every Monday.
- The Candidate data export's `quotaUsage` rows carry `week` (a Monday, or a month for uses counted before this decision).
- The Text Size slider moved to Préférences, which freed the Sidebar's foot for the Usage Meter.

# The Coach context is a per-Plan limit, enforced, and its estimate is checked against the provider's count

Status: accepted (#731 built the limits, their enforcement, Quota Reductions and the estimate against the measure; #732 the Plan cards on Mon abonnement, the upsell and the breakdown card. Jobbbox has no public pricing page yet: the Plans are compared on Mon abonnement only)

The Context bar (ADR-0070) shows « 2 / 40 messages · 4,1k / 12k jetons ». Both ceilings are constants in code (`MAX_MESSAGES`, `COACH_CONTEXT_MAX_TOKENS`, `apps/web/src/coach/conversation.ts`) and the same for every Candidate; the token figure is an estimate (about 4 characters per token) of the system text and the messages sent, kept in `coach_message.context_tokens`. How much the AI Coach remembers is something a Plan can sell, so it moves to the Plans.

- **Two Plan limits, the Coach context.** `coachContextMessages` (messages the AI Coach reads) and `coachContextTokens` (the ceiling of its context in jetons). Each Plan has its own, set by Administrators on the Quotas page of the Back Office, in the same form as the Plan Quotas; a limit left empty is unlimited. They are limits of size, not counters: they have no week and no Usage Meter, and they are not in `LIMITED_QUOTAS` or `WEEKLY_QUOTAS` (ADR-0032). The constants stay as the values a Plan without a stored limit gets (40 and 12 000), so nothing changes until an Administrator edits one.
- **The limits are enforced.** The AI Coach reads the Candidate's latest `coachContextMessages` messages (`recentConversation`, `lastMessages`) and fits everything it is told under `coachContextTokens` (`coachContext`), the Candidate's Plan at the time of the reply. A Candidate who changes Plan gets the new limits on their next message; a Candidate who is downgraded keeps their conversation, of which the AI Coach reads the latest part. The Context bar takes the same limits, so what it shows is what the AI Coach did.
- **Lowering a limit is a Quota Reduction** (#514): it asks the Administrator for a reason and an effective date, and tells the Candidates of the Plan, as lowering a Plan Quota does.
- **The Plans show them.** « Mon abonnement » and the public pricing page list, with the Plan Quotas, « Mémoire du coach » (messages) of each Plan and its context size as a multiple of the lowest offered Plan's (`CARD_QUOTAS` in `billing/plan-cards.ts`), in both Interface Languages. Never in jetons there: the rule of #332 (« Plan Quotas never count tokens », `billing/no-token-count.test.ts`) holds; jetons show only in the Context bar and its breakdown.
- **The Context bar upsells.** From 80 % it says the AI Coach reads only the latest messages and offers « Effacer la conversation », and, when a higher offered Plan allows more, names that Plan as an Upgrade Prompt does. On the highest Plan, or when the limit is unlimited, it offers no upgrade.
- **A breakdown for the Candidate.** The Context bar opens onto a card in the manner of an agent harness's context view: Messages, Instructions du coach (persona, rules, Playbook digest), Profil et CV, Conseils des agents, Sources and Espace libre, out of the Plan's ceiling. The split is estimated, per reply, and kept with it.
- **Estimate and measure side by side.** The estimate stays what the Candidate sees and what fits the context, but the provider's input and output tokens, already kept per call in `ai_usage` and joined to each reply in the AI Message Log, are read beside it; the split by category stays an estimate, kept with the reply. Nothing is copied. The AI Activity table of the Back Office gets one more column, the estimate against the measure, so an Administrator can compare them by provider and model and correct the estimate (the 4-characters ratio, per Interface Language) in code where it drifts. Nothing in the Candidate's view waits for it.

## Considered Options

- **Keep the constants, show them on the Plans**: the page would promise what no Administrator can change, and a Plan could not be told apart by it.
- **Make them Plan Quotas (weekly counters)**: the AI Coach's memory is not consumed by use; a counter would reset it each Monday and mean nothing to read.
- **A Platform Setting with an env fallback (ADR-0024)**: one value for the whole platform, when the point is to differ by Plan.
- **Display the limits only**: a Plan would advertise a number the AI Coach ignores.
- **Replace the estimate with the provider's count**: the count only exists after the call, so the context could not be fitted under the ceiling before it; and a Candidate's bar would depend on a provider's tokenizer.
- **Count the provider's tokens on every reply for the bar, with no estimate kept**: loses the comparison that lets the estimate be corrected.

## Consequences

- A Plan limit store beside `plan_quota` (columns or a table), read where `entitlements()` is; the Quotas page and `plan-quotas-form.ts` gain two fields; the Candidate data export lists them with the Plan.
- `contextBar()` and the AI Coach's conversation window take limits as arguments instead of constants; the tests that pin 40 and 12 000 become the Free Plan's.
- `coach_message` keeps the category split; the provider's counts stay in `ai_usage` (the reply needs a link to its call if it has none). The Candidate data export leaves out neither (they name no one).
- CONTEXT.md: **Context bar** now reads « out of the Plan's limits »; two new terms, **Coach context limits** and the estimate against the measure.
- Help Articles on plans and quotas (FR and EN) mention the two lines.
- Tickets to open: the Plan limits and the Quotas page; the Plan cards and pricing page; enforcement and the Context bar's upsell; the breakdown card; the provider's counts and the AI Activity column.

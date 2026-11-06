# « Votre consommation » counts uses per Tool over the billing period, from a per-Candidate daily count

Status: accepted (decided with the product owner on 2026-11-05 from a prototype; to be built by #799 (the count), #800 (backfill) and #801 (the section); legal: #802)

The product owner asked that Mon compte › Abonnement show the Candidate's overall consumption with its details. Three earlier decisions frame it. First, #332 and `billing/no-token-count.test.ts` keep « jetons/tokens » off `/abonnement`, the Plans, the Usage Meter and Upgrade Prompts; jetons appear only in the Context bar and its breakdown card (ADR-0078). Second, the Coach Message Cost keeps euros for Administrators. Third, AI Usage names no one (ADR-0007, ADR-0034), so it cannot say what one Candidate used.

- **Unit: uses and AI actions, never jetons or euros.** #332 stands and is not amended: its test also covers the new section. One AI action is one result the Candidate asked for: an AI Coach reply (whatever its Tool rounds), a Job Search, a Match Score, a Tailored CV, and so on. Tokens stay a technical measure in AI Activity and the Context bar. Euros stay with Administrators, because on a flat-price Plan they would read as a bill.
- **Period: the billing period.** On a paid Plan, it runs from the Stripe subscription's current period start to its end. On Free, which is never billed, it is the calendar month in French time. Plan Quotas still count per week (ADR-0032): the Usage Meter and « Votre utilisation cette semaine » are unchanged, and each Tool line with a weekly Plan Quota repeats this week's use beside its period count.
- **Detail: per Tool and over time, not per model.** The section lists each Tool's count and share for the period. Under it is a 12-month grid, GitHub-style, one cell per day with the current billing period outlined, and a switch to a stacked bar chart of the period day by day. Models, providers and routes (EU AI Consent, outside the EU) stay in AI Activity, per page, where the content they produced is.
- **Source: a per-Candidate daily count, `consumption_day`** (Candidate, day in French time, Tool key, count). It is incremented in the same transaction that saves the result or records the Plan Quota use, and given back with it. It holds no content, model, provider, tokens or euros, and has no link to a result or to AI Usage. It is kept 12 rolling months, deleted with the account, and in the Data export. A one-off backfill rebuilds the last 12 months from the results still stored, as a best effort: what was deleted cannot be counted.
- **Variant A of the prototype** (https://claude.ai/artifact/GAm77L1ue1P7wPf21bgXnJ): the headline of AI actions with the change against the same day of the previous period, the period's progress, the list per Tool (its four smallest grouped under « Autres »), and the grid opening by default.

## Considered Options

- **Show jetons per Tool and model (reverse #332)**: Candidates would read tokens as what they pay for, while no Plan sells tokens.
- **Show euros**: reverses the Coach Message Cost rule; list prices change and a flat-price Candidate does not pay per use.
- **The current week as the period**: matches the Plan Quotas, but the product owner wants it read against what they pay, which is per billing period.
- **Link AI Usage to the Candidate**: reverses ADR-0007 and ADR-0034 and the register's « aggregates of no one »; AI Usage also counts per Tool round, not per action.
- **Sum the Provenance stored on results**: no new data, but history shrinks whenever an Application or a conversation is deleted. Old rows have no Provenance.
- **Variants B (six periods compared) and C (a table)**: B makes the current period hard to read against the Plan; C works on a phone but shows no shape over time.

## Consequences

- A new processing: an entry in `docs/privacy/register.md` (#799) and a privacy policy clause (#802). It has no new recipient.
- Each feature that saves a result counts it once (`CONSUMPTION_TOOLS` in `@jobhub/shared`); a test lists the call sites so a new feature cannot forget to count.
- Four more chart series tokens (`chart3`…`chart6`, light and dark), validated for colour-vision deficiency.
- CONTEXT.md: a new term, **Consumption**; **Data export** lists it.

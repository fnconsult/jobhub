---
kind: page
audience: administrator
topic: plateforme
title: Dashboard and AI consumption
synonyms: [dashboard, ai consumption, ai usage, cost, costs, spend, budget, alert threshold, web search, tokens, ai calls, failures, failure rate, unknown price, provider, model, task, period, run, origin, extension, app, web, background jobs, unknown, extension card, captures, guests, active candidates, versions in service, pages that cannot be captured]
route: /admin/consommation-ia
---
The Dashboard is the back office's first page. It shows what the platform consumes, how Job discovery is doing and what the extension does. Each block shows only to the roles that read its section: with none, the page shows « No figures for your roles: the sidebar leads to your sections. »

The « Job discovery: consumption and budget » block gives, for the current month, the « Web search spend this month » against the alert threshold, the « Average cost of a run » against the « Budget per run », the « Cost per new Job Offer », the « Runs », the « Runs that fell back » (to the fallback provider) and the « Failed AI calls ». Its charts show the daily spend per Search provider, « Month to date against the alert threshold » with the month-end estimate, « Why runs stop » and « Where a run's cost goes (average) ». « Table view » gives the same figures as tables. « Every detail in AI consumption » opens the next page.

The « Extension » block covers the last 30 days: the « Captures » (by candidates and by guests), the « Match Scores » asked from the extension, the « Applications created » from the extension, the « Active candidates » (each counted once) and the « Errors » it reports. Its charts show « Captures per day, candidates and guests », « Errors per day », the « Versions in service » with their number of events (« Not stated » for an extension that does not send its version) and « Pages that cannot be captured: the top 5 domains ». The captures' « Table view » gives, day by day, the captures, Match Scores, applications, active candidates, versions and errors. A guest is never counted as a person there: only their actions are. « See Activity › Extension » lists each event. Super-admins, Technique and Support see this block.

AI consumption (Platform menu) counts every AI call, all tasks included, the tools the models use and the calls to external APIs (France Travail, contact enrichment, Stripe, Brevo, sign-in…). Choose the « Period » (« Last 7 days », « Last 30 days », « Last 90 days » or « Last 12 months, per month ») and, if need be, the « Origin » of the AI calls (« Web », « Extension », « App », « Background jobs », or « Unknown » for those recorded with none, all the earlier ones included), then click « Show ». The origin restricts the AI calls and their tools; external APIs record none and are all still counted. The page then details the « Totals », « By provider, endpoint and model », « By task », « Per day » or « Per month », the « Tools » and the « External APIs ».

« Failures and warnings per reason » counts the failed and warned calls per Failure Reason: the code and its wording only, never the technical reason. To read one call, a super-admin goes to Activity › AI calls.

Costs are estimates at the providers' list prices, in dollars converted to euros, fixed when each call was made. A tool with no known price counts as 0 and shows « unknown price ». These are aggregates: no Candidate, no text. When web search reaches its monthly alert threshold, a banner says so and super-admins are emailed; nothing is cut. The threshold and the prices are set in Paramètres.

Super-admins, Technique and Support read both pages; no one changes anything there.

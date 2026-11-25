---
kind: glossary
audience: administrator
topic: fournisseurs-et-tools
title: Quota reached
synonyms: [quota reached, quota used up, rate limit reached, quota, credit used up, plan used up, rate limit, 429, billing, renew the quota, banner, email, alert]
---
A tool has its **quota reached** when its provider refuses to serve it because of a quota. Only the API tools that have one are concerned: the AI models, web search, contact enrichment and Fantastic.jobs. There are two states:

- **« rate limit reached »**: the provider limits the rate (too many calls in a short time, HTTP 429);
- **« quota used up »**: the credit or the plan paid for at the provider is used up.

Each state starts at the provider's first refusal and lasts as long as it refuses: it ends at that tool's first accepted call, or at the renewal date the provider gave. A connection test that passes is not enough: it checks the key, not the quota.

While at least one tool has its quota reached, the « Quota reached » banner shows at the head of every Back Office page, for every Administrator, whatever their role. It goes away by itself within half a minute once the state is back to normal. Each line names the tool, its state and since when.

The first quota reached in the day (Paris time) also sends an email to every Administrator, whatever their role, in their language: it lists the tools whose quota is still reached, with the same two links. At most one goes out a day: another tool reached the same day is in the next day's email if it still is. No email goes out when a quota is available again.

To fix it, each line gives two links:

- « … billing » opens, in a new tab, the provider's page where the quota is paid for or renewed;
- « Configure … » leads to where the tool is set up in the Back Office: its sheet in Settings when its key is entered there, otherwise its page in Tools. This link only shows to the roles that may open those pages (super-admin, Technique and Support).

The page « … billing » opens is set in the tool's settings, on its sheet in Settings, « Billing » section: the catalog's by default, an https URL only, and « Restore » goes back to it. The banner, the Dashboard's « API » block and the email follow the value entered.

A Perplexity HTTP 401 « insufficient_quota » refusal counts as « quota used up », for a search as for a connection test, and so does Claude's monthly spend cap.

A « rate limit reached » often lifts by itself after a few moments. A « quota used up » calls for topping up the account or changing plan at the provider or, meanwhile, choosing another provider in Settings.

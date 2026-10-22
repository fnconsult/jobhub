# Platform Settings are set in the Back Office, over env, over the code's default

ADR-0020 moved third-party keys into the Back Office (Clés) and left non-secret configuration in env: models, regions, `MAIL_FROM`, the Job Digest's thresholds, the Job discovery budget, the contact-enrichment provider. Those values were invisible from the Back Office, so an old `.env` could quietly misconfigure an environment: staging kept `MAIL_TRANSPORT=console` and `ANTHROPIC_ENDPOINT=bedrock` long after the code's defaults had moved on, and nobody could see it without a shell on the host. We want staging and production to run on the code's defaults and on what Administrators set, not on a file.

Super-admins now set these **Platform Settings** in a new Back Office section, Paramètres, under Plateforme. A value set there wins over the environment variable of the same name, which wins over the code's default; « Rétablir » clears the Back Office's value. This amends ADR-0020's "non-secret configuration stays in env" for the settings below; the bootstrap secrets stay in env.

What is a Platform Setting (editable):
- AI routing (ADR-0007): `ANTHROPIC_ENDPOINT`, `BEDROCK_REGION`, `VERTEX_REGION`, `VERTEX_PROJECT_ID`, `OPENAI_DATA_RESIDENCY`, `AI_<TASK>_PROVIDER` / `AI_<TASK>_MODEL` (web search included), `AI_IDENTITY_MODEL`.
- Email: `MAIL_FROM`.
- Job Digest and Job discovery: `JOB_DIGEST_MIN_MATCH_SCORE`, `JOB_DIGEST_TARGET_COUNT`, `JOB_DIGEST_FIRST_LOOK_BACK_DAYS`, `JOB_DISCOVERY_BUDGET_JOB_OFFERS`, `JOB_DISCOVERY_BUDGET_EUR`, `JOB_DISCOVERY_BUDGET_SECONDS`.
- Enriched Contacts (ADR-0015): `CONTACT_ENRICHMENT_PROVIDER`, `CONTACT_ENRICHMENT_DPA_SIGNED`.
- `EXTENSION_STORE_URL`.

Shown on Paramètres, read-only:
- `MAIL_TRANSPORT`, with a warning when it is `console` outside e2e; `STRIPE_PRICE_STANDARD` / `STRIPE_PRICE_PREMIUM` (fallbacks on their way out, #206), and the Coaching Session Prices.
- The bootstrap settings only env holds: `DATABASE_URL` without its password, `AUTH_SECRET` and `SECRETS_MASTER_KEYS` only as set or missing (and the master keys' versions), `APP_URL`, `ADMIN_EMAILS`, `JOBHUB_TARGET`, `AI_FAKE`.
- Settings with a section of their own (Plan Quotas, Guardrails, Coach Message Cost, Provider Secrets), linked there.

Each row shows the effective value, its source (Back Office, env, code default) and the code default, and flags a value from env that differs from the default: that is how the staging case above shows up.

How the apps use it:
- A `platform_setting` table (name, value, Administrator's email, date), read by one resolver shared by the web app and the worker, built like the Provider Secrets' one: a cache, `NOTIFY platform_settings_changed` on every change, and the clients that captured a setting (the AI layer, the mailers, Enriched Contacts, the worker's Job Digest and Job discovery) rebuilt when one of theirs changes. A change takes effect within seconds, without a restart. Each environment has its own database, so its own values; there is no export or import between them.
- The code that parses env parses the Back Office's value too: one type per setting (an allowed list, a bounded number, text). An AI route the AI layer would refuse to build (an endpoint outside the EU for a task with personal data, a key missing) is refused on save, with no "save anyway". A model is picked from the provider's known models or typed, and tested on save with its cheapest call; a failed test blocks the save.
- Values are not secret: the Back Office Audit records them before and after ("changed", "restored to default"), and a refused save with its Failure Reason.
- A new Back Office resource, `platformSettings`: super-admins read and write, Support reads.
- Outils shows on each Tool's page the Platform Settings it depends on, read-only, linked to Paramètres, and its state accounts for them (a setting missing, off when the contact-enrichment DPA is not signed). Paramètres is the only place to change one.

## Considered Options

- **Keep non-secret configuration in env (ADR-0020 as it was)**: changing a model or a threshold needs a deployment, and what env holds stays invisible from the Back Office: the cause of the staging misconfiguration.
- **A read-only page of the effective configuration only**: shows the problem but leaves the fix to whoever can edit the host's `.env`.
- **Back Office over the code's default, env ignored**: simplest to reason about, but breaks local development and e2e, which configure through env.
- **Edit each setting on its Tool's page**: spreads one kind of change over many forms; AI tasks and the Job Digest belong to no single Tool.
- **Treat them as Provider Secrets**: write-only values for things that are not secret would hide exactly what we want to see.

## Consequences

- `.env.example` and `docs/ops` say which variables are now Platform Settings, and that a Back Office value wins.
- The settings are cut into slices that ship one at a time: the read-only page first, then editing for the worker's settings, `MAIL_FROM`, AI routing, Enriched Contacts, `EXTENSION_STORE_URL`, and the Tools' view.

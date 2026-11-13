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
- The store review's sign-in code (#981): `REVIEW_SIGN_IN` and `REVIEW_SIGN_IN_EMAILS`, and `REVIEW_SIGN_IN_CODE` only as set or missing. A secret and a switch for the duration of a store review, kept in env so no Administrator can turn on a fixed sign-in code from the Back Office.
- `EXTENSION_ORIGINS`, with whether the test zip's origin is trusted and why (see the amendment of 2026-11-13 below). Never editable from the Back Office.
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
- A production build needs `MAIL_FROM` in env or on Paramètres; the code's default (`bonjour@localhost`) is used only outside production.
- The settings are cut into slices that ship one at a time: the read-only page first, then editing for the worker's settings, `MAIL_FROM`, AI routing, Enriched Contacts, `EXTENSION_STORE_URL`, and the Tools' view.
- Enriched Contacts (#302): the DPA flag is checked first, so the feature is off with the DPA unsigned whatever the provider and key; a missing key with the DPA signed turns it off (reason `no_key`) instead of throwing, which refines ADR-0015's "off unless provider, key and DPA". `CONTACT_ENRICHMENT_PROVIDER=none` lets the Back Office turn it off over env. Marking the DPA signed on Paramètres, or « Rétablir » falling back to an env `true`, needs an explicit confirmation enforced on the server: a setting can declare a value that asks for it.

## Amendment (2026-11-13): the test zip's origin is trusted outside Production, opt-in in Production

`EXTENSION_ORIGINS` lists the `chrome-extension://<id>` origins the web app trusts to act with a Candidate's session: Better Auth's `trustedOrigins`, hence `isFromTrustedOrigin` on every state-changing route (Captures on `/api/job-offers`, Extension Events on `/api/extension/events`, and the rest). Since #1024 the zip Outils serves Administrators carries a fixed id, `ebaaajbdddeihlmmdcahpembpofcmbml`, from a public key in `packages/shared/src/extension-test-build.ts`. Each environment still had to list its origin in its `.env`; the Beta did not, and every Capture and error report from the test zip was refused (403) on 2026-11-13.

Decision (product owner, options A and B):
- **Outside Production, the test zip's origin is trusted automatically**, beside what `EXTENSION_ORIGINS` lists. Production is told apart as everywhere else (ADR-0021, ADR-0063): `JOBHUB_TARGET=production`, or a production build that names no target. One function, `extensionOriginsFromEnv` (`apps/web/src/auth/extension-origins.ts`), builds the trusted list every reader goes through; `testBuildTrust` says why the test origin is trusted or not: « listed », « automatic » (outside Production), « not_recognised » (Production, not listed).
- **In Production nothing changes**: only what `EXTENSION_ORIGINS` lists, the store listing's id, plus the test id only when an operator lists it on purpose.
- **`EXTENSION_ORIGINS` is shown read-only on Paramètres › Environnement** with that status, and Outils' test-build block says the same and links there. It stays env-only, never editable in the Back Office: it decides which extensions act with a session.

Security. The test key is public: anyone can build an extension with id `ebaaajbdddeihlmmdcahpembpofcmbml` and get it installed. A trusted extension origin lets that extension make credentialed, state-changing calls with the session of the Candidate whose browser runs it (the origin check is what keeps another site's requests out; an installed extension already holds its host permission on the web app). Outside Production that is acceptable: the Beta holds test accounts and is meant for testing builds; the risk is a Beta account acted on by a malicious extension its owner installed. In Production it would let any such extension act as a Candidate's own, so it stays opt-in, and an operator who lists it for a test removes it afterwards. A deployment that forgets to name its target is held to Production's rule, so a misconfiguration never widens trust.

Considered: listing the test origin in every environment's `.env` (the #1024 state: a manual step each environment forgets, the regression itself); trusting it everywhere (Production exposed to any extension built with a public key); editing `EXTENSION_ORIGINS` in the Back Office (an Administrator, or a stolen Administrator session, could widen who acts with Candidates' sessions without a deployment).


# Research for issue #197: encrypting Provider Secrets at rest on our EU hosting

Map: #191 (area 3, third-party provider keys entered by Administrators in the Back Office). Blocks #198.

Question: how to store third-party keys encrypted in Postgres. The two options are envelope encryption under a master key from env (Node `crypto`, AES-256-GCM) and an EU-hosted KMS from our hosting provider. Also covered: key rotation, re-encryption, how web and worker pick up changes, and leak paths (logs, exports, error reports).

Sources were fetched on 2026-10-16. They are Node.js docs, AWS docs, NIST, and this repository at `origin/main` `c13d23e`. No secret values appear in this file. The `.env.example` keys are listed by name only.

## 1. Where we host, and how keys are read today

### Hosting

- ADR-0007 requires all data to be stored in the EU but names no host. The host is recorded in `docs/ops/hosting.md`: **AWS eu-west-3 (Paris)**. The web app and the worker run as ECS Fargate containers, the database is RDS for PostgreSQL 17 ("encrypted, automated backups"), and logs go to CloudWatch.
- `docs/ops/hosting.md`, "Staying portable": "no AWS-specific code in the apps". A move to Scaleway fr-par or OVHcloud means re-creating two containers and a database.
- `.env.example` says: "In production these come from AWS Secrets Manager, injected as environment variables by ECS."
- So "our hosting provider's KMS" means **AWS KMS in eu-west-3**.
- CI (`.github/workflows/ci.yml`) only runs lint, typecheck, tests, build, migrations and e2e against a Postgres service. It has no deploy job and no secrets.
- `docker-compose.yml` passes the repo-root `.env` to the worker through `env_file`.

### How web and worker read config (this matters for rotation)

- **Web** (`apps/web/src/*/server.ts`): each module builds a singleton from `process.env` on first use and keeps it for the life of the process. Examples:
  - `getAi()`: `instance ??= createAiLayerFromEnv(process.env, …)` in `apps/web/src/ai/server.ts`
  - `getBilling()` in `billing/server.ts`
  - `getEnrichedContacts()` in `enriched-contacts/server.ts`
  - `createAuth(authConfigFromEnv(process.env))` in `auth/server.ts`
- **Worker** (`apps/worker/src/main.ts`): reads everything once at start-up (`createAiLayerFromEnv`, `franceTravailFromEnv`, `mailerFromEnv`, …) and wires long-lived objects.
- **AI layer** (`packages/ai/src/env.ts`): `buildProvider` passes the key string into each provider when it is constructed (`createMistralProvider({ apiKey: required(env, "MISTRAL_API_KEY") })`, and so on). The key then lives inside the provider closure. A changed key therefore takes effect only if the layer is rebuilt or the providers take a key getter.
- **Next.js bundling**: Next bundles server code into several chunks, and each chunk has its own copy of a module (see the comment in `apps/web/src/database/pool.ts`, which puts the pool on `globalThis` for this reason). A secrets cache in a module variable would therefore exist several times in one process, and an invalidation would reach only one copy. The cache has to live on `globalThis`, like the pool.
- **What ECS does today** (AWS, [ECS: pass Secrets Manager secrets through environment variables](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)): secrets are "injected into your container when the container is initially started. If the secret is subsequently updated or rotated, the container will not receive the updated value automatically". Rotating a key today therefore means a forced new deployment. The same page warns that "container logs and debugging tools have access to the environment variables."

### Every third-party key the app reads from env today

Credentials only. Model and provider selectors, `*_API_URL` test overrides and Stripe Price IDs are not secrets and are left out. "Bootstrap" marks the secrets that #191 keeps in env.

| Variable | Provider | Read in | Read by |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic direct (only when `ANTHROPIC_ENDPOINT=direct`) | `packages/ai/src/env.ts` | web + worker |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock API key (optional; otherwise the ECS task role) | `packages/ai/src/env.ts` | web + worker |
| `VERTEX_PROJECT_ID` | Vertex AI (an identifier, not a secret; auth is Google application default credentials) | `packages/ai/src/env.ts` | web + worker |
| `MISTRAL_API_KEY` | Mistral (also the EU AI consent identity route) | `packages/ai/src/env.ts` | web + worker |
| `OPENAI_API_KEY` | OpenAI | `packages/ai/src/env.ts` | web + worker |
| `PERPLEXITY_API_KEY` | Perplexity web search | `packages/ai/src/env.ts` | web + worker |
| `BRAVE_SEARCH_API_KEY` | Brave Search | `packages/ai/src/env.ts` | web + worker |
| `TAVILY_API_KEY` | Tavily | `packages/ai/src/env.ts` | web + worker |
| `LINKUP_API_KEY` | Linkup | `packages/ai/src/env.ts` | web + worker |
| `STRIPE_SECRET_KEY` | Stripe | `apps/web/src/billing/config.ts` | web (the worker's `createBilling` gets no Stripe config) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing | `apps/web/src/billing/config.ts` | web |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth sign-in (Better Auth) | `apps/web/src/auth/config.ts` | web |
| `FRANCE_TRAVAIL_CLIENT_ID` / `FRANCE_TRAVAIL_CLIENT_SECRET` | France Travail Offres d'emploi API | `apps/worker/src/job-discovery/france-travail/index.ts` | worker |
| `LUSHA_API_KEY` / `KASPR_API_KEY` / `APOLLO_API_KEY` | Enriched Contacts providers | `apps/web/src/enriched-contacts/config.ts` | web |
| `SMTP_URL` | SMTP relay (SES); the URL embeds credentials | `apps/web/src/auth/mailers.ts` (`mailerFromEnv`) | web + worker |
| `AUTH_SECRET` | Bootstrap: Better Auth session signing | `apps/web/src/auth/config.ts` | web |
| `DATABASE_URL` | Bootstrap: Postgres credentials | many | web + worker |

Notes:
- `ADMIN_EMAILS` is not a secret. It is a bootstrap access list (#191 keeps a bootstrap super-admin in env).
- Moving the Google OAuth client into the database overlaps with area 4 (SSO) of #191.
- `STRIPE_WEBHOOK_SECRET` and `AUTH_SECRET` verify inbound data. Rotating them needs an overlap window (accept old and new), not just a swap.

## 2. The two options

### Option A: envelope encryption under an env master key (Node `crypto`, AES-256-GCM)

This is the construction AWS describes as envelope encryption ([KMS cryptography essentials](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html)): data is encrypted with a data key, and the data key is encrypted under a root key. Here the root key, also called the key-encryption key (KEK), is a 32-byte value in env (for example `PROVIDER_SECRETS_MASTER_KEY`). In production it would be injected from Secrets Manager like the other bootstrap secrets. #191 already decided that "master encryption key stays in env".

Rules from the Node docs ([crypto, Node 22](https://nodejs.org/docs/latest-v22.x/api/crypto.html); the repo's `.nvmrc` is 22):
- IVs: "Initialization vectors should be unpredictable and unique; ideally, they will be cryptographically random." They "do not have to be secret" and can be stored next to the ciphertext. Use `crypto.randomBytes(12)` per encryption (a 96-bit IV is the NIST-recommended length for GCM).
- Tag: in GCM, `authTagLength` "defaults to 16 bytes". `cipher.getAuthTag()` must be called "after encryption has been completed using the `cipher.final()` method". On decrypt, `setAuthTag()` must be called before `final()`. If the tag is missing or wrong, "`decipher.final()` will throw". Node 22 deprecates GCM tags other than 128 bits unless `authTagLength` is set, so pass `authTagLength: 16` explicitly on both sides.
- `decipher.update()` output is not authenticated until `final()` succeeds ("authenticity is generally only established when the application calls `decipher.final()`"). Never use a partial plaintext.
- AAD: `setAAD()` "must be called before `cipher.update()`". Bind the ciphertext to its row so a value cannot be swapped onto another row in the database: AAD = `provider_id|secret_name|row_id|key_version`.
- Prefer `crypto.createSecretKey()` and `KeyObject` over raw Buffers: "Most applications should consider using the new `KeyObject` API instead of passing keys as strings or `Buffer`s due to improved security features."
- Per-key limit: NIST SP 800-38D §8.3 caps random-IV GCM at 2^32 encryptions per key. I could not re-read the PDF here (no PDF text tool in this environment), so this is cited from the standard, not quoted. With one write per Administrator edit, we will never get near the cap. A per-row data key, which is full envelope encryption, is optional at our volume. A single KEK used directly with a random IV per row is enough. A per-row data key mainly makes KEK rotation cheaper, and with about 20 rows that saving does not matter.

Suggested row shape: `provider_secret(id, provider, name, ciphertext, iv, tag, key_version, fingerprint, updated_by, updated_at)`. `fingerprint` holds the last 4 characters or a short HMAC, for display only, and the plaintext is never stored.

Pros:
- No new dependency and no new AWS-specific code, which keeps the "Staying portable" rule in `docs/ops/hosting.md`.
- Works the same in local dev, CI and e2e.
- No network call on the read path.
- Matches the #191 standing choice.

Cons:
- The KEK sits in process env, readable by anything in the container and by anything that dumps env (ECS doc, above).
- There is no per-decrypt audit trail.
- Compromising the container plus the database exposes everything, but that is also true today with plain env keys.

### Option B: AWS KMS in eu-west-3

- `Encrypt` takes "plaintext of up to 4,096 bytes", enough to encrypt each provider key directly with no local crypto ([Encrypt API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html)). For symmetric keys, the KMS key ID is stored inside the ciphertext blob, so `Decrypt` does not need it.
- `EncryptionContext` works as AAD and must match exactly on decrypt, otherwise `InvalidCiphertextException`. It "may be displayed in plaintext in CloudTrail logs", so put identifiers in it (provider, name, row id), never values.
- KMS keys "never leave the AWS KMS FIPS 140-3 Security Level 3 validated hardware security modules unencrypted". Every call goes through IAM, so the worker's task role can be given `kms:Decrypt` only and the web role `kms:Encrypt` + `kms:Decrypt`. Every call shows up in CloudTrail (KMS cryptography essentials, above).
- Alternatively, use KMS only to wrap a data key (`GenerateDataKey`) and keep AES-256-GCM in Node. That is Option A with KMS as the KEK holder.
- Cost ([KMS pricing](https://aws.amazon.com/kms/pricing/)): "$1/month" per customer managed key, $0.03 per 10,000 requests, and a free tier of 20,000 requests a month. With a cache (section 4), our volume stays in the free tier.

Pros:
- The master key never sits in env or in our process.
- IAM scoping per app.
- An audit trail of every decrypt.
- Rotation is managed by AWS (section 3).

Cons:
- Adds `@aws-sdk/client-kms` and AWS-specific code to both apps, which breaks the "no AWS-specific code in the apps" rule in `hosting.md`. Moving to Scaleway or OVH would mean an adapter for their KMS plus a re-encryption migration.
- Local dev, CI and e2e need a fake or a different implementation anyway.
- A KMS outage or a throttled call can block starting the AI layer unless decrypted values are cached.

### Recommendation

Use Option A now, behind a small `SecretCipher` interface (`encrypt(plaintext, aad)`, `decrypt(row)`) with a `key_version` column. A KMS-backed implementation (Option B, or the hybrid) can then be added later without a schema change, if a B2B buyer's security review asks for HSM-held keys or decrypt audit. This follows the #191 standing choice and the portability rule. It needs no new ADR unless we pick KMS, which would be an amendment to `hosting.md` and ADR-0007.

## 3. Rotation and re-encryption

There are two kinds of rotation, and they must not be confused.

**Rotating a provider key** (an Administrator pastes a new Mistral key):
- Write a new ciphertext row, or overwrite the row and bump `updated_at` / a `version` counter, in one transaction. Record who and when. #191 lists the audit trail as "not yet specified", and it must store the fingerprint only, never the value.
- Readers pick up the change through the cache (section 4). Nothing else has to happen.

**Rotating the master key (KEK)**:
- Option A: hold a keyring in env, for example `PROVIDER_SECRETS_KEYS=v1:<b64>,v2:<b64>` and `PROVIDER_SECRETS_ACTIVE_KEY=v2`.
  - New writes use the active version.
  - Reads choose the key by the row's `key_version`.
  - A one-off job (`pg-boss` is already the worker's runner, `apps/worker/src/job-runner.ts`) decrypts each row with its old key and re-encrypts it with the active key in one transaction.
  - When no row references `v1`, remove it from env.
  - With about 20 rows, re-encryption takes milliseconds. Its real cost is the ordering of two deployments: add v2 → re-encrypt → drop v1.
- Option B: KMS automatic rotation "generates new cryptographic material for the KMS key every year" by default, with a configurable period "between 90 and 2560 days", plus on-demand rotation ([Rotate AWS KMS keys](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html), [Enable automatic key rotation](https://docs.aws.amazon.com/kms/latest/developerguide/rotating-keys-enable.html)).
  - KMS keeps old key material and "automatically chooses the correct key material" on decrypt, so **no re-encryption is needed** and no code changes.
  - However, rotation "does not rotate the data keys … or re-encrypt any data". In the hybrid design, wrapped data keys stay as they are unless we call `ReEncrypt`.
  - The first two rotations each add $1/month.

Separately, a KEK rotation does not protect against a leaked provider key. If a provider key leaks, the remedy is to revoke it at the provider and enter a new one.

## 4. How web and worker pick up changes

The current design reads keys once per process (section 1). To pick up Back Office edits without a deployment:

1. **One resolver in a shared package** (for example `packages/shared` or a new `packages/secrets`), imported by `apps/web` and `apps/worker`. `getSecret(provider, name)` returns the decrypted database value, falling back to env (#191: "Provider keys fall back to env"). It returns the source (`db` or `env`) for the Back Office to display, never the value.
2. **Cache with a TTL**: decrypted values in memory, on `globalThis` in the web app because of Next's per-chunk module copies. A TTL of 30 to 60 s bounds how stale a value can be. A version check is cheap: `SELECT max(updated_at) FROM provider_secret` on each TTL tick, and decrypt again only when it changed.
3. **Optional immediate invalidation**: on save, the web app runs `NOTIFY provider_secrets_changed`. Both apps `LISTEN` on a dedicated `pg` client and drop the cache. The TTL remains the backstop for a missed notification, for example after a reconnect.
4. **Rebuild what captured a key**:
   - `createAiLayerFromEnv` and the provider factories capture `apiKey` at construction. Either rebuild the AI layer when the secret version changes (`getAi()` compares a version and rebuilds), or change the providers to take `apiKey: () => Promise<string>`.
   - The same applies to `createBilling` (Stripe client), `createFranceTravail` (it also caches an OAuth access token, which must be dropped when the client secret changes), the Enriched Contacts provider, and the Better Auth instance (Google client).
   - Rebuilding on version change is the smaller diff.
5. **Retry once on 401/403**: drop the cache and retry with a freshly read key. This covers the gap between an Administrator saving a new key and the TTL expiring.
6. **Start-up validation**: today production fails at start-up on a missing key (`AiConfigError`). With database keys, a missing key is no longer a start-up fact. The Back Office should validate a key on save (a cheap authenticated call to the provider) and show "missing / from env / from Back Office" per provider, instead of failing a deployment.

## 5. Pitfalls: leaking keys

Found in our code:
- **Provider error bodies go into error messages.**
  - `packages/ai/src/providers/http.ts` puts up to 300 characters of the response body into `AiProviderError` (`HTTP ${status} ${detail}`).
  - `apps/web/src/enriched-contacts/providers/lusha.ts` keeps 200 characters.
  - France Travail returns `detail` in its result.
  - Some providers echo a partially masked key in 401 bodies. These messages reach logs and, for Job Searches, may be stored as a failure reason.
  - Before keys become editable by humans, which makes typos and wrong-provider pastes likely, these paths should run through a redactor that removes any known secret value and anything that looks like a bearer token.
- **Env is visible to everything in the container** (ECS doc, quoted above). This stays true for the KEK under Option A.
- **Cleartext must never reach the browser.**
  - The Back Office form must be write-only. Server actions and route handlers return only the fingerprint, source and `updated_at`.
  - Do not put a decrypted value into React props, a server component's serialized payload, or a `redirect` URL.
- **Data export and deletion.**
  - `apps/web/src/candidate-data/deletion-reach.test.ts` enumerates every table with a `candidate_id`/`userId`/`user_id` column and requires it in the account data export (`EXPORTED_TABLES`).
  - `provider_secret` and its audit table must therefore not use those column names for the Administrator who edited the row, or they would be pulled into a Candidate's export. Name the column `updated_by_admin` or similar, or keep only the email.
- **Database-side encryption leaks plaintext into SQL.** Encrypt in the app, not with `pgcrypto`. With `pgcrypto`, the plaintext and key travel in the SQL text, where `log_statement`, `pg_stat_statements` or RDS slow-query logs can capture them.
- **Encryption context and AAD are not secret.** KMS `EncryptionContext` "may be displayed in plaintext in CloudTrail logs". Put identifiers in it, never values.
- **Usage log**: `packages/ai/src/usage.ts` writes one JSON line per call to stdout and then CloudWatch. It logs `entry` fields only. Keep it that way: never log provider config objects.
- **Error reporters**: none is installed today (no Sentry, Bugsnag or Datadog in `apps/` or `packages/`). If one is added, scrub the `authorization`, `x-api-key` and `api_key` headers and the error message, since `Error.cause` chains can carry request objects.
- **Backups**: RDS snapshots contain only ciphertext. Under Option A, the KEK lives outside the database, in Secrets Manager. Never store both in one place, for example a `.env` committed to a backup bucket.
- **Tests and fixtures**: e2e fakes (`STRIPE_API_URL`, `CONTACT_ENRICHMENT_API_URL`) should use obvious dummy keys. A test should assert that the encrypted column never contains the plaintext and that a tampered tag or AAD makes decryption throw.

## Sources

- Node.js v22 `crypto`: https://nodejs.org/docs/latest-v22.x/api/crypto.html (`createCipheriv`, `getAuthTag`, `setAuthTag`, `setAAD`, `KeyObject`, `createSecretKey`)
- NIST SP 800-38D (GCM), §8.2–8.3 on IV construction and invocation limits: https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf (cited from the standard, not re-read)
- AWS KMS cryptography essentials (envelope encryption, HSMs): https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html
- AWS KMS `Encrypt` API (4,096-byte limit, encryption context): https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html
- AWS KMS key rotation: https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html and https://docs.aws.amazon.com/kms/latest/developerguide/rotating-keys-enable.html
- AWS KMS pricing: https://aws.amazon.com/kms/pricing/
- Amazon ECS, Secrets Manager secrets as environment variables: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html
- Repository: `docs/ops/hosting.md`, `docs/adr/0007-*.md`, `.env.example`, `packages/ai/src/env.ts`, `packages/ai/src/providers/http.ts`, `apps/web/src/*/server.ts`, `apps/web/src/database/pool.ts`, `apps/worker/src/main.ts`, `apps/web/src/candidate-data/deletion-reach.test.ts`

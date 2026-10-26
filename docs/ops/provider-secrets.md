# Provider Secrets: master keys and rotation

Decision: ADR-0020. Super-admins enter third-party keys in the Back Office (provider sheets on `/admin/parametres`); the app keeps them in `provider_secret`, encrypted with AES-256-GCM under a master key from `SECRETS_MASTER_KEYS`. This page is the runbook for that master key.

## The keyring

`SECRETS_MASTER_KEYS` is a comma-separated list of `<version>:<base64 of 32 random bytes>`:

```
SECRETS_MASTER_KEYS=1:6f1q...=,2:Hk3b...=
```

- The highest version encrypts every new value. Older versions still decrypt the rows sealed under them.
- The web app and the worker must get the same list (in production: the same AWS Secrets Manager secret, injected by ECS into both task definitions).
- It is a bootstrap secret: it is never entered in the Back Office and never stored in the database, nor in the same backup as a database snapshot.
- Without it, nothing can be saved on the provider sheet in Paramètres (the page says so) and every key comes from env, as before #208.
- A malformed list (a version that is not a positive whole number, a key that is not 32 bytes, a version listed twice) stops the server at start-up with the entry's position, never the key.

Make a key: `openssl rand -base64 32`. The `scripts/setup/issue-208.sh` wizard walks through the first set-up.

## Rotating the master key

Two deployments, in this order. Nothing is down in between: both versions decrypt during the overlap.

1. **Add the new version.** Append it to the list, keeping the old one: `1:<old>,2:<new>`. Deploy the web app and the worker.
   - New values are encrypted under v2 at once.
   - The worker re-encrypts every row under v2 when it starts (job `provider-secrets.reencrypt`, also run nightly at 04:15 UTC). Its log says `[provider-secrets] N Provider Secret(s) re-encrypted under the newest master key`.
2. **Check no row uses the old version.** The provider sheet lists the master key versions in use under its table ("Saved keys are encrypted with master key: v2 (active: v2)"). Or in SQL: `SELECT key_version, count(*) FROM provider_secret GROUP BY 1;`.
   - If v1 is still listed: a row that does not decrypt is left as it is (the worker logs it). Replace or clear that key on the provider sheet in Paramètres, then check again.
3. **Remove the old version.** Set `SECRETS_MASTER_KEYS=2:<new>` and deploy both apps again.

A row whose master key was removed before it was re-encrypted no longer decrypts: the provider sheet shows it as "Unreadable: the environment stands in", and env's value is used. Replace or clear it.

## A leaked provider key

Rotating the master key does not help: revoke the key at the provider, then paste the new one on the provider sheet in Paramètres. It is tested, then used by the web app and the worker within seconds (Postgres `NOTIFY`), at most 60 s.

## What never leaves the database

- Values never reach the browser, the Back Office Audit (only "replaced", "replaced despite a failed test", "cleared"), the logs, nor a Candidate's data export (`provider_secret` names its Administrator by email only).
- Provider error messages are scrubbed of keys before they are logged or stored.

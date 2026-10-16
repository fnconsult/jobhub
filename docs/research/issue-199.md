# Research for issue #199: configuring Better Auth sign-in providers at runtime

Scope: can Better Auth (pinned `better-auth@^1.7.7`, installed 1.7.7, `apps/web/package.json`) load social, generic OAuth/OIDC and SAML providers from the database at runtime? What does a change without a redeploy need? How do callback URLs, account linking with existing magic-link Candidates, and Apple sign-in work? Sources read 2026-10-16: the installed 1.7.7 build (`apps/web/node_modules/better-auth/dist`, `node_modules/@better-auth/core/dist`), the `@better-auth/sso@1.7.7` tarball from npm (not yet a dependency), better-auth.com docs, and the repo (`apps/web/src/auth/`, ADR-0011). Docs describe the latest release; where docs and the 1.7.7 source differ, the source wins.

## Current repo state

- `createAuth(config)` (`apps/web/src/auth/index.ts`) builds one `betterAuth()` instance with `socialProviders: { google }` when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set (`config.ts` `googleClientFromEnv`), plus the `magicLink` plugin. No `account.accountLinking` options are set, so the defaults apply.
- `getAuth()` (`server.ts`) caches that instance for the life of the process (`instance ??= createAuth(...)`).
- The sign-in page copy only knows about one optional provider (`signInCopy({ googleEnabled })`, `sign-in-copy.ts`).

## Findings

1. **`socialProviders` are resolved once, at instance init.** `create-context.mjs` maps `options.socialProviders` to provider objects inside the async init. Each entry may be a value or an `async () => config` function, but the function is awaited only once, at init. Entries that return `null` or `{ enabled: false }` are dropped. Keys must be one of the ~40 built-in providers in `@better-auth/core/social-providers` (google, apple, microsoft-entra-id, github, linkedin, facebook, gitlab, …). The result is stored on `ctx.socialProviders`, and `sign-in/social` and `callback/:id` look providers up there (`api/routes/sign-in.mjs:150`, `callback.mjs:59,90`). So a database-backed loader works at boot, but changing a provider means building a new instance. Source: `better-auth/dist/context/create-context.mjs` lines 98-106; `context/helpers.mjs` `getAwaitableValue`.
2. **`genericOAuth` is also static.** `genericOAuth({ config: [...] })` takes a plain array. Its `init` runs discovery for each entry and adds the results to `ctx.socialProviders`, so they share the `signIn.social` and `/callback/:id` flow (`plugins/generic-oauth/index.mjs` lines 61-80 and the init return). There is no runtime registration endpoint. Built-in presets: auth0, keycloak, microsoft-entra-id, okta, slack, line, hubspot, patreon, gumroad, yandex.
3. **The `sso` plugin (`@better-auth/sso`) is the only first-party database-backed option.** Providers (OIDC or SAML) live in an `ssoProvider` table and are managed at runtime through `/sso/register`, `/sso/update-provider`, `/sso/delete-provider`, `/sso/providers` and `/sso/get-provider`. Sign-in uses `/sign-in/sso`, which takes `email` (resolved by domain), `domain`, `providerId` or `organizationSlug`. No redeploy is needed. Its model is enterprise and domain-bound (`domain`, optional `organizationId`, DNS TXT domain verification), not consumer "Continue with Google". `defaultSSO` adds code-defined providers that take precedence. Sources: `@better-auth/sso@1.7.7` `dist/index.mjs` endpoint list (lines 2221-4376); https://www.better-auth.com/docs/plugins/sso.
4. **SSO plugin caveats for 1.7.7 that the spec must handle:**
   - `/sso/register` only needs a session (`use: [sessionMiddleware]`). Without the organization plugin, **any signed-in Candidate could register a provider** they then own (`provider.userId === userId`). The default is `providersLimit ?? 10` per user (`index.mjs:3341`). We would need to block these paths for non-Administrators: a `hooks.before` check, `disabledPaths`, or `providersLimit: 0` for non-admins, while the Back Office calls `auth.api.registerSSOProvider` server-side. The plugin's own doc comment on `trustEmailVerified` warns of account takeover when users can freely register providers.
   - The OIDC `clientSecret` is stored **in plain text** inside the `oidcConfig` JSON column (`index.mjs:3435-3440`). The plugin has no encryption hook. This conflicts with the Provider Secrets work in #191 unless we encrypt and decrypt around it or keep the secret elsewhere.
   - `guardProviderMutation` exists in 1.7.7 (`index.mjs:2057`), so the app can veto provider mutations.
   - Registering a `providerId` that collides with a configured social provider, an `accountLinking.trustedProviders` entry or a reserved id (`credential`, …) is rejected with a 422 (`index.mjs:3129,3378`).
5. **Changing a provider without a redeploy (social or genericOAuth) needs the app to rebuild the instance.** One workable shape, inferred from the source rather than documented: keep provider rows in the database, then have `getAuth()` build `betterAuth()` from them and rebuild when a config version changes. For example, check a version stamp with a short TTL, since several web processes must each notice the change. Rebuilding is safe for live users:
   - Sessions are database rows keyed by the same `AUTH_SECRET`.
   - With a database configured, OAuth state defaults to `storeStateStrategy: "database"` (`create-context.mjs` `oauthConfig`), so a sign-in that starts on the old instance can finish on the new one.
   - `createBetterAuth` starts init (and an async schema check) per instance (`auth/base.mjs`), so rebuilds should be rare, not per request.

   Mutating `ctx.socialProviders` from a custom plugin would also work but relies on undocumented internals.
6. **Callback URLs are deterministic, so they can be shown in the Back Office.**
   - Social and genericOAuth: `{APP_URL}/api/auth/callback/{providerId}`, built as `${c.context.baseURL}${getOAuthCallbackPath(provider)}` (`api/routes/callback.mjs:67,112`). `callback/:id` also accepts POST and re-issues it as a GET redirect (line 45), which is how Apple's `form_post` works.
   - SSO OIDC: `{APP_URL}/api/auth/sso/callback/{providerId}`, or a shared `/sso/callback` via the `redirectURI` option (`index.mjs:3137-3147`).
   - SSO SAML: ACS `{APP_URL}/api/auth/sso/saml2/sp/acs/{providerId}` (GET and POST), and SP metadata `/api/auth/sso/saml2/sp/metadata?providerId=…`.
   - Each must be registered at the IdP for every environment (staging and prod have different `APP_URL`).
7. **Account linking with existing magic-link Candidates works by default for verified-email providers.**
   - Magic-link sign-in sets `emailVerified: true` (`plugins/magic-link/index.mjs:185`).
   - On an OAuth sign-in whose email matches an existing Candidate, `handleOAuthUserInfo` links automatically when all of these hold:
     - the provider is trusted or reports `email_verified`;
     - the local user is verified (`requireLocalEmailVerified`, default true);
     - linking is not disabled (`accountLinking.enabled !== false`, `disableImplicitLinking !== true`).

     Otherwise it fails with `account not linked` (`oauth2/link-account.mjs:136-143`).
   - `accountLinking.trustedProviders` accepts an array or `(request) => providers`, and the function is re-evaluated **per request** (`context/helpers.mjs` `getTrustedProviders`; `auth/base.mjs` handler). So trust can come from the database without a rebuild.
   - Signed-in Candidates can link explicitly with `linkSocial()`. Different emails are rejected unless `allowDifferentEmails` is set.
   - genericOAuth reads `email_verified ?? false` from userinfo, so a provider that omits the claim will not link implicitly unless it is listed as trusted.
   - SSO trusts a provider for linking only when its domain is verified and the email domain matches (`index.mjs:3008`); `trustEmailVerified` is deprecated.

   Source: https://www.better-auth.com/docs/concepts/users-accounts.
8. **Apple sign-in:**
   - Built-in `apple` provider. It requests scopes `email name` with `responseMode: "form_post"` and verifies the ID token against `audience` / `appBundleIdentifier` / `clientId` (`@better-auth/core/dist/social-providers/apple.mjs`).
   - `clientSecret` is not a static secret but an ES256 JWT signed with the `.p8` key (Team ID, Key ID). Apple caps it at 6 months, and the docs generate one with a 180-day expiry. So the stored values are the `.p8` key, Team ID, Key ID and Service ID, and the JWT must be regenerated before expiry, either at instance build or on a schedule.
   - `https://appleid.apple.com` must be in `trustedOrigins` because of the form POST.
   - The return URL is `https://<domain>/api/auth/callback/apple`, and Apple rejects localhost and plain HTTP.
   - Apple sends `email` (and the user's name) only on the first authorization. Private-relay emails will not match an existing magic-link Candidate's address, so implicit linking will not happen for them. Either the Candidate links from their account page, or a duplicate account is created.

   Source: https://www.better-auth.com/docs/authentication/apple; core `apple.mjs` lines 14-77.

## Implications for the SSO spec (#200), as decision input

- **Candidates (consumer providers such as Google, Apple, Microsoft and LinkedIn):** use `socialProviders` (plus `genericOAuth` for anything OIDC that is not built in), loaded from encrypted database rows and with a rebuild-on-change `getAuth()`. The SSO plugin does not fit B2C sign-in buttons.
- **Administrators (e.g. the Jobbbox Google Workspace domain):** either the same social provider with a Back Office role check after sign-in, or the `sso` plugin with one domain-verified provider. The SSO plugin brings plain-text secrets and open registration endpoints that must be locked down. Organisation enterprise SSO stays out of scope (ADR-0004).
- **Sign-in page:** it needs a list of enabled providers rather than the `googleEnabled` boolean.
- **ADR-0011:** it already anticipates "Google (Apple later)" on Better Auth. Database-driven providers stay within it. A new ADR is only warranted if the SSO plugin is adopted, because it adds a table and an endpoint surface.

## Not verified

- No prototype was run. The rebuild-on-change approach is inferred from the 1.7.7 source, not from a documented Better Auth feature.
- The latest docs mention SSO behaviours (structured discovery errors, the `guardProviderMutation` contract) whose exact 1.7.7 semantics were only spot-checked in the source.
- Apple private-relay behaviour comes from Apple's general documentation as reflected in the Better Auth docs, not Apple's own pages.
- Better Auth releases after 1.7.7 (1.7.10, 1.8.0-beta) were not checked for a native dynamic-provider API.

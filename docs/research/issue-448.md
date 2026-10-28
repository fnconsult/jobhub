# Issue #448: Back Office Email intake sheet and Assistant explanations

Scope: only provider facts needed to build the Email intake sheet (Brevo inbound key/secret and test) and to write the Assistant's provider-by-provider setup explanations. Checked 2026-10-28. "Not documented" means the primary source is silent; verify live.

## Brevo inbound parsing
Sources: https://developers.brevo.com/docs/inbound-parse-webhooks , https://developers.brevo.com/docs/secured-webhooks.md , https://developers.brevo.com/docs/retry-mechanism.md
- DNS: delegate a receiving subdomain (e.g. `reply.example.com`) with two MX records: priority 10 `inbound1.sendinblue.com.`, priority 20 `inbound2.sendinblue.com.`. The sending domain must be verified in Brevo and the receiving domain must differ from it. Propagation can take hours.
- Webhook creation: `POST https://api.brevo.com/v3/webhooks` (header `api-key`) with `type: "inbound"`, `events: ["inboundEmailProcessed"]`, `url`, `domain`, optional `description`.
- Payload: JSON with top-level `items[]`. Fields: `Uuid`, `MessageId`, `InReplyTo`, `From`, `To`, `Cc`, `ReplyTo`, `Recipients`, `Subject`, `SentAtDate`, `RawHtmlBody`, `RawTextBody`, `ExtractedMarkdownMessage`, `ExtractedMarkdownSignature`, `Spam.Score`, `Attachments[]` (`Name`, `ContentType`, `ContentLength` (estimate), `ContentID`, `DownloadToken`), `Headers`. Attachments are fetched separately with the `DownloadToken`.
- Securing the endpoint (the "secret" in the sheet): Brevo offers (a) `auth: {type: "bearer", token}` on webhook creation, header name not documented; (b) custom `headers` key/value array sent on each call (documented, name and value are ours, so a shared-secret header is deterministic); (c) basic credentials in the URL, transmission not documented; (d) IP allowlisting of Brevo CIDR ranges. There is no HMAC signature. Recommendation: custom header carrying the secret, compared in constant time.
- Retries: after the original call, 4 retries at 10 min, 1 h, 2 h, 8 h; any 5xx and any 4xx except 429 stop retries and discard the webhook. The page describes outbound event webhooks and does not say it applies to inbound parsing. Not documented for inbound: retries, rate limits, payload and attachment size caps, whether the HTTP method is fixed (a Brevo help-center search hit says POST/GET/PUT/PATCH is selectable; unverified). Implication: respond 2xx fast and dedupe on `Uuid`/`MessageId`; "discard unread" when the switch is off should still return 2xx.
- Gap: how the Brevo API key is validated for the "test" button (e.g. list webhooks `GET /v3/webhooks?type=inbound`) was not verified here.

## Microsoft (later, Outlook linked mailbox)
Source: https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview
- Publisher verification needs a verified Microsoft AI Cloud Partner Program account (the partner global account, not a location ID), the app registered in an Entra work/school tenant (not a Microsoft account, not B2C) with a publisher domain set (not `*.onmicrosoft.com`) matching the CPP verification email domain or a DNS-verified custom domain, an initiating user with Application/Cloud Application Administrator in Entra and CPP Partner Admin/Account Admin, MFA, and acceptance of the identity platform terms. No fee or license.
- Why it matters: with risk-based step-up consent enabled, users in other tenants cannot consent to unverified multi-tenant apps registered after 2020-11-08 requesting permissions beyond basic sign-in/profile (e.g. mail read); a warning is shown.
- Not supported in national clouds.

## Google (later, Gmail linked mailbox)
Sources: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification , https://developers.google.com/workspace/gmail/api/auth/scopes
- `https://www.googleapis.com/auth/gmail.readonly` is listed as a restricted scope.
- Restricted scopes require scope verification before use (exceptions: personal use, dev/test, internal, domain-wide install). Apps storing or transmitting restricted data on servers need a security assessment by a Google-empanelled assessor using CASA (App Defense Alliance). Reassessment is required at least every 12 months from the Letter of Assessment approval. Brand verification first; declare scopes in the Cloud Console; demo video per sensitive/restricted scope.

## Yahoo (later)
Not researched: no primary-source check was done for Yahoo OAuth. Verify against Yahoo Developer docs before the Assistant explains it.

## Implications for the issue
- Assistant explanation for the inbound-domain label must name: dedicated subdomain, the two Brevo MX records, verified sending domain, webhook creation with `inbound` type and secret header.
- Store the secret as a provider secret; do not rely on a signature (none exists).
- Microsoft and Google explanations should state the lead-time gates (CPP verification; Google CASA, annual).

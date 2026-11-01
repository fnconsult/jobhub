# Email intake is received by Jobbbox's own MTA (Haraka), one for every environment

_Supersedes ADR-0050's choice of Brevo Inbound Parsing (and its Mailgun fallback) for receiving the emails. The Forwarding address stays the only way in._

Brevo Inbound Parsing hands the app a parsed JSON, so SPF, DKIM and DMARC were whatever the processor wrote, and a third party saw every Candidate's correspondence. Jobbbox now receives the mail itself (#580).

- **Haraka on the VPS** (`apps/mta`), not Postfix: its logic is Node, so it is tested with vitest, and it posts each email straight to the app without keeping it on disk (read-only container, nothing spooled).
- **One MTA for every environment**: only one process can listen on port 25. It routes by domain: a Route maps one Email intake domain to one environment's app and secret. It accepts a recipient only on an exact Email intake domain; any other domain, a subdomain included, gets 550, so it cannot relay.
- **The raw message plus the MTA stamp**: the app receives `message/rfc822` with the envelope recipients and the MTA's own Authentication-Results beside it. Only that stamp is trusted; an Authentication-Results line inside the message is ignored. The MTA computes DMARC itself, as Haraka has no DMARC plugin.
- **Answers to the sender**: 450 (retry later) when the app answers 5xx, 401 or 403 or does not answer, so nothing is lost while the app is down; 550 for a 400 or 413, which a retry would not fix. Messages are capped at 10 MB.
- **The IP check is the MTA's own network**: `EMAIL_INTAKE_MTA_IP_RANGES` defaults to the private ranges. A request that came through the public proxy carries the caller's address and gets 403.
- **STARTTLS with a self-signed certificate** unless a real one is mounted: senders' TLS is opportunistic and does not check it.
- **No AAAA record for `mx.jobbbox.ai`**, so senders reach it over IPv4 and the address SPF needs is preserved.

## Considered Options

- **Postfix**: mature, but its filtering would be scripted outside our test suite and it spools mail to disk.
- **Keep Brevo Inbound Parsing or move to Mailgun**: no server to run, but a processor reads every email and the authentication result is theirs.
- **One MTA per environment**: impossible on one IP and port 25.

## Consequences

- We run a public-facing mail server: patching, port 25 reachable from the internet, and a probe (`apps/mta/scripts/probe.mjs`) to check it.
- No processor receives the emails any more (ADR-0051).
- The MTA has its own `.env` on the VPS, outside any environment's stack; `deploy.sh` starts it only for the environment named by `MTA_DEPLOYED_BY`.

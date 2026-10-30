# Research for #580: own MTA for Email intake

Date: 2026-10-30. Scope: only what implementing #580 needs. Sources are Haraka's official docs (haraka.github.io, github.com/haraka/Haraka). Items marked UNVERIFIED could not be confirmed from a primary source in this pass; the implementer must check them against the installed version.

## Verified

- Recipient-domain gate (no open relay): Haraka's `rcpt_to.in_host_list` plugin accepts recipients only for domains in `host_list` (or anchored `host_list_regex`); unmatched recipients go to other rcpt hooks and, if none accepts, are rejected. It is the default rcpt plugin. `host_list.anti_spoof` rejects a local-domain MAIL FROM from a non-relay host. Keep `host_list_regex` empty or exact. Source: https://haraka.github.io/plugins/rcpt_to.in_host_list , https://raw.githubusercontent.com/haraka/Haraka/master/docs/Plugins.md
- Outbound relaying only happens if a plugin sets `connection.relaying = true` (SMTP AUTH or the `relay` plugin). With none configured, the server relays nothing. Source: https://haraka.github.io/core/Outbound
- SPF: the `spf` plugin implements SPF, adds `Received-SPF` trace headers only, and rejects/defers nothing by default (`[deny]` options default false). It reads TXT records only. It documents no Authentication-Results output. Source: https://haraka.github.io/plugins/spf
- DKIM: the `dkim` plugin verifies signatures (RFC 6376) and adds an `Authentication-Results` header. It does not support the `l=` body-length tag. Source: https://haraka.github.io/plugins/dkim
- TLS: STARTTLS is advertised from `tls_key.pem`/`tls_cert.pem` (overridable in `config/tls.ini`; per-domain bundles in `config/tls/`; SNI supported). `rejectUnauthorized` defaults false, which suits MX reception since senders' certs are not required. Haraka docs describe forced TLS only for outbound (`force_tls_hosts`); "enforce STARTTLS when offered" for inbound means: advertise it and accept clients that use it. Do not require it, since many legitimate senders still deliver in clear. Source: https://haraka.github.io/plugins/tls
- Raw message access: `transaction.message_stream` is a Readable stream of the whole message (pipe it to an HTTP request body); `transaction.results` holds structured plugin results; `transaction.data_bytes` is the size after DATA. Source: https://haraka.github.io/core/Transaction
- Size cap: the `max_data_exceeded` hook fires when a message exceeds `connection.max.bytes`. Source: https://raw.githubusercontent.com/haraka/Haraka/master/docs/Plugins.md
- Listening: `config/smtp.ini` `listen=` sets the bind address/port (default port 25, all addresses). Source: https://raw.githubusercontent.com/haraka/Haraka/master/config/smtp.ini
- Queue and retry: Haraka's outbound queue is on disk by default, so a custom delivery plugin must not hand the mail to it. To satisfy "5xx from the route means 4xx to the sender, nothing kept on disk", do the HTTP POST in the `queue` hook and return `DENYSOFT` on failure (UNVERIFIED hook-return semantics: confirm on https://haraka.github.io/core/Plugins before coding).

## UNVERIFIED (check before building)

- DMARC plugin: page not retrievable (404 at the URLs tried). Confirm the plugin name (`dmarc`), that it needs `spf` and `dkim` results, its reject defaults, and whether it writes an Authentication-Results line. Look in https://github.com/haraka/haraka-plugin-dmarc .
- Exact config key for the size limit (`databytes` in `config/smtp.ini` was not found in the default file; likely the `data.*`/`max_unrecognized`-style settings in `connection.ini` or `smtp.ini`). Verify in the Haraka source (`connection.js`).
- Whether SPF/DKIM/DMARC results can be forwarded to the route as a structured JSON field versus posting the raw MIME with the `Authentication-Results`/`Received-SPF` headers prepended. Either fits #580; headers in MIME is the simplest, but the route must then trust only headers added by our MTA and strip any incoming ones with the same names.
- Postfix alternative: not researched (docs returned HTTP 402). Haraka suits better here because it is scriptable in Node and can POST to the route without a spool; if Postfix is chosen, research `smtpd_relay_restrictions`, `message_size_limit` and a pipe/content filter that returns EX_TEMPFAIL.
- Port-sharing between staging and production on one IP: no external fact needed; a single Haraka can route by recipient domain to two upstream URLs (design decision, not research).

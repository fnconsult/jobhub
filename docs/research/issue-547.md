# Research: issue #547 (Legal Text Version notice, J-30)

Status: NOT VERIFIED against primary sources. The session could not resolve
`www.legifrance.gouv.fr` or `developers.brevo.com` (outside the allowed network
domains). Nothing below is a verified claim; these are the questions the
implementation depends on, with the primary source to check.

## External facts the issue relies on

1. 30-day notice before a substantial change takes effect: the issue cites
   Code de la consommation L215-1-1 and RGPD art. 12-13. Verify the exact article
   number, wording and scope (does it impose 30 days, and for which contracts).
   Source: Legifrance, Code de la consommation.
2. RGPD art. 12-13 (information duty on privacy-policy change): verify whether a
   notice by e-mail is required or whether an in-app notice suffices.
   Source: EUR-Lex, Regulation (EU) 2016/679.
3. Brevo transactional e-mail: verify that open and click tracking can be
   disabled per message (no pixel, no rewritten links) and which mechanism
   (API parameter or account setting), plus idempotency support and rate limits.
   Source: Brevo API reference, `POST /v3/smtp/email`.
4. Service e-mail without marketing opt-in: verify with legal that this is a
   service message (ePrivacy art. 13 / CNIL guidance).

## Action

Allow `www.legifrance.gouv.fr`, `eur-lex.europa.eu` and `developers.brevo.com`
in the session network settings and re-run, or have the product owner confirm
items 1-4. Until then, the implementer should not hard-code the 30-day rule's
legal basis in user-facing text or the register.

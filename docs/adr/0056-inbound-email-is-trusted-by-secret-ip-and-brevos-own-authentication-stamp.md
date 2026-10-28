# Inbound email is trusted by a shared secret, Brevo's IP ranges and Brevo's own authentication stamp

_Builds on ADR-0050 (Forwarding address) and ADR-0052 (Guardrail on offer emails) for #442._

Anyone can post to Email intake's webhook or send to a Forwarding address, and a forged "From" would let an outsider feed text to the AI. So an email is kept only after three checks, and none of its content is trusted before them.

- **The webhook**: Brevo's shared secret (Provider Secret `BREVO_INBOUND_SECRET`, compared in constant time) and the sender's IP being in Brevo's ranges (a Platform Setting, read from the last `X-Forwarded-For` entry, which our proxy writes). While no secret is set, every delivery is refused. Brevo does not document that its webhook ranges also cover inbound email: if real deliveries are refused on staging, Administrators widen the setting.
- **The sender**: only the first Authentication-Results header counts, taken as the stamp Brevo's own receiver added; later ones can be forged by the sender. DMARC must pass for the From domain, and SPF or DKIM must align with the Recognised sender's domain (or the Candidate's own Sending address). To be confirmed on real staging mail.
- **What is kept**: an email from an unrecognised sender or past the daily cap (Paris calendar day) keeps no text. The others keep their text encrypted, bound to their row, until read or 72 hours.

## Considered Options

- **Trust the From header, or any Authentication-Results header**: forgeable; a forged alert could carry an injection or a false offer.
- **Verify the secret only, no IP check**: a leaked secret would then be enough; the IP check costs one setting.
- **Keep every email's text and decide later**: keeps third parties' content we will never read (ADR-0051).

## Consequences

- The daily cap and the IP ranges are Platform Settings, not env (ADR-0024).
- A first-header assumption that proves wrong on staging changes the sender check only, not the stored data.

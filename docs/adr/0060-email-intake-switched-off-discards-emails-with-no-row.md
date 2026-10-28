# While Email intake is switched off, an email is discarded unread with no row

_Builds on ADR-0051 (nothing kept that we will never read) and ADR-0024 (settings in the Back Office) for #448._

Email intake is a Job discovery source with a switch on the Sources tab. When an Administrator turns it off, an email that still reaches the webhook is discarded unread: no Received offer email row is kept and nothing is queued. Turning it on again does not recover what arrived meanwhile.

## Considered Options

- **Keep the emails and read them on switching on**: stores third parties' content for an unbounded time, against ADR-0051, and floods the AI on switch-on.
- **Keep a row with the outcome only**: Activité would then show emails the Administrator chose not to read, and the row still names a sender's domain.

## Consequences

- Candidates' offers sent while the source is off are lost; they can forward the email again.
- The switch, unlike « Indisponible » (Held back), stops reception itself; Held back only changes what the Sources tab shows.

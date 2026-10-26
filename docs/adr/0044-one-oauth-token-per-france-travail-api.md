# One OAuth token per France Travail API, never mixing scopes

France Travail's APIs (Offres d'emploi, La Bonne Boite, ROMEO) share one client but a token asked with scopes of an API the client has no access to is refused with `invalid_scope`, so one missing access broke the others. Research: `docs/research/issue-400.md`; issue #400.

- **One token per API**, each asked with only its own scopes and kept until a minute before it expires: Offres d'emploi `api_offresdemploiv2 o2dsoffre`, ROMEO `api_romeov2`, La Bonne Boite `api_labonneboitev2 search office`, else `api_labonneboitev2` alone (the one that works is kept).
- **La Bonne Boite validates the client**: its token is asked first, and `invalid_client` or 401 there stops the check; any other API refused with `invalid_scope`, 400 or 403 is *refused* (access not granted), anything else an *error*.
- **A refusal is a state, not a failure**: the connection test passes when the client is valid and stores each API's state (`provider_api_access`, no secret); a refused Offres d'emploi shows the source and Tool as awaiting access, and a run goes on without it.

## Considered Options

- **One token with all scopes**: the first API not granted refuses the whole request.
- **Test only Offres d'emploi**: a valid client without that access reads as invalid credentials.

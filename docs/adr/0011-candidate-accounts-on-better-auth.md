# Candidate accounts on Better Auth, shared with the extension by cookie

Passwordless sign-in (ADR-0008) is built on Better Auth rather than Auth.js or hand-rolled code: it ships magic links and Google (Apple later) on our own Postgres, keeps everything in the EU database (ADR-0007), and has an organisation plugin that matches ADR-0004. Its account table is named `candidate`, so the code speaks the domain language; the Candidate's Interface Language is a column on it (default `fr`).

The browser extension holds no session or token of its own. Its host permission on the web app lets Chrome send the web app's session cookie with the extension's requests, so signing in or out on the web app signs the extension in or out too; the extension's `chrome-extension://<id>` origins are listed as trusted so it may also act for the Candidate. We rejected bearer tokens stored in the extension: a second credential to issue, store and revoke, for no gain while the extension only works alongside the web app.

Organisations (ADR-0004) will be added with the organisation plugin: it only creates `organization`, `member` and `invitation` tables referencing `candidate`, and adds a nullable column to `session`. Candidate data is never migrated; a test checks the plan stays additive.

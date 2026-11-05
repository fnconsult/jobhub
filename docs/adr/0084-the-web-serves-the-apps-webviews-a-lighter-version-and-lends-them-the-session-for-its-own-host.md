# The web serves the app's WebViews a lighter version and lends them the session for its own host

Status: accepted (#689)

ADR-0076 puts Mon compte, the subscription, the Legal Texts and the Coach space in WebViews of the Jobbbox app. Three choices follow, hard to change once the app is in the stores.

- **The web recognises the app's WebView by its user agent**, `JobbboxApp/<API Version>`, and serves it another version: no Sidebar; the subscription page without price, discount, Plan comparison, promotion code or Stripe customer portal, with « Gérer mon abonnement sur jobbbox.ai » opening in the system browser (the Withdrawal and cancellation links stay); the proxy sends the Order pages to `/abonnement` or `/coachs` (`native-app/in-app.ts`). One code base, no second set of pages. The user agent is a hint for presentation, never a check of rights: the same rules apply on the server. Whether this reading of App Store rule 3.1.1(a) holds outside the United States is still to be confirmed (ADR-0076).
- **The session cookie is lent to the WebViews for the exact web-app host only** (host-only, Secure, HttpOnly), written to the WebView cookie store at sign-in and emptied at sign-out or when the web no longer knows the session. Production seen from the Beta, a look-alike host and plain HTTP never receive it and open in the system browser.
- **Account deletion is reached at `/compte/supprimer`, an address that exists only in the app**, which opens `/compte/donnees#supprimer`: three gestures (Menu, Mon compte, Supprimer mon compte), as the stores require (ADR-0010, ADR-0073).

An Acceptance made on the app's native Legal steps is recorded through the same route, with the origin `mobile` read from the `Jobbbox-Client` header.

## Considered Options

- **Pages made for the app (`/app/*`)**: rejected: a second copy of each page to keep alike.
- **A query parameter instead of the user agent**: rejected: lost at the first redirect or link.
- **The cookie on the whole `jobbbox.ai` domain**: rejected: the Beta and any subdomain would receive Production's session.

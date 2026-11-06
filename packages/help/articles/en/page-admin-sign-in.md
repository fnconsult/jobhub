---
kind: page
audience: administrator
topic: fournisseurs-et-tools
title: Sign-in
synonyms: [sign-in, sign-in provider, sso, google, apple, microsoft, oidc, link by email, team sign-in, require, redirect url, connexion, app, application, app store, guideline 4.8, services id]
route: /admin/parametres?tab=connexion
---
The « Sign-in » tab of Settings sets the sign-in methods besides the link by email: Google, Apple, Microsoft and any OIDC provider. A change applies within seconds, with no redeployment and nobody signed out.

The « Team sign-in » card holds the « Require a sign-in provider for administrators » box: when ticked, the back office asks an administrator signed in with a link by email to sign in again with a provider allowed for administrators. Permanent super-admins are never concerned.

The « Providers » list shows each provider with its « Type », its « Redirect URL » to paste in the provider's console, its « Use » (offered to candidates, allowed for administrators), its « Secrets » and its « Test sign-in ». A provider is enabled only after a passed test sign-in, and again after each change of its credentials. A secret entered here is encrypted and never shown again.

Super-admins add, edit, test and remove providers; « Technique » and Support read them.

The Jobbbox app offers candidates the same providers as the site, through the same flow: the provider's page opens in the phone's browser and comes back to the app; no sign-in with an identity token is accepted, and the « App bundle ID (optional) » plays no part in it. The App Store refuses an app that offers a Google or Microsoft sign-in without Apple (guideline 4.8): as long as that is the case, a note says so at the top of the tab. For Apple, the « Service ID » is that of an Apple Services ID, whose console declares the domain and the « Redirect URL » of each environment (the Beta has its own). Its client secret is signed again every month by the worker from the « Private key (.p8) »; a failure is emailed to the super-admins.

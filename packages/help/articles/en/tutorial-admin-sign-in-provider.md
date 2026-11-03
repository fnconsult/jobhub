---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Set up a sign-in provider, then require SSO
synonyms: [sign-in provider, sso, require sso, require, google, apple, microsoft, oidc, team sign-in, redirect url, client id, client secret, test sign-in]
---
Only super-admins set up a sign-in provider. Keep this order: a provider tested and allowed for administrators first, the requirement after, or the team could no longer sign in again.

1. Open Settings, « Sign-in » tab. Under « Add a provider », open « Add Google », « Add Apple », « Add Microsoft » or « Add OIDC ».
2. Enter the « Name on the button », the « Client ID » (the « Service ID » for Apple) and each secret asked for: the « Client secret », or for Apple the « Team ID », the « Key ID » and the « Private key (.p8) ». For OIDC, add the « ID » (lower case letters, digits and dashes: it is part of the redirect URL and never changes) and the « OIDC discovery URL »; for Microsoft, the « Tenant ».
3. Leave « Allow it for back office sign-in » on; turn « Offer it to candidates on the sign-in page » off if candidates should not see it. For OIDC, turn « Link an account with the same email address automatically » on only if this provider verifies email addresses. Leave « Enabled » off.
4. Click « Save the provider ».
5. In the « Providers » list, copy its « Redirect URL » and paste it in the provider's console, as an allowed redirect URI.
6. Click « Test sign-in with … ». Nobody is signed in and no account is created; the message « …: the test sign-in passed. You may enable it. » confirms it.
7. Open « Edit … », turn « Enabled » on, then « Save the provider ».
8. Sign in to the back office once with this provider, to check it lets you in.
9. In the « Team sign-in » card, tick « Require a sign-in provider for administrators » and click « Save ».

An administrator signed in with a link by email will then have to sign in again with a provider allowed for administrators; their candidate pages stay open. Changing a provider's credentials calls for a new test before enabling it again.

# The app returns from a Sign-in Provider by its own scheme, in an authentication browser that keeps the person's sign-ins

Status: accepted (#687)

ADR-0076 left open whether the web OAuth flow returns to the app by its scheme or by a universal link. It returns by the scheme: `jobbbox:///connexion/fournisseur`. An HTTPS return from `ASWebAuthenticationSession` needs iOS 17.4, and the app runs from 16.4. The app asks Better Auth for the provider's URL (`signIn.social` with `disableRedirect`), opens the Expo proxy in the system's authentication browser, and keeps the session cookie it gets back in the Keychain or Keystore. The callback `/api/auth/callback/{id}` and the linking rules are unchanged; ID-token sign-in stays refused (ADR-0011).

- **Not ephemeral.** The browser shares the person's existing sign-ins (one tap for someone already signed in to Google or Apple) instead of asking for the password again. The cost is that the system's browser keeps the provider's cookies after sign-out.
- **A cancellation is not a failure.** Closing the browser, `access_denied` and `user_cancelled_authorize` leave the screen as it was; any other error code shows the web's text.
- **Apple is required by App Store rule 4.8** while Google or Microsoft is offered. The Back Office's Connexion tab warns while one is shown to Candidates without Apple. An organisation's own OIDC provider does not count, rule 4.8 exempting it.

## Considered Options

- **A universal link as the return address**: needs iOS 17.4; the app's floor is 16.4.
- **An ephemeral session**: asks for the password at every sign-in, for little privacy gain on the person's own phone.

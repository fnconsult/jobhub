---
kind: tutorial
audience: administrator
topic: equipe
title: Mandatory two-step verification and reset
synonyms: [two-step verification, passkey, two-factor, 2fa, mfa, mandatory, authenticator app, backup codes, reset, lost factor, lost phone, no factor, set up, magic link, sign-in provider, sso]
---
Two-step verification is mandatory for administrators, permanent super-admins (ADMIN_EMAILS) included, and for human coaches. After a magic link, an account with no factor yet sets it up before any other page: it can do nothing but set it up or sign out, in the app as in the extension. This applies from the next page to someone given a role or made a coach while signed in. Signing in through a sign-in provider (Google, Microsoft…) asks for no second step. In My account, « Security » section, these accounts have no « Turn off » button, and no « Remove » on a passkey that is their last factor.

In Administrators (Team menu), the « Two-step verification » column says « On » or « No factor ». An administrator with no factor can only be one who signs in through a sign-in provider.

For someone who lost their authenticator app, their passkeys and their backup codes, a super-admin resets their two-step verification:

1. Open Administrators (Team menu).
2. In « Reset two-step verification », enter the « Email address of the account ».
3. Tick « I confirm: this account's factors, backup codes and sessions will be deleted. »
4. Click « Reset two-step verification ». The page says the account's two-step verification is reset.

Their app, their passkeys, their backup codes and their sessions are deleted, and an email tells them. The next time they sign in by magic link, an administrator or a coach sets it up again. Each reset is recorded in Administrator actions: who, when and which account, never a code or a secret. Only super-admins see this page.

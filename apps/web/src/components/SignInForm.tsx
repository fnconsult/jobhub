"use client";

import { SIGN_IN_CODE_LENGTH, signInCodeRefusal, typedSignInCode, type SignInCodeRefusal } from "@jobhub/shared";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { Button } from "@/design/Button";
import { Field, TextInput } from "@/design/Field";
import { useHydrated } from "@/design/hydrated";
import { Note } from "@/design/Note";
import type { SignInButton } from "@/sign-in-providers/policy";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Passwordless sign-up / sign-in (ADR-0008): one of the Sign-in Providers the page offers, « ou », or a magic link
 * by email (#470: the Design System's buttons and field, its sent and failed states as Notes). `callbackURL` is where a signed-in person lands, `errorURL`
 * where a failed sign-in comes back (with `?error=`). Once the email is sent, its code (#686) may be typed instead.
 */
export function SignInForm({
  providers,
  callbackURL,
  errorURL,
  magicLink = true,
}: {
  providers: SignInButton[];
  callbackURL: string;
  errorURL: string;
  /** Off where a magic link would not do (Require SSO for Administrators): the providers alone. */
  magicLink?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  // Until the page is hydrated, the form is the browser's own: submitted, it would GET this page with the address in
  // its URL and send no email; a provider's button would do nothing. So they wait, disabled, as a person or a test does (#446).
  const hydrated = useHydrated();

  async function send(address: string): Promise<boolean> {
    // The page's language: a new account's sign-in email and Interface Language follow it (#570).
    const { error } = await authClient.signIn.magicLink({
      email: address,
      callbackURL,
      errorCallbackURL: errorURL,
      metadata: { language: i18n.language },
    });
    return !error;
  }

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setEmail(address);
    setStatus("sending");
    setStatus((await send(address)) ? "sent" : "error");
  }

  async function continueWith(provider: string) {
    const { error } = await authClient.signIn.social({ provider, callbackURL, errorCallbackURL: errorURL });
    if (error) setStatus("error");
  }

  if (status === "sent") return <EmailSent email={email} callbackURL={callbackURL} onResend={() => send(email)} />;

  return (
    <>
      {providers.map((provider) => (
        <Button key={provider.id} disabled={!hydrated} onClick={() => void continueWith(provider.id)}>
          {t("signIn.continueWith", { provider: provider.displayName })}
        </Button>
      ))}
      {magicLink && providers.length > 0 ? <p className="ds-sign-in__or">{t("signIn.or")}</p> : null}
      {magicLink ? (
        <form className="ds-sign-in__form" onSubmit={requestLink}>
          <Field label={t("signIn.emailLabel")}>
            <TextInput name="email" type="email" autoComplete="email" required />
          </Field>
          <Button variant="primary" type="submit" disabled={!hydrated} busy={status === "sending"}>
            {status === "sending" ? t("signIn.sending") : t("signIn.submit")}
          </Button>
        </form>
      ) : null}
      {status === "error" ? (
        <Note tone="danger" role="alert">
          {t("signIn.error")}
        </Note>
      ) : null}
    </>
  );
}

/**
 * The email sent: its Note, and the field for its code (#686), for a Candidate reading it on another device. A code
 * accepted signs in and goes on to `callbackURL` (the second step first, when the account has it: the proxy sends it
 * there, ADR-0075). A code refused offers a new email (`onResend`), which brings another code, and keeps offering it
 * (#755): Better Auth answers a code that no longer exists (spent by its link, by 5 wrong tries, replaced by a newer
 * email) as it answers a wrong one, `INVALID_OTP`, so the page cannot tell them apart.
 */
function EmailSent({ email, callbackURL, onResend }: { email: string; callbackURL: string; onResend: () => Promise<boolean> }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<SignInCodeRefusal | null>(null);
  const [resending, setResending] = useState(false);
  const [resendOffered, setResendOffered] = useState(false);

  async function enterCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecking(true);
    setRefusal(null);
    const { error } = await authClient.signIn.emailOtp({ email, otp: typedSignInCode(code) });
    if (!error) return window.location.assign(callbackURL);
    setRefusal(signInCodeRefusal(error.code));
    setResendOffered(true);
    setChecking(false);
  }

  async function resend() {
    setResending(true);
    const sent = await onResend();
    setResending(false);
    setCode("");
    setRefusal(sent ? null : "signIn.error");
  }

  return (
    <>
      <Note tone="success" role="status">
        {t("signIn.sent")}
      </Note>
      <form className="ds-sign-in__form" onSubmit={(event) => void enterCode(event)}>
        <Field label={t("signIn.codeLabel")} hint={t("signIn.codeHint")}>
          <TextInput
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={SIGN_IN_CODE_LENGTH + 2}
            spellCheck={false}
            required
          />
        </Field>
        {refusal ? (
          <Note tone="danger" role="alert">
            {t(refusal)}
          </Note>
        ) : null}
        <Button variant="primary" type="submit" busy={checking}>
          {checking ? t("signIn.codeChecking") : t("signIn.codeSubmit")}
        </Button>
        {resendOffered ? (
          <Button onClick={() => void resend()} busy={resending}>
            {resending ? t("signIn.sending") : t("signIn.resend")}
          </Button>
        ) : null}
      </form>
    </>
  );
}

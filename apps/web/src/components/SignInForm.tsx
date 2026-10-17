"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import type { SignInButton } from "@/sign-in-providers/policy";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Passwordless sign-up / sign-in (ADR-0008): a magic link by email, or one of the Sign-in
 * Providers the page offers. `callbackURL` is where a signed-in person lands, `errorURL`
 * where a failed sign-in comes back (with `?error=`).
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
  const { t } = useTranslation();
  const emailId = useId();
  const [status, setStatus] = useState<Status>("idle");

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setStatus("sending");
    const { error } = await authClient.signIn.magicLink({ email, callbackURL, errorCallbackURL: errorURL });
    setStatus(error ? "error" : "sent");
  }

  async function continueWith(provider: string) {
    const { error } = await authClient.signIn.social({ provider, callbackURL, errorCallbackURL: errorURL });
    if (error) setStatus("error");
  }

  if (status === "sent") {
    return (
      <p className="notice" role="status">
        {t("signIn.sent")}
      </p>
    );
  }

  return (
    <div className="stack">
      {magicLink ? (
        <form className="stack" onSubmit={requestLink}>
          <label htmlFor={emailId}>{t("signIn.emailLabel")}</label>
          <input id={emailId} className="input" name="email" type="email" autoComplete="email" required />
          <button className="button button-primary" type="submit" disabled={status === "sending"}>
            {status === "sending" ? t("signIn.sending") : t("signIn.submit")}
          </button>
        </form>
      ) : null}
      {status === "error" ? (
        <p className="notice" role="alert">
          {t("signIn.error")}
        </p>
      ) : null}
      {providers.length > 0 ? (
        <>
          {magicLink ? <p className="separator">{t("signIn.or")}</p> : null}
          {providers.map((provider) => (
            <button key={provider.id} className="button" type="button" onClick={() => void continueWith(provider.id)}>
              {t("signIn.continueWith", { provider: provider.displayName })}
            </button>
          ))}
        </>
      ) : null}
    </div>
  );
}

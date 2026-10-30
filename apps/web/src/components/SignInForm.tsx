"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { Button } from "@/design/Button";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import type { SignInButton } from "@/sign-in-providers/policy";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Passwordless sign-up / sign-in (ADR-0008): one of the Sign-in Providers the page offers, « ou », or a magic link
 * by email (#470: the Design System's buttons and field, its sent and failed states as Notes). `callbackURL` is where a signed-in person lands, `errorURL`
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
      <Note tone="success" role="status">
        {t("signIn.sent")}
      </Note>
    );
  }

  return (
    <>
      {providers.map((provider) => (
        <Button key={provider.id} onClick={() => void continueWith(provider.id)}>
          {t("signIn.continueWith", { provider: provider.displayName })}
        </Button>
      ))}
      {magicLink && providers.length > 0 ? <p className="ds-sign-in__or">{t("signIn.or")}</p> : null}
      {magicLink ? (
        <form className="ds-sign-in__form" onSubmit={requestLink}>
          <Field label={t("signIn.emailLabel")}>
            <TextInput name="email" type="email" autoComplete="email" required />
          </Field>
          <Button variant="primary" type="submit" busy={status === "sending"}>
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

"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { routes } from "@/routes";

type Status = "idle" | "sending" | "sent" | "error";

/** Passwordless sign-up / sign-in: magic link by email, or Google (ADR-0008). */
export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const { t } = useTranslation();
  const emailId = useId();
  const [status, setStatus] = useState<Status>("idle");

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setStatus("sending");
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: routes.account,
      errorCallbackURL: routes.signIn,
    });
    setStatus(error ? "error" : "sent");
  }

  async function continueWithGoogle() {
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: routes.account });
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
      <form className="stack" onSubmit={requestLink}>
        <label htmlFor={emailId}>{t("signIn.emailLabel")}</label>
        <input id={emailId} className="input" name="email" type="email" autoComplete="email" required />
        <button className="button button-primary" type="submit" disabled={status === "sending"}>
          {status === "sending" ? t("signIn.sending") : t("signIn.submit")}
        </button>
      </form>
      {status === "error" ? (
        <p className="notice" role="alert">
          {t("signIn.error")}
        </p>
      ) : null}
      {googleEnabled ? (
        <>
          <p className="separator">{t("signIn.or")}</p>
          <button className="button" type="button" onClick={continueWithGoogle}>
            {t("signIn.google")}
          </button>
        </>
      ) : null}
    </div>
  );
}

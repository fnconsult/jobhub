"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { routes } from "@/routes";
import type { SignInButton } from "@/sign-in-providers/policy";

/**
 * How the Candidate signs in: the magic link to their account's address (shown above it), the Sign-in Providers
 * linked to their account, and those they may link. Linking, signed in, is how an
 * account gets a provider not trusted for linking.
 */
export function SignInMethods({ linked, linkable, failed }: { linked: SignInButton[]; linkable: SignInButton[]; failed: boolean }) {
  const { t } = useTranslation();
  const [error, setError] = useState(failed);

  async function link(provider: string) {
    setError(false);
    const result = await authClient.linkSocial({ provider, callbackURL: routes.accountSignIn, errorCallbackURL: routes.accountSignIn });
    if (result.error) setError(true);
  }

  return (
    <section className="stack" aria-labelledby="sign-in-methods-title">
      <h2 id="sign-in-methods-title">{t("signInMethods.title")}</h2>
      <ul>
        <li>{t("signInMethods.magicLink")}</li>
        {linked.map((provider) => (
          <li key={provider.id}>{t("signInMethods.linked", { provider: provider.displayName })}</li>
        ))}
      </ul>
      {linkable.length > 0 ? (
        <div className="stack">
          <p>{t("signInMethods.linkHelp")}</p>
          {linkable.map((provider) => (
            <button key={provider.id} className="button" type="button" onClick={() => void link(provider.id)}>
              {t("signInMethods.link", { provider: provider.displayName })}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="notice" role="alert">
          {t("signInMethods.failed")}
        </p>
      ) : null}
    </section>
  );
}

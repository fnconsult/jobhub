"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { routes } from "@/routes";
import type { SignInButton } from "@/sign-in-providers/policy";

/** The Section's title's id, which names its Card. */
const TITLE_ID = "sign-in-methods-title";

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
    <Card title={t("signInMethods.title")} headingId={TITLE_ID}>
      <div className="stack">
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
            <button key={provider.id} className={buttonClass()} type="button" onClick={() => void link(provider.id)}>
              {t("signInMethods.link", { provider: provider.displayName })}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <Note tone="danger" role="alert">
          {t("signInMethods.failed")}
        </Note>
      ) : null}
      </div>
    </Card>
  );
}

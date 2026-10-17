"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { routes } from "@/routes";

/**
 * Starts a test sign-in through a Sign-in Provider not enabled yet: the super-admin signs
 * in at the provider, and comes back to the Connexion section with the result. Nobody is
 * signed in, no account is created or linked.
 */
export function TestSignInButton({ providerId, displayName }: { providerId: string; displayName: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  async function test() {
    setFailed(false);
    const { error } = await authClient.signIn.social({
      provider: providerId,
      callbackURL: routes.adminSignInProviders,
      errorCallbackURL: `${routes.adminSignInProviders}?testFailed=${encodeURIComponent(providerId)}`,
    });
    if (error) setFailed(true);
  }

  return (
    <>
      <button className="button" type="button" onClick={() => void test()}>
        {t("admin.signInProviders.test", { name: displayName })}
      </button>
      {failed ? (
        <p className="notice" role="alert">
          {t("admin.signInProviders.testNotStarted", { name: displayName })}
        </p>
      ) : null}
    </>
  );
}

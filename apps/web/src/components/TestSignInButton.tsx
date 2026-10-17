"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { routes } from "@/routes";
import { TEST_SIGN_IN } from "@/sign-in-providers/catalog";

/**
 * Starts a test sign-in through a Sign-in Provider not enabled yet: `start` (a server action)
 * registers it for a few minutes and issues a nonce; the super-admin signs in at the provider
 * and comes back, with the nonce, to the Connexion section with the result. Nobody is signed
 * in, no account is created or linked.
 */
export function TestSignInButton({
  providerId,
  displayName,
  start,
}: {
  providerId: string;
  displayName: string;
  start: (providerId: string) => Promise<{ nonce: string } | { error: string }>;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  async function test() {
    setFailed(false);
    const started = await start(providerId);
    if (!("nonce" in started)) return setFailed(true);
    const { error } = await authClient.signIn.social({
      provider: providerId,
      additionalData: { [TEST_SIGN_IN]: started.nonce },
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

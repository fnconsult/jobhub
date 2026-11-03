"use client";

import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { PasskeySecondStep } from "./PasskeySecondStep";
import { SecondStepCodeForm } from "./SecondStepCodeForm";
import { useSignOut } from "./SignOutButton";

/**
 * The second step's page's form (ADR-0075): « Utiliser une clé d'accès » first when the account has one (#664), the
 * code (the app's, or a backup code), then on to `back`; or signing out, the one other way out.
 */
export function SecondStepPage({ back, locale, passkey, app }: { back: string; locale: string; passkey: boolean; app: boolean }) {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const done = () => window.location.assign(back);
  return (
    <div className="stack">
      {passkey ? (
        <>
          <p>{t("twoStep.passkeys.intro")}</p>
          <PasskeySecondStep locale={locale} onDone={done} />
        </>
      ) : null}
      <SecondStepCodeForm choice app={app} locale={locale} autoFocus={!passkey} onDone={done} />
      <p>
        <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" onClick={() => void signOut()}>
          {t("twoStep.secondStep.signOut")}
        </button>
      </p>
    </div>
  );
}

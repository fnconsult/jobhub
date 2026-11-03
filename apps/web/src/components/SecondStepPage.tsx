"use client";

import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import type { PendingStep } from "@/two-step-verification/pending-sessions";
import { SETUP_ENDPOINT } from "@/two-step-verification/gate";
import { PasskeySecondStep } from "./PasskeySecondStep";
import { SecondStepCodeForm } from "./SecondStepCodeForm";
import { useSignOut } from "./SignOutButton";
import { TwoStepSetup } from "./TwoStepSetup";

/**
/**
 * The second step's page's form (ADR-0075): « Utiliser une clé d'accès » first when the account has one (#664), the
 * code (the app's, or a backup code), then on to `back`; or signing out, the one other way out. For an Administrator
 * or a Human Coach with no factor yet (`step` "setup", #665), setting up an authenticator app instead.
 */
export function SecondStepPage({ step, back, locale, passkey, app }: { step: PendingStep; back: string; locale: string; passkey: boolean; app: boolean }) {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const goOn = () => window.location.assign(back);
  return (
    <div className="stack">
      {step === "setup" ? (
        <div className="stack" data-two-step-setup>
          <p>{t("twoStep.setup.intro")}</p>
          <TwoStepSetup endpoint={SETUP_ENDPOINT} onDone={goOn} />
        </div>
      ) : (
        <>
          {passkey ? (
            <>
              <p>{t("twoStep.passkeys.intro")}</p>
              <PasskeySecondStep locale={locale} onDone={goOn} />
            </>
          ) : null}
          <SecondStepCodeForm choice app={app} locale={locale} autoFocus={!passkey} onDone={goOn} />
        </>
      )}
      <p>
        <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" onClick={() => void signOut()}>
          {t("twoStep.secondStep.signOut")}
        </button>
      </p>
    </div>
  );
}

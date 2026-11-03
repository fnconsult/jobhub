"use client";

import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import type { PendingStep } from "@/two-step-verification/pending-sessions";
import { SETUP_ENDPOINT } from "@/two-step-verification/gate";
import { SecondStepCodeForm } from "./SecondStepCodeForm";
import { useSignOut } from "./SignOutButton";
import { TwoStepSetup } from "./TwoStepSetup";

/**
 * The second step's page's form (ADR-0075): the code, then on to `back`; or signing out, the one other way out. For
 * an Administrator or a Human Coach with no factor yet (`step` "setup", #665), setting up an authenticator app instead.
 */
export function SecondStepPage({ step, back, locale }: { step: PendingStep; back: string; locale: string }) {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const goOn = () => window.location.assign(back);
  return (
    <div className="stack">
      {step === "setup" ? (
        <>
          <p>{t("twoStep.setup.intro")}</p>
          <TwoStepSetup endpoint={SETUP_ENDPOINT} onDone={goOn} />
        </>
      ) : (
        <SecondStepCodeForm choice locale={locale} onDone={goOn} />
      )}
      <p>
        <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" onClick={() => void signOut()}>
          {t("twoStep.secondStep.signOut")}
        </button>
      </p>
    </div>
  );
}

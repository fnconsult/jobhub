"use client";

import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { SecondStepCodeForm } from "./SecondStepCodeForm";
import { useSignOut } from "./SignOutButton";

/** The second step's page's form (ADR-0075): the code, then on to `back`; or signing out, the one other way out. */
export function SecondStepPage({ back, locale }: { back: string; locale: string }) {
  const { t } = useTranslation();
  const signOut = useSignOut();
  return (
    <div className="stack">
      <SecondStepCodeForm choice locale={locale} onDone={() => window.location.assign(back)} />
      <p>
        <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" onClick={() => void signOut()}>
          {t("twoStep.secondStep.signOut")}
        </button>
      </p>
    </div>
  );
}

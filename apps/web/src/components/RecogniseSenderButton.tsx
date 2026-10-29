"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isSharedSendingPlatform } from "@/email-intake/recognised-senders";
import { routes } from "@/routes";

/**
 * « C'est une alerte d'offres » on an email ignored as from an unrecognised sender (#450): one click recognises its
 * sender's domain for the Candidate alone, from its next email. A shared sending platform's domain is not enough: the
 * Candidate is led to paste the full sending address on « Réception par email ».
 */
export function RecogniseSenderButton({ domain, recognised = false }: { domain: string; recognised?: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "working" | "added" | "error" | "already_recognised">(recognised ? "added" : "idle");

  if (isSharedSendingPlatform(domain)) {
    return (
      <Link className="props-action" href={routes.accountEmailIntake} title={t("receivedByEmail.ignored.pasteAddressHint")}>
        {t("receivedByEmail.ignored.pasteAddress")}
      </Link>
    );
  }
  if (state === "added") return <span role="status">{t(recognised ? "receivedByEmail.ignored.recognisedAlready" : "receivedByEmail.ignored.recognised")}</span>;
  if (state === "already_recognised") {
    return (
      <span role="status">
        {t("emailIntake.recognised.errors.already_recognised")} <Link href={routes.accountEmailIntake}>{t("emailIntake.title")}</Link>
      </span>
    );
  }

  async function recognise() {
    setState("working");
    try {
      const response = await fetch("/api/account/email-intake/recognised-senders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sender: domain }),
      });
      if (response.status === 400 && ((await response.json()) as { error: string }).error === "already_recognised") return setState("already_recognised");
      setState(response.ok ? "added" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button className="button" type="button" disabled={state === "working"} aria-label={t("receivedByEmail.ignored.recogniseLabel", { domain })} onClick={() => void recognise()}>
        {t("receivedByEmail.ignored.recognise")}
      </button>
      {state === "error" ? (
        <span className="field-error" role="alert">
          {t("emailIntake.recognised.errors.error")}
        </span>
      ) : null}
    </>
  );
}

"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";

/**
 * The Candidate's EU AI consent (ADR-0007 amendment): with it, the AI calls carrying their
 * identity go to Mistral, an EU AI provider. Given or withdrawn explicitly; shown with its date.
 */
export function EuAiConsentForm({ givenAt: initial, locale }: { givenAt: Date | null; locale: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [givenAt, setGivenAt] = useState(initial);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(give: boolean) {
    setWorking(true);
    setFailed(false);
    try {
      const response = await fetch("/api/account/eu-ai-consent", { method: give ? "PUT" : "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      setGivenAt(give ? new Date(((await response.json()) as { givenAt: string }).givenAt) : null);
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }

  const date = givenAt ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(givenAt) : null;
  return (
    <Card title={t("euAiConsent.title")} headingId={`${id}-title`}>
      <div className="stack">
        <p>{t("euAiConsent.explanation")}</p>
        <p role="status" className="account-status">
          {date ? <Pill tone="success">{t("euAiConsent.givenOn", { date })}</Pill> : <Pill>{t("euAiConsent.notGiven")}</Pill>}
        </p>
        <div className="actions">
          {givenAt ? (
            <button className={buttonClass()} type="button" disabled={working} onClick={() => void change(false)}>
              {t("euAiConsent.withdraw")}
            </button>
          ) : (
            <button className={buttonClass({ variant: "primary" })} type="button" disabled={working} onClick={() => void change(true)}>
              {t("euAiConsent.give")}
            </button>
          )}
        </div>
        {failed ? (
          <Note tone="danger" role="alert">
            {t("euAiConsent.error")}
          </Note>
        ) : null}
      </div>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Checkbox } from "@/design/Field";
import { Note } from "@/design/Note";
import { versionDay } from "@/public-pages/days";
import { routes } from "@/routes";

/**
 * The Acceptance screen's form (ADR-0062, #510): the CGU version to accept, with a link to it, and a box the Candidate
 * ticks (never ticked for them) before « Accepter et continuer ». Accepted, they go `back` to the page they asked for.
 * In English, the translation says the French text prevails. Their data and subscription stay a link away.
 */
export function AcceptanceForm({ cgu, locale, back }: { cgu: { version: string; url: string }; locale: string; back: string }) {
  const { t } = useTranslation();
  const [ticked, setTicked] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const date = versionDay(cgu.version, locale);

  async function accept(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setFailed(false);
    try {
      const response = await fetch("/api/account/acceptances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "cgu", version: cgu.version, accepted: true }),
      });
      if (response.status === 409) return window.location.reload();
      if (!response.ok) throw new Error(String(response.status));
      window.location.assign(back);
    } catch {
      setFailed(true);
      setWorking(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void accept(event)}>
      {locale !== "fr" ? <Note>{t("legal.translation")}</Note> : null}
      <p>
        <a href={cgu.url} target="_blank" rel="noopener">
          {t("acceptance.read", { date })}
        </a>
      </p>
      <Checkbox label={t("acceptance.box", { date })} checked={ticked} onChange={(event) => setTicked(event.target.checked)} required />
      <div className="actions">
        <button className={buttonClass({ variant: "primary" })} type="submit" disabled={!ticked || working}>
          {working ? t("acceptance.sending") : t("acceptance.submit")}
        </button>
      </div>
      {failed ? (
        <Note tone="danger" role="alert">
          {t("acceptance.error")}
        </Note>
      ) : null}
      <p>
        {t("acceptance.meanwhile")} <Link href={routes.accountData}>{t("acceptance.data")}</Link>
        {t("acceptance.meanwhileSubscription")} <Link href={routes.subscription}>{t("acceptance.subscription")}</Link>
        {t("acceptance.meanwhileEnd")}
      </p>
    </form>
  );
}

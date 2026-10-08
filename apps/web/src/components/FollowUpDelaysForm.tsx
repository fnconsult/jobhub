"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FollowUpDelays } from "@/follow-ups";

/** The Candidate's Follow-up Delays: how many working days before the AI Coach proposes a Follow-up. */
export function FollowUpDelaysForm({ initial, max }: { initial: FollowUpDelays; /** Longest delay allowed. */ max: number }) {
  const { t } = useTranslation();
  const id = useId();
  const [afterApplied, setAfterApplied] = useState(String(initial.afterApplied));
  const [afterFollowUp, setAfterFollowUp] = useState(String(initial.afterFollowUp));
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<"saved" | "invalid" | "error" | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setOutcome(null);
    try {
      const response = await fetch("/api/follow-up-delays", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ afterApplied, afterFollowUp }),
      });
      setOutcome(response.ok ? "saved" : response.status === 400 ? "invalid" : "error");
    } catch {
      setOutcome("error");
    } finally {
      setWorking(false);
    }
  }

  const invalid = outcome === "invalid" ? true : undefined;
  const appliedId = `${id}-after-applied`;
  const followUpId = `${id}-after-follow-up`;
  const field = (inputId: string, label: string, value: string, change: (value: string) => void) => (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className="input"
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        step={1}
        required
        value={value}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        onChange={(event) => change(event.target.value)}
      />
    </div>
  );

  return (
    <section className="stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("followUps.delaysTitle")}</h2>
      <form className="stack" onSubmit={save} noValidate>
        <p id={`${id}-hint`} className="hint">
          {t("followUps.delaysHint", { max })}
        </p>
        {field(appliedId, t("followUps.afterApplied"), afterApplied, setAfterApplied)}
        {field(followUpId, t("followUps.afterFollowUp"), afterFollowUp, setAfterFollowUp)}
        <button className="button button-primary" type="submit" disabled={working}>
          {t("followUps.saveDelays")}
        </button>
        {outcome === "saved" ? <p role="status">{t("followUps.delaysSaved")}</p> : null}
        {outcome === "invalid" || outcome === "error" ? (
          <p className="field-error" role="alert">
            {outcome === "invalid" ? t("followUps.delaysInvalid", { max }) : t("followUps.delaysError")}
          </p>
        ) : null}
      </form>
    </section>
  );
}

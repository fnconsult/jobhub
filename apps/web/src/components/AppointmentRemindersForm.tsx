"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The Candidate's Appointment Reminders: the email the day before their Agenda Items, at 18:00
 * French time. On by default; switched off or on again here, saved as soon as it changes (shown at
 * once, put back when it could not be saved).
 */
export function AppointmentRemindersForm({ enabled: initial }: { enabled: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [enabled, setEnabled] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: boolean) {
    setEnabled(next);
    setWorking(true);
    setFailed(false);
    setSaved(false);
    try {
      const response = await fetch("/api/account/appointment-reminders", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setSaved(true);
    } catch {
      setEnabled(!next);
      setFailed(true);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("appointmentReminder.settings.title")}</h2>
      <div className="checkbox-field">
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={enabled}
          disabled={working}
          aria-describedby={`${id}-explanation`}
          onChange={(event) => void change(event.target.checked)}
        />
        <label htmlFor={`${id}-enabled`}>{t("appointmentReminder.settings.label")}</label>
        <p id={`${id}-explanation`} className="hint">
          {t("appointmentReminder.settings.explanation")}
        </p>
      </div>
      <p role="status">{saved ? t(enabled ? "appointmentReminder.settings.on" : "appointmentReminder.settings.off") : ""}</p>
      {failed ? (
        <p className="field-error" role="alert">
          {t("appointmentReminder.settings.error")}
        </p>
      ) : null}
    </section>
  );
}

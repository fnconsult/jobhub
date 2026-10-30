"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/design/Card";
import { Checkbox } from "@/design/Field";
import { Note } from "@/design/Note";

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
    <Card title={t("appointmentReminder.settings.title")} headingId={`${id}-title`}>
      <div className="stack">
        <Checkbox
          label={t("appointmentReminder.settings.label")}
          hint={t("appointmentReminder.settings.explanation")}
          checked={enabled}
          disabled={working}
          onChange={(event) => void change(event.target.checked)}
        />
        <p role="status" className="account-status">
          {saved ? t(enabled ? "appointmentReminder.settings.on" : "appointmentReminder.settings.off") : ""}
        </p>
        {failed ? (
          <Note tone="danger" role="alert">
            {t("appointmentReminder.settings.error")}
          </Note>
        ) : null}
      </div>
    </Card>
  );
}

"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/design/Card";
import { Switch } from "@/design/Field";
import { Note } from "@/design/Note";
import { PUSH_EVENTS, type PushAudience, type PushEvent } from "@/push-notifications/catalog";

const GROUP_TITLE = { candidate: "pushNotifications.settings.candidateEvents", human_coach: "pushNotifications.settings.coachEvents" } as const satisfies Record<PushAudience, string>;

/**
 * The app's Push notifications in Mon compte's Rappels Section (#698, ADR-0076), beside the Appointment Reminder by email,
 * which stays the default: one switch per event the person sees (a Human Coach's own too), each on until switched off,
 * saved as soon as it changes (shown at once, put back when it could not be saved). Also how many devices the app
 * registered: none until the person lets the app notify them.
 */
export function PushNotificationsForm({ events, settings: initial, devices }: { events: readonly PushEvent[]; settings: Record<PushEvent, boolean>; devices: number }) {
  const { t } = useTranslation();
  const id = useId();
  const [settings, setSettings] = useState(initial);
  const [working, setWorking] = useState<PushEvent | null>(null);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(event: PushEvent, enabled: boolean) {
    setSettings((current) => ({ ...current, [event]: enabled }));
    setWorking(event);
    setSaved(false);
    setFailed(false);
    try {
      const response = await fetch("/api/account/push-notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ event, enabled }) });
      if (!response.ok) throw new Error(String(response.status));
      setSaved(true);
    } catch {
      setSettings((current) => ({ ...current, [event]: !enabled }));
      setFailed(true);
    } finally {
      setWorking(null);
    }
  }

  const groups = (["candidate", "human_coach"] as const)
    .map((audience) => ({ audience, events: PUSH_EVENTS.filter((event) => event.audience === audience && events.includes(event.id)).map((event) => event.id) }))
    .filter((group) => group.events.length > 0);

  return (
    <Card title={t("pushNotifications.settings.title")} headingId={`${id}-title`}>
      <div className="stack">
        <p>{t("pushNotifications.settings.explanation")}</p>
        <p className="account-status">{t("pushNotifications.settings.devices", { count: devices })}</p>
        {groups.map((group) => (
          <fieldset key={group.audience} className="fieldset">
            <legend>{t(GROUP_TITLE[group.audience])}</legend>
            {group.events.map((event) => (
              <Switch key={event} label={t(`pushNotifications.events.${event}`)} checked={settings[event]} disabled={working !== null} onCheckedChange={(enabled) => void change(event, enabled)} />
            ))}
          </fieldset>
        ))}
        <p role="status" className="account-status">
          {saved ? t("pushNotifications.settings.saved") : ""}
        </p>
        {failed ? (
          <Note tone="danger" role="alert">
            {t("pushNotifications.settings.error")}
          </Note>
        ) : null}
      </div>
    </Card>
  );
}

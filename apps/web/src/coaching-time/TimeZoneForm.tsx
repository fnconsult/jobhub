"use client";
import { COACHING_DEFAULT_ZONE, coachingTimeZone } from "@jobhub/shared/coaching-time";
import { useRouter } from "next/navigation";
import { useSyncExternalStore, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";

const INPUT_NAME = "timeZone";
const noSubscription = () => () => {};
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const defaultZone = () => COACHING_DEFAULT_ZONE;
/** No browser guess is silently saved: first visit offers the device's zone for confirmation. */
export function TimeZoneForm({ value, coach = false }: { value: string | null; coach?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const device = useSyncExternalStore(noSubscription, deviceZone, defaultZone);
  const [edited, setZone] = useState<string | null>(null);
  const zone = edited ?? value ?? (coach ? COACHING_DEFAULT_ZONE : device);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const changeZone = (next: string) => { setZone(next); setStatus("idle"); };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!coachingTimeZone(zone)) { setStatus("failed"); return; }
    setStatus("saving");
    const response = await fetch(coach ? "/api/coach-space/time-zone" : "/api/account/coaching-time-zone", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ timeZone: zone }) }).catch(() => null);
    setStatus(response?.ok ? "saved" : "failed");
    if (response?.ok) router.refresh();
  }
  return <form className="stack" onSubmit={(event) => void save(event)}>
    <Field id={id} label={t("coachingTime.label")} hint={t("coachingTime.hint")}><TextInput name={INPUT_NAME} value={zone} onChange={(event) => changeZone(event.target.value)} required /></Field>
    <button type="submit" className="button" disabled={status === "saving"}>{t("coachingTime.save")}</button>
    {status === "saved" ? <Note tone="success" role="status">{t("account.saved")}</Note> : null}
    {status === "failed" ? <Note tone="danger" role="alert">{t("coachingTime.invalid")}</Note> : null}
  </form>;
}

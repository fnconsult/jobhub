"use client";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Button } from "@/design/Button";
import { Checkbox, Field, Select, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import type { Meeting } from "./meeting";
const VIDEO = "video",
  PHONE = "phone",
  CANDIDATE_CALLS = "candidate_calls",
  COACH_CALLS = "coach_calls";
export function MeetingForm({ initial, sessionId }: { initial: Meeting | null; sessionId?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState(initial?.kind ?? VIDEO);
  const [target, setTarget] = useState(initial?.target ?? "");
  const [direction, setDirection] = useState(initial?.kind === PHONE ? initial.direction : CANDIDATE_CALLS);
  const [confirmed, setConfirmed] = useState(initial?.kind === VIDEO ? initial.confirmed : false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus("saving");
    const response = await fetch("/api/coach-space/contact", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, meeting: { kind, target, direction, confirmed } }),
    }).catch(() => null);
    setStatus(response?.ok ? "saved" : "failed");
    if (response?.ok) router.refresh();
  }
  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <Field id={`${id}-kind`} label={t("coachMeeting.kind")}>
        <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value={VIDEO}>{t("coachMeeting.video")}</option>
          <option value={PHONE}>{t("coachMeeting.phone")}</option>
        </Select>
      </Field>
      <Field id={`${id}-target`} label={t("coachMeeting.target")}>
        <TextInput value={target} onChange={(event) => setTarget(event.target.value)} required />
      </Field>
      {kind === PHONE ? (
        <Field id={`${id}-direction`} label={t("coachMeeting.direction")}>
          <Select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}>
            <option value={CANDIDATE_CALLS}>{t("coachMeeting.candidateCallsOption")}</option>
            <option value={COACH_CALLS}>{t("coachMeeting.coachCallsOption")}</option>
          </Select>
        </Field>
      ) : (
        <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} label={t("coachMeeting.confirmHost")} />
      )}
      <Button variant="primary" type="submit" disabled={status === "saving"}>
        {t("coachMeeting.save")}
      </Button>
      {status === "saved" ? (
        <Note tone="success" role="status">
          {t("account.saved")}
        </Note>
      ) : null}
      {status === "failed" ? (
        <Note tone="danger" role="alert">
          {t("coachMeeting.invalid")}
        </Note>
      ) : null}
    </form>
  );
}

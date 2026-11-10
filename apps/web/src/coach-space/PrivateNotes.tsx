"use client";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Textarea } from "@/design/Field";

/** Serial, debounced, optimistic saves: a stale browser never overwrites another tab's notes. */
export function PrivateNotes({ candidateId, sessionId, initial }: { candidateId: string; sessionId?: string; initial: { text: string; revision: number } }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState(initial.text);
  const [saved, setSaved] = useState(initial.text);
  const [revision, setRevision] = useState(initial.revision);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed" | "conflict">("idle");
  useEffect(() => {
    if (text === saved || status === "saving" || status === "failed" || status === "conflict") return;
    const timer = setTimeout(async () => {
      setStatus("saving");
      const response = await fetch(`/api/coach-space/candidates/${encodeURIComponent(candidateId)}/notes`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, revision, sessionId: sessionId ?? null }),
      }).catch(() => null);
      const body = response?.ok ? await response.json().catch(() => null) : null;
      if (body?.note) {
        setRevision(body.note.revision);
        setSaved(text);
        setStatus("saved");
      } else setStatus(response?.status === 409 ? "conflict" : "failed");
    }, 600);
    return () => clearTimeout(timer);
  }, [text, saved, revision, status, candidateId, sessionId]);
  const change = (value: string) => {
    setText(value);
    if (status !== "saving") setStatus("idle");
  };
  return (
    <div className="stack">
      <Field id={id} label={t("coachWorkspace.notes")} hint={t("coachWorkspace.notesExport")}>
        <Textarea value={text} maxLength={20_000} onChange={(event) => change(event.target.value)} />
      </Field>
      <p role={status === "failed" || status === "conflict" ? "alert" : "status"}>{t(`coachWorkspace.noteStatus.${status}`)}</p>
    </div>
  );
}

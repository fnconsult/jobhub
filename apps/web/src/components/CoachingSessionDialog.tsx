"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Drawer } from "@/design/Drawer";
import type { SessionEditor } from "@/human-coaches";
import type { FieldError } from "@/validation";

/** A Coaching Session's date and where it takes place, as its form starts from. */
export interface CoachingSessionFields {
  id: string;
  /** Its date and time as typed in French time ("2026-11-12T14:30"); empty while unscheduled. */
  scheduledAt: string;
  durationMinutes: number | null;
  videoLink: string | null;
  note: string | null;
}

/** Where each editor saves (ADR-0027): the Candidate on their own sessions, the Human Coach on theirs, from the Coach space. */
const ENDPOINT: Record<SessionEditor, (id: string) => string> = {
  candidate: (id) => `/api/coaching/sessions/${id}`,
  coach: (id) => `/api/coach-space/sessions/${id}`,
};

/** What the button reads while the session is unscheduled, per editor. */
const ENTER_DATE = {
  candidate: { text: "coachingSession.enterDate", label: "coachingSession.enterDateFor" },
  coach: { text: "coachingSession.coachEnterDate", label: "coachingSession.coachEnterDateFor" },
} as const;

/**
 * Enters or edits a Coaching Session's date, booked on the Human Coach's Cal.com page (ADR-0027): a
 * button opening a Drawer (#462) with its date and time in French time, duration and
 * video link, and, for the Candidate, their note. `editor` says who: the Candidate (the default) or
 * the Human Coach, from the Coach space, who never sees or changes the note. Unscheduled, the button
 * reads « J'ai réservé : saisir la date » (the coach's: « Saisir la date »); dated, « Modifier la
 * date ». Its accessible name starts with that text and names `withName` (the Human Coach for the
 * Candidate, the Candidate for the coach), so that several sessions' buttons are told apart. Saved, it
 * closes and the page refreshes.
 */
export function CoachingSessionDialog({
  session,
  withName,
  editor = "candidate",
  className = "button",
}: {
  session: CoachingSessionFields;
  withName: string;
  editor?: SessionEditor;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unscheduled = session.scheduledAt === "";
  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button className={className} type="button" aria-label={t(unscheduled ? ENTER_DATE[editor].label : "coachingSession.editFor", { name: withName })}>
          {t(unscheduled ? ENTER_DATE[editor].text : "coachingSession.edit")}
        </button>
      }
      title={t("coachingSession.title", { name: withName })}
    >
      {/* Mounted on each opening, from the session as the page last read it. */}
      <CoachingSessionForm session={session} editor={editor} onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </Drawer>
  );
}

/** What to say under each field the app refused. */
const ERROR_MESSAGES = {
  scheduledAt: "coachingSession.invalidDate",
  durationMinutes: "coachingSession.invalidDuration",
  videoLink: "coachingSession.invalidVideoLink",
  note: "coachingSession.invalidNote",
} as const;
type Field = keyof typeof ERROR_MESSAGES;

function CoachingSessionForm({
  session,
  editor,
  onSaved,
  onCancel,
}: {
  session: CoachingSessionFields;
  editor: SessionEditor;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [scheduledAt, setScheduledAt] = useState(session.scheduledAt);
  const [durationMinutes, setDurationMinutes] = useState(session.durationMinutes === null ? "" : String(session.durationMinutes));
  const [videoLink, setVideoLink] = useState(session.videoLink ?? "");
  const [note, setNote] = useState(session.note ?? "");
  const [working, setWorking] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setFailed(false);
    let response: Response | null = null;
    try {
      // A datetime-local value ("2026-11-12T14:30") is French time: the app reads it so.
      const fields = { scheduledAt, durationMinutes: durationMinutes.trim() === "" ? null : Number(durationMinutes), videoLink };
      response = await fetch(ENDPOINT[editor](session.id), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editor === "candidate" ? { ...fields, note } : fields),
      });
    } catch {
      response = null;
    }
    setWorking(false);
    if (response?.ok) {
      onSaved();
      router.refresh();
      return;
    }
    const result: { errors?: FieldError[] } = response ? await response.json().catch(() => ({})) : {};
    if (Array.isArray(result.errors)) setErrors(result.errors);
    else setFailed(true);
  }

  /** The error under `field`, if the app refused it. */
  function errorOf(field: Field) {
    const error = errors.find((candidate) => candidate.field === field);
    if (!error) return null;
    return { id: `${id}-${field}-error`, text: t(field === "scheduledAt" && error.code === "required" ? "coachingSession.requiredDate" : ERROR_MESSAGES[field]) };
  }

  const dateError = errorOf("scheduledAt");
  const durationError = errorOf("durationMinutes");
  const videoLinkError = errorOf("videoLink");
  const noteError = errorOf("note");
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={`${id}-date`}>{t("coachingSession.date")}</label>
        <input
          id={`${id}-date`}
          className="input"
          type="datetime-local"
          required
          value={scheduledAt}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={dateError?.id}
          onChange={(event) => setScheduledAt(event.target.value)}
        />
        {dateError ? (
          <p id={dateError.id} className="field-error">
            {dateError.text}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor={`${id}-duration`}>{t("coachingSession.duration")}</label>
        <input
          id={`${id}-duration`}
          className="input"
          type="number"
          inputMode="numeric"
          min={5}
          max={600}
          step={5}
          value={durationMinutes}
          aria-invalid={durationError ? true : undefined}
          aria-describedby={durationError?.id}
          onChange={(event) => setDurationMinutes(event.target.value)}
        />
        {durationError ? (
          <p id={durationError.id} className="field-error">
            {durationError.text}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor={`${id}-video`}>{t("coachingSession.videoLink")}</label>
        <p id={`${id}-video-hint`} className="hint">
          {t("coachingSession.videoLinkHint")}
        </p>
        <input
          id={`${id}-video`}
          className="input"
          type="url"
          inputMode="url"
          maxLength={500}
          value={videoLink}
          aria-invalid={videoLinkError ? true : undefined}
          aria-describedby={[`${id}-video-hint`, videoLinkError?.id].filter(Boolean).join(" ")}
          onChange={(event) => setVideoLink(event.target.value)}
        />
        {videoLinkError ? (
          <p id={videoLinkError.id} className="field-error">
            {videoLinkError.text}
          </p>
        ) : null}
      </div>
      {editor === "candidate" ? (
        <div className="field">
          <label htmlFor={`${id}-note`}>{t("coachingSession.note")}</label>
          <textarea
            id={`${id}-note`}
            className="input"
            rows={3}
            maxLength={500}
            value={note}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError?.id}
            onChange={(event) => setNote(event.target.value)}
          />
          {noteError ? (
            <p id={noteError.id} className="field-error">
              {noteError.text}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="actions">
        <button className="button button-primary" type="submit" disabled={working}>
          {working ? t("coachingSession.working") : t("coachingSession.save")}
        </button>
        <button className="button" type="button" disabled={working} onClick={onCancel}>
          {t("coachingSession.cancel")}
        </button>
      </div>
      {failed ? (
        <p className="field-error" role="alert">
          {t("coachingSession.error")}
        </p>
      ) : null}
    </form>
  );
}

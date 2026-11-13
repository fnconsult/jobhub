"use client";

import { useRouter } from "next/navigation";
import { coachingSessionOver } from "@jobhub/shared/coaching-time";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { send } from "@/components/ApplicationControls";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";

/**
 * « Annuler » for an Agenda Item: an Interview (it stays, struck through) or a Coaching Session (back to
 * « À planifier »). It asks first, in place: `question` says what cancelling does, then « Oui, annuler »
 * posts to `url` and the page refreshes, or « Non, garder » goes back. `label` is the button's text and
 * `name` its accessible name, naming the item so that several buttons are told apart. Focus moves to the
 * question's first answer, and back to the button when the Candidate keeps the item. `tooLate`, when given, is what a
 * « too_late » refusal says, in a Note (a session that ended while the page was open, #1022). With `session`, the
 * Coaching Session cancelled, it says so only once that session has ended (#1026): before, « too_late » is the
 * cancellation policy's 24 hours (#883) and keeps its own text.
 */
export function CancelAgendaItemButton({
  url,
  label,
  name,
  question,
  tooLate: tooLateText,
  session,
}: {
  url: string;
  label: string;
  name: string;
  question: string;
  tooLate?: string;
  session?: { scheduledAt: string; durationMinutes: number | null };
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  /** A « too_late » refusal: "over" when `tooLateText` tells it (the session has ended), else the 24 hours. */
  const [tooLate, setTooLate] = useState<false | "over" | "window">(false);
  const button = useRef<HTMLButtonElement>(null);

  async function cancel() {
    setWorking(true);
    setFailed(false);
    const { ok, result } = await send(url, "POST");
    const refusedTooLate = !ok && result.error === "too_late";
    const over = Boolean(tooLateText) && (!session || coachingSessionOver(session, new Date()));
    setTooLate(refusedTooLate ? (over ? "over" : "window") : false);
    setWorking(false);
    if (ok) {
      setAsking(false);
      router.refresh();
    } else setFailed(true);
  }

  function keep() {
    setAsking(false);
    setFailed(false);
    // Back to the button once it is shown again.
    requestAnimationFrame(() => button.current?.focus());
  }

  if (!asking)
    return (
      <button ref={button} className={buttonClass()} type="button" aria-label={name} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <div className="cancel-confirm" role="group" aria-labelledby={`${id}-question`}>
      <p id={`${id}-question`}>{question}</p>
      <div className="actions">
        {/* The question replaces the button the Candidate just pressed: focus goes to its first answer. */}
        <button className={buttonClass({ variant: "primary" })} type="button" onClick={cancel} disabled={working} autoFocus>
          {working ? t("agendaChanges.working") : t("agendaChanges.confirm")}
        </button>
        <button className={buttonClass()} type="button" onClick={keep} disabled={working}>
          {t("agendaChanges.keep")}
        </button>
      </div>
      {failed && tooLate === "over" ? (
        <Note tone="warn" role="alert">
          {tooLateText}
        </Note>
      ) : failed ? (
        <p className="field-error" role="alert">
          {t(tooLate ? "coachingCancellation.tooLate" : "agendaChanges.error")}
        </p>
      ) : null}
    </div>
  );
}

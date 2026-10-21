"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { send } from "@/components/ApplicationControls";

/**
 * « Annuler » for an Agenda Item: an Interview (it stays, struck through) or a Coaching Session (back to
 * « À planifier »). It asks first, in place: `question` says what cancelling does, then « Oui, annuler »
 * posts to `url` and the page refreshes, or « Non, garder » goes back. `label` is the button's text and
 * `name` its accessible name, naming the item so that several buttons are told apart. Focus moves to the
 * question's first answer, and back to the button when the Candidate keeps the item.
 */
export function CancelAgendaItemButton({ url, label, name, question }: { url: string; label: string; name: string; question: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  async function cancel() {
    setWorking(true);
    setFailed(false);
    const { ok } = await send(url, "POST");
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
      <button ref={button} className="button" type="button" aria-label={name} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  return (
    <div className="cancel-confirm" role="group" aria-labelledby={`${id}-question`}>
      <p id={`${id}-question`}>{question}</p>
      <div className="actions">
        {/* The question replaces the button the Candidate just pressed: focus goes to its first answer. */}
        <button className="button button-primary" type="button" onClick={cancel} disabled={working} autoFocus>
          {working ? t("agendaChanges.working") : t("agendaChanges.confirm")}
        </button>
        <button className="button" type="button" onClick={keep} disabled={working}>
          {t("agendaChanges.keep")}
        </button>
      </div>
      {failed ? (
        <p className="field-error" role="alert">
          {t("agendaChanges.error")}
        </p>
      ) : null}
    </div>
  );
}

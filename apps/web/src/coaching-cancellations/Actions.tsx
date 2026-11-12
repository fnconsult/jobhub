"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Button } from "@/design/Button";
import { Field, Textarea } from "@/design/Field";
import { Note } from "@/design/Note";
import type { PeerOffer } from "./index";
/** The Candidate's three choices after a coach cancels. */
const REFUND = "refund",
  SAME = "same",
  PEER = "peer";
export function CancellationChoices({ id, peers }: { id: string; peers: PeerOffer[] }) {
  const { t, i18n } = useTranslation(),
    router = useRouter();
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  async function choose(choice: string, peerCoachId?: string) {
    setWorking(true);
    setError("");
    const response = await fetch(`/api/coaching/cancellations/${id}/choice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ choice, peerCoachId }),
    }).catch(() => null);
    setWorking(false);
    if (response?.ok) router.refresh();
    else setError(t("coachingCancellation.error"));
  }
  const money=(amount:number,currency:string)=>new Intl.NumberFormat(i18n.language,{style:"currency",currency}).format(amount/100);
  return (
    <div className="stack">
      <div className="actions">
        <Button type="button" disabled={working} onClick={() => void choose(REFUND)}>
          {t("coachingCancellation.refund")}
        </Button>
        <Button type="button" disabled={working} onClick={() => void choose(SAME)}>
          {t("coachingCancellation.same")}
        </Button>
      </div>
      <h4>{t("coachingCancellation.peer")}</h4>
      <p>{t("coachingCancellation.peerExplanation")}</p>
      {peers.length ? (
        <ul className="stack">
          {peers.map((p) => (
            <li key={p.coachId}>
              <p>
                {p.name} · {money(p.amount,p.currency)} · {t("humanCoaches.sessionDuration",{count:p.durationMinutes})}
              </p>
              <p>{[...p.specialties, ...p.languages].join(" · ")}</p>
              <Button type="button" disabled={working} onClick={() => void choose(PEER, p.coachId)}>
                {t("coachingCancellation.choosePeer", { name: p.name })}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("coachingCancellation.noPeer")}</p>
      )}
      {error ? (
        <Note tone="danger" role="alert">
          {error}
        </Note>
      ) : null}
    </div>
  );
}
export function CoachCancel({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation(),
    router = useRouter();
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [key] = useState(() => crypto.randomUUID());
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError("");
    const response = await fetch(`/api/coach-space/sessions/${sessionId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, requestKey: key }),
    }).catch(() => null);
    setWorking(false);
    if (response?.ok) {
      setOpen(false);
      router.refresh();
    } else setError(t("coachingCancellation.error"));
  }
  return open ? (
    <form onSubmit={submit} className="stack">
      <Field label={t("coachingCancellation.reason")}>
        <Textarea required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p>{t("coachingCancellation.choices")}</p>
      <div className="actions">
        <Button variant="dangerSolid" type="submit" disabled={working || !reason.trim()}>
          {t("coachingCancellation.confirmCoach")}
        </Button>
        <Button type="button" disabled={working} onClick={() => setOpen(false)}>
          {t("coachingCancellation.keep")}
        </Button>
      </div>
      {error ? (
        <Note tone="danger" role="alert">
          {error}
        </Note>
      ) : null}
    </form>
  ) : (
    <Button variant="danger" type="button" onClick={() => setOpen(true)}>
      {t("coachingCancellation.cancelCoach")}
    </Button>
  );
}

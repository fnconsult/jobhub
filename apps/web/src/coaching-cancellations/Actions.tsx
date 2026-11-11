"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { PeerOffer } from "./index";
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
        <button className="button" disabled={working} onClick={() => void choose("refund")}>
          {t("coachingCancellation.refund")}
        </button>
        <button className="button" disabled={working} onClick={() => void choose("same")}>
          {t("coachingCancellation.same")}
        </button>
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
              <button className="button" disabled={working} onClick={() => void choose("peer", p.coachId)}>
                {t("coachingCancellation.choosePeer", { name: p.name })}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("coachingCancellation.noPeer")}</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
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
      <label>
        {t("coachingCancellation.reason")}
        <textarea required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p>{t("coachingCancellation.choices")}</p>
      <div className="actions">
        <button className="button" disabled={working || !reason.trim()}>
          {t("coachingCancellation.confirmCoach")}
        </button>
        <button className="button" type="button" disabled={working} onClick={() => setOpen(false)}>
          {t("coachingCancellation.keep")}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  ) : (
    <button className="button" onClick={() => setOpen(true)}>
      {t("coachingCancellation.cancelCoach")}
    </button>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Drawer } from "@/design/Drawer";
import type { SharedSource } from "./index";
/** Appears only while the Candidate has an active paid session in its reading window. */
export function ShareDocumentButton({ source }: { source: SharedSource }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [sessions, setSessions] = useState<{ id: string; coachName: string }[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/coaching/shared-reading", { signal: abort.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.sessions) setSessions(body.sessions);
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  async function show(sessionId: string) {
    const response = await fetch(`/api/coaching/shared-reading/${sessionId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source }),
    }).catch(() => null);
    if (response?.ok) router.push(`/coachs/seances/${sessionId}`);
    else setFailed(true);
  }
  if (!sessions.length) return null;
  return (
    <Drawer
      title={t("sharedReading.show")}
      trigger={
        <button className="button" type="button" aria-label={`${t("sharedReading.show")} · ${t(`sharedReading.sources.${source.kind}`)}`}>
          {t("sharedReading.show")}
        </button>
      }
    >
      <ul>
        {sessions.map((session) => (
          <li key={session.id}>
            <button className="button" type="button" onClick={() => void show(session.id)}>
              {session.coachName}
            </button>
          </li>
        ))}
      </ul>
      {failed ? <p role="alert">{t("sharedReading.failed")}</p> : null}
    </Drawer>
  );
}

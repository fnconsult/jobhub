"use client";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Button } from "@/design/Button";
import { Drawer } from "@/design/Drawer";
import { Note } from "@/design/Note";
import type { SharedSource } from "./index";
/** Appears only while the Candidate has an active paid session in its reading window. */
export function ShareDocumentButton({ source }: { source: SharedSource }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [sessions, setSessions] = useState<{ id: string; coachName: string }[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      let nextChangeAt: number | null = null;
      try {
        const response = await fetch("/api/coaching/shared-reading", { signal: abort.signal, cache: "no-store" });
        const body = response.ok ? await response.json() : null;
        if (!abort.signal.aborted) setSessions(body?.sessions ?? []);
        if (typeof body?.nextChangeAt === "string") nextChangeAt = Date.parse(body.nextChangeAt);
      } catch {
        if (!abort.signal.aborted) setSessions([]);
      }
      if (!abort.signal.aborted)
        timer = setTimeout(
          () => void read(),
          Math.min(60_000, nextChangeAt === null || !Number.isFinite(nextChangeAt) ? 60_000 : Math.max(100, nextChangeAt - Date.now() + 25)),
        );
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
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
        <Button type="button" aria-label={`${t("sharedReading.show")} · ${t(`sharedReading.sources.${source.kind}`)}`}>
          {t("sharedReading.show")}
        </Button>
      }
    >
      <ul className="stack">
        {sessions.map((session) => (
          <li key={session.id}>
            <Button variant="primary" type="button" onClick={() => void show(session.id)}>
              {session.coachName}
            </Button>
          </li>
        ))}
      </ul>
      {failed ? (
        <Note tone="danger" role="alert">
          {t("sharedReading.failed")}
        </Note>
      ) : null}
    </Drawer>
  );
}

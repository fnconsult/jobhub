"use client";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { MasterCvView } from "@/components/MasterCvView";
import { DocumentViewer } from "@/design/DocumentViewer";
import { FileUpload } from "@/design/FileUpload";
import { Field, Select } from "@/design/Field";
import { SHARED_PDF_MAX_BYTES, type SharedDocument, type SharedReadingState, type SharedSource } from "./index";
import "./shared-reading.css";
const UPLOAD_NAME = "pdf";
const PDF_RULES = { maxBytes: SHARED_PDF_MAX_BYTES, extensions: ["pdf"] };
/** One live read-only document. Position writes belong only to its current presenter. */
export function SharedReadingPanel({ sessionId, audience }: { sessionId: string; audience: "candidate" | "coach" }) {
  const { t } = useTranslation();
  const id = useId();
  const endpoint = `/api/coaching/shared-reading/${sessionId}`;
  const [state, setState] = useState<SharedReadingState | null>(null);
  const [read, setRead] = useState<{ id: string; document: SharedDocument } | null>(null);
  const [sources, setSources] = useState<{ source: SharedSource; title: string }[]>([]);
  const [chosen, setChosen] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPosition = useRef<{ page: number; scroll: number } | null>(null);
  const presenting = state?.presenter === audience;
  useEffect(() => {
    const events = new EventSource(`${endpoint}/events`);
    events.onmessage = (event) => {
      try {
        const body = JSON.parse(event.data);
        setState(body.state ?? null);
      } catch {
        setState(null);
      }
    };
    events.onerror = () => {
      setState(null);
    };
    return () => events.close();
  }, [endpoint]);
  useEffect(() => {
    if (!state?.id) return;
    const shareId = state.id;
    const title = state.document.title;
    const abort = new AbortController();
    fetch(`${endpoint}/document?share=${state.id}`, { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("gone");
        if (response.headers.get("content-type")?.includes("application/pdf")) return { kind: "pdf" as const, title };
        return (await response.json()) as SharedDocument;
      })
      .then((document) => setRead({ id: shareId, document }))
      .catch(() => {
        if (!abort.signal.aborted) setRead(null);
      });
    return () => abort.abort();
  }, [endpoint, state?.id, state?.document.title]);
  useEffect(() => {
    if (audience !== "candidate") return;
    const abort = new AbortController();
    fetch(endpoint, { signal: abort.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (body?.sources) setSources(body.sources);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [audience, endpoint]);
  useEffect(() => {
    sequence.current = Math.max(sequence.current, state?.sequence ?? 0);
  }, [state?.id, state?.sequence]);
  useEffect(() => {
    const element = region.current;
    if (element && !presenting && state) element.scrollTop = state.scroll * Math.max(0, element.scrollHeight - element.clientHeight);
  }, [presenting, state, read]);
  useEffect(
    () => () => {
      if (positionTimer.current) clearTimeout(positionTimer.current);
      positionTimer.current = null;
      pendingPosition.current = null;
    },
    [state?.id, presenting],
  );
  const move = useCallback(
    (position: { page: number; scroll: number }) => {
      if (!presenting || !state) return;
      pendingPosition.current = position;
      if (positionTimer.current) return;
      const shareId = state.id;
      // Coalesce a burst, including its final keyboard/smooth-scroll event.
      positionTimer.current = setTimeout(() => {
        positionTimer.current = null;
        const latest = pendingPosition.current;
        if (!latest) return;
        sequence.current += 1;
        void fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "move", shareId, ...latest, sequence: sequence.current }),
        }).catch(() => {});
      }, 100);
    },
    [presenting, state, endpoint],
  );
  async function start(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: JSON.parse(chosen) }),
    }).catch(() => null);
    if (!response?.ok) setFailed(true);
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setFailed(false);
    const body = new FormData();
    body.set(UPLOAD_NAME, file);
    const response = await fetch(`${endpoint}/pdf`, { method: "POST", body }).catch(() => null);
    if (!response?.ok) setFailed(true);
  }
  async function stop() {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) }).catch(
      () => null,
    );
    if (response?.ok) {
      setState(null);
      setRead(null);
    } else setFailed(true);
  }
  const content = state?.id === read?.id ? read?.document : null;
  return (
    <section className="shared-reading stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("sharedReading.title")}</h2>
      <p>{t("sharedReading.private")}</p>
      {audience === "candidate" ? (
        <form className="stack" onSubmit={(event) => void start(event)}>
          <Field id={`${id}-source`} label={t("sharedReading.document")}>
            <Select value={chosen} onChange={(event) => setChosen(event.target.value)} required>
              <option value="">{t("sharedReading.choose")}</option>
              {sources.map(({ source, title }) => (
                <option key={`${source.kind}-${source.id}`} value={JSON.stringify(source)}>
                  {t(`sharedReading.sources.${source.kind}`)} · {title}
                </option>
              ))}
            </Select>
          </Field>
          <button className="button" type="submit" disabled={!chosen}>
            {t("sharedReading.show")}
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={(event) => void upload(event)}>
          <FileUpload
            name={UPLOAD_NAME}
            label={t("sharedReading.pdf")}
            prompt={t("sharedReading.pdfPrompt")}
            hint={t("sharedReading.pdfHint")}
            rules={PDF_RULES}
            problems={{ unsupported_format: t("sharedReading.badPdf"), too_large: t("sharedReading.tooLarge") }}
            onChange={setFile}
          />
          <button className="button" type="submit" disabled={!file}>
            {t("sharedReading.present")}
          </button>
        </form>
      )}
      {failed ? <p role="alert">{t("sharedReading.failed")}</p> : null}
      {state ? (
        <>
          <p role="status" aria-live="polite">
            {t("sharedReading.page", { page: state.page })}
          </p>
          <button className="button" type="button" onClick={() => void stop()}>
            {t("sharedReading.stop")}
          </button>
          {content?.kind === "pdf" ? (
            <DocumentViewer
              src={`${endpoint}/document?share=${state.id}`}
              fileName={content.title}
              readOnly
              position={!presenting ? { page: state.page, scroll: state.scroll } : undefined}
              onPositionChange={presenting ? move : undefined}
            />
          ) : content ? (
            <div
              ref={region}
              className="shared-reading-document"
              role="region"
              onCopy={(event) => event.preventDefault()}
              aria-label={t("sharedReading.document")}
              tabIndex={0}
              onScroll={(event) => {
                const element = event.currentTarget;
                move({
                  page: Math.floor(element.scrollTop / Math.max(1, element.clientHeight)) + 1,
                  scroll: element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight),
                });
              }}
            >
              {content.kind === "cv" ? <MasterCvView cv={content.content} t={t} /> : <p className="cv-text">{content.text}</p>}
            </div>
          ) : null}
        </>
      ) : (
        <p>{t("sharedReading.none")}</p>
      )}
    </section>
  );
}

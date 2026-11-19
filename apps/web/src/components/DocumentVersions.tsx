"use client";

import type { CvContent, DocumentLanguage } from "@jobhub/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { MAX_DOCUMENT_VERSIONS, type VersionedDocument, type VersionSource } from "@/tailored-documents/kinds";
import { MasterCvView } from "./MasterCvView";

/** A Tailored Document Version as it comes from the server, its date an ISO string. */
export interface DocumentVersionView {
  version: number;
  savedAt: string | Date;
  source: VersionSource;
  restoredFrom: number | null;
  current: boolean;
  language: DocumentLanguage;
  subject: string | null;
  text: string | null;
  cv: CvContent | null;
}

/** What a Restore gives back: every document's versions, and the documents as they now stand. */
export interface RestoredDocuments {
  versions: Record<VersionedDocument, DocumentVersionView[]>;
  drafts: unknown;
  tailoredCv: unknown;
}

type Loaded = { state: "closed" | "loading" | "failed" } | { state: "loaded"; versions: DocumentVersionView[] };

/**
 * « Versions » of one Tailored Document (#1079): a disclosure listing every version kept, newest first, each with its
 * date, where it came from and its Document Language, the current one said in words (« Version actuelle »), never by
 * colour alone. Opening one shows it read-only, with « Restaurer cette version » unless it is the current one or
 * `readOnly` (a Human Coach's Coach Access). A Restore saves it again as a new version: nothing is deleted.
 * Loaded from the server when opened, and again when `refreshKey` changes (a save, a new drafting); `initial` instead,
 * read-only, for a page that already has them.
 */
export function DocumentVersions({
  applicationId,
  document,
  locale,
  refreshKey,
  initial,
  readOnly = false,
  onRestored,
}: {
  applicationId: string;
  document: VersionedDocument;
  locale: string;
  refreshKey?: unknown;
  initial?: DocumentVersionView[];
  readOnly?: boolean;
  onRestored?: (restored: RestoredDocuments) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>(initial ? { state: "loaded", versions: initial } : { state: "closed" });
  const [shown, setShown] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [status, setStatus] = useState<{ kind: "restored"; from: number } | { kind: "failed" } | null>(null);
  const viewHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!open || initial) return;
    let cancelled = false;
    fetch(`/api/applications/${applicationId}/document-versions`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`versions: ${response.status}`);
        const all = (await response.json()) as Record<VersionedDocument, DocumentVersionView[]>;
        if (!cancelled) setLoaded({ state: "loaded", versions: all[document] ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, applicationId, document, refreshKey, initial]);

  useEffect(() => {
    if (shown !== null) viewHeading.current?.focus();
  }, [shown]);

  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
  const sourceOf = (version: DocumentVersionView) => {
    if (version.source === "restored")
      return version.restoredFrom === null ? t("documentVersions.sources.restoredEarlier") : t("documentVersions.sources.restored", { version: version.restoredFrom });
    if (version.source === "drafted" && document === "tailored_cv") return t("documentVersions.sources.draftedCv");
    return t(`documentVersions.sources.${version.source}`);
  };
  const versions = loaded.state === "loaded" ? loaded.versions : [];
  const opened = versions.find((version) => version.version === shown) ?? null;

  /** Opens or closes « Versions »; opened, they load (the list already there stays shown meanwhile). */
  function toggle() {
    if (!open && loaded.state !== "loaded") setLoaded({ state: "loading" });
    setOpen(!open);
  }

  async function restore(version: DocumentVersionView) {
    setRestoring(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/applications/${applicationId}/document-versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document, version: version.version }),
      });
      if (!response.ok) throw new Error(`restore: ${response.status}`);
      const restored = (await response.json()) as RestoredDocuments;
      setLoaded({ state: "loaded", versions: restored.versions[document] ?? [] });
      setShown(null);
      setStatus({ kind: "restored", from: version.version });
      onRestored?.(restored);
    } catch {
      setStatus({ kind: "failed" });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="document-versions stack">
      <button className={buttonClass({ size: "sm" })} type="button" aria-expanded={open} aria-controls={`${id}-versions`} onClick={toggle}>
        {t("documentVersions.toggle")}
      </button>
      <div id={`${id}-versions`} hidden={!open} className="stack">
        <p className="hint">{t("documentVersions.intro", { max: MAX_DOCUMENT_VERSIONS })}</p>
        {loaded.state === "loading" ? <p role="status">{t("documentVersions.loading")}</p> : null}
        {loaded.state === "failed" ? (
          <p className="field-error" role="alert">
            {t("documentVersions.loadError")}
          </p>
        ) : null}
        {loaded.state === "loaded" && versions.length === 0 ? <p>{t("documentVersions.none")}</p> : null}
        {versions.length > 0 ? (
          <ol className="version-list" aria-label={t("documentVersions.listLabel")}>
            {versions.map((version) => (
              <li key={version.version} className="version" aria-current={version.current ? "true" : undefined}>
                <p>
                  <strong>{t("documentVersions.version", { version: version.version })}</strong>
                  {version.current ? <span className="version-current"> · {t("documentVersions.current")}</span> : null}
                </p>
                <p>
                  {[dateFormat.format(new Date(version.savedAt)), sourceOf(version), t(`tailoredDocuments.languages.${version.language}`)].join(" · ")}
                </p>
                <button
                  className={buttonClass({ size: "sm", variant: "quiet" })}
                  type="button"
                  aria-pressed={shown === version.version}
                  aria-controls={`${id}-shown`}
                  onClick={() => setShown(shown === version.version ? null : version.version)}
                >
                  {t("documentVersions.open", { version: version.version })}
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        <div id={`${id}-shown`}>
          {opened ? (
            <section className="document-versions__shown stack" aria-labelledby={`${id}-shown-title`}>
              <h3 id={`${id}-shown-title`} ref={viewHeading} tabIndex={-1}>
                {t("documentVersions.readOnly", { version: opened.version })}
                {opened.current ? ` · ${t("documentVersions.current")}` : null}
              </h3>
              {opened.subject ? <p>{t("documentVersions.subject", { subject: opened.subject })}</p> : null}
              {opened.text !== null ? <p className="cv-text">{opened.text}</p> : null}
              {opened.cv ? <MasterCvView cv={opened.cv} t={t as never} /> : null}
              {readOnly || opened.current ? null : (
                <div className="actions">
                  <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" disabled={restoring} onClick={() => void restore(opened)}>
                    {restoring ? t("documentVersions.restoring") : t("documentVersions.restore")}
                  </button>
                </div>
              )}
              {readOnly || opened.current ? null : <p className="hint">{t("documentVersions.restoreHint")}</p>}
            </section>
          ) : null}
        </div>
        {status?.kind === "restored" ? <p role="status">{t("documentVersions.restored", { version: status.from })}</p> : null}
        {status?.kind === "failed" ? (
          <p className="field-error" role="alert">
            {t("documentVersions.restoreError")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import type { Activity } from "@jobhub/shared";
import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { Icons } from "@/components/icons";
import { fileKind, fileProblem, fileSize, type FileProblem, type FileRules } from "./file-upload";
import { Note } from "./Note";
import "./FileUpload.css";

/** The file being read once sent: its step's words (and glyph, when known) and the Stop, named for what it stops. */
export type FileReading = { label: string; activity?: Activity; stopLabel: string; onStop: () => void };

/**
 * The Design System's File upload (#468), wherever a file is sent (the CV first): a drop zone that lights up while a
 * file is dragged over it, or « Choisir un fichier »; then the chosen file's row (its badge, name and size, « Retirer »);
 * while the page reads it, its step beside the Activity glyph, a progress bar and Stop. A file the `rules` refuse is
 * never kept: a Note says why (`problems`), in the page's words. `error` is the page's own Note (the server's answer).
 * The file input stays in the form under `name`, a dropped file put in it, so the form sends whichever was chosen.
 * `children` goes under the drop zone (« Partir de zéro »).
 */
export function FileUpload({
  name,
  label,
  prompt,
  hint,
  rules,
  problems,
  accept,
  reading = null,
  error,
  onChange,
  children,
}: {
  name: string;
  /** The file input's name for assistive technologies (« Votre CV »). */
  label: string;
  /** The drop zone's invitation (« Glissez votre CV ici »). */
  prompt: string;
  /** What is accepted, in words (« Format PDF ou Word (.docx), 10 Mo maximum. »). */
  hint: string;
  rules: FileRules;
  problems: Record<FileProblem, ReactNode>;
  /** The input's `accept`; the rules' extensions when left out. */
  accept?: string;
  reading?: FileReading | null;
  error?: ReactNode;
  onChange?: (file: File | null) => void;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<FileProblem | null>(null);
  const [over, setOver] = useState(false);

  function choose(files: FileList | null, dropped: boolean) {
    const chosen = files?.[0] ?? null;
    if (!chosen) return;
    const refused = fileProblem(chosen, rules);
    setProblem(refused);
    if (refused) {
      if (input.current) input.current.value = "";
      setFile(null);
      onChange?.(null);
      return;
    }
    // A dropped file goes in the input, so the form sends it as a picked one.
    if (dropped && input.current && files) {
      try {
        input.current.files = files;
      } catch {
        // A browser that cannot set them: the page still has the file through onChange.
      }
    }
    setFile(chosen);
    onChange?.(chosen);
  }

  function remove() {
    if (input.current) input.current.value = "";
    setFile(null);
    setProblem(null);
    onChange?.(null);
    input.current?.focus();
  }

  const dragging = (event: DragEvent) => {
    event.preventDefault();
    if (!over) setOver(true);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (!reading) choose(event.dataTransfer?.files ?? null, true);
  };

  const kind = file ? fileKind(file.name) : null;
  return (
    <div className="ds-upload">
      <input
        ref={input}
        id={id}
        className="ds-upload__input"
        type="file"
        name={name}
        aria-label={label}
        aria-describedby={`${id}-hint`}
        accept={accept ?? rules.extensions.map((extension) => `.${extension}`).join(",")}
        disabled={Boolean(reading)}
        onChange={(event) => choose(event.currentTarget.files, false)}
      />
      {file ? (
        <div className="ds-upload__file" data-reading={reading ? true : undefined}>
          <FileBadge kind={kind} />
          <div className="ds-upload__name">
            <strong>{file.name}</strong>
            {reading ? (
              <span className="ds-upload__step">
                {reading.activity ? <ActivityGlyph activity={reading.activity} live /> : null}
                {reading.label}
              </span>
            ) : (
              <span className="ds-upload__meta">{fileSize(file.size, i18n.language)}</span>
            )}
          </div>
          {reading ? (
            <button className="ds-upload__stop" type="button" aria-label={reading.stopLabel} title={reading.stopLabel} onClick={reading.onStop}>
              <span aria-hidden />
            </button>
          ) : (
            <button className="ds-upload__remove" type="button" aria-label={t("designSystem.upload.remove", { name: file.name })} onClick={remove}>
              <Icons.close />
            </button>
          )}
          {reading ? (
            <div className="ds-upload__progress" role="progressbar" aria-label={reading.label}>
              <span />
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="ds-upload__zone"
          data-drop-zone
          data-over={over || undefined}
          onDragEnter={dragging}
          onDragOver={dragging}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <span className="ds-upload__art" aria-hidden>
            <Icons.upload />
          </span>
          <strong>{prompt}</strong>
          <span className="ds-upload__meta">{t("designSystem.upload.or")}</span>
          <label className="ds-button ds-button--primary" htmlFor={id}>
            {t("designSystem.upload.choose")}
          </label>
          <span className="ds-upload__meta" id={`${id}-hint`}>
            {hint}
          </span>
        </div>
      )}
      {file ? (
        <span className="ds-upload__hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {problem ? (
        <Note tone="danger" role="alert">
          {problems[problem]}
        </Note>
      ) : error ? (
        <Note tone="danger" role="alert">
          {error}
        </Note>
      ) : null}
      {children}
    </div>
  );
}

const OTHER = "other";

/** A file's badge: PDF or DOCX on a page with its corner turned down; a plain page for any other file. */
export function FileBadge({ kind, small = false }: { kind: "pdf" | "docx" | null; small?: boolean }) {
  return (
    <span className="ds-file-badge" data-kind={kind ?? OTHER} data-small={small || undefined} aria-hidden />
  );
}

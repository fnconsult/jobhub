"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { inlineCommit } from "./inline-edit";

/** What saving one inline-edit value came to: saved, or the message to show. */
export type InlineSaveResult = { ok: true } | { ok: false; message: string };

type Notice = { kind: "saved" } | { kind: "error"; message: string } | null;

/**
 * One value edited in place that saves on change (blur, Enter, or a new choice
 * in a select), the way the approved prototype (#132) edits a Profile's name and
 * Search Criteria. A required value left blank goes back to the saved one;
 * Escape puts the saved value back too. `save` gets the trimmed value and
 * never throws: a failure is a result with its message.
 */
export function useInlineEdit({ saved: initial, required, save }: { saved: string; required: boolean; save: (value: string) => Promise<InlineSaveResult> }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);

  async function commit(next: string = value) {
    switch (inlineCommit({ saved, value: next, required })) {
      case "unchanged":
        return;
      case "revert":
        setValue(saved);
        return;
      case "save": {
        setSaving(true);
        setNotice(null);
        const result = await save(next.trim());
        setSaving(false);
        if (result.ok) {
          setSaved(next.trim());
          setValue(next.trim());
          setNotice({ kind: "saved" });
        } else {
          setNotice({ kind: "error", message: result.message });
        }
      }
    }
  }

  return {
    value,
    saving,
    notice,
    /** Props for the input, textarea or select. */
    field: {
      value,
      className: "inline-edit",
      "aria-invalid": notice?.kind === "error" ? true : undefined,
      onChange: (event: { target: { value: string } }) => setValue(event.target.value),
      onFocus: () => setNotice(null),
      onBlur: () => void commit(),
    },
    /** For a single-line field: Enter saves, Escape puts the saved value back. */
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        (event.currentTarget as HTMLElement).blur();
      } else if (event.key === "Escape") {
        setValue(saved);
        setNotice(null);
      }
    },
    /** Props for a select, which saves as soon as the Candidate picks another option. */
    select: {
      value,
      className: "inline-edit",
      "aria-invalid": notice?.kind === "error" ? true : undefined,
      onFocus: () => setNotice(null),
      onChange: (event: { target: { value: string } }) => {
        setValue(event.target.value);
        void commit(event.target.value);
      },
    },
  };
}

/** The "… enregistré" flag after a save, or the problem with the value. */
export function InlineNotice({ notice, savedLabel, id }: { notice: Notice; savedLabel: string; id?: string }): ReactNode {
  return (
    <>
      <span className="saved-flag" role="status">
        {notice?.kind === "saved" ? savedLabel : ""}
      </span>
      {notice?.kind === "error" ? (
        <span className="field-error" role="alert" id={id}>
          {notice.message}
        </span>
      ) : null}
    </>
  );
}

/**
 * A textarea that grows with its text. `field-sizing: content` (app.css) does
 * it where supported; elsewhere (Firefox, older Safari) its height follows its
 * text, refitted on each change, once the fonts are in and when its width
 * changes (the lines wrap differently), as the approved prototype (#132) does.
 */
export function GrowingTextarea(props: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (ref.current && !growsByItself()) fitToText(ref.current);
  }, [props.value]);
  useEffect(() => {
    const textarea = ref.current;
    if (!textarea || growsByItself() || typeof ResizeObserver === "undefined") return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fitToText(textarea);
    });
    observer.observe(textarea);
    void document.fonts?.ready.then(() => textarea.isConnected && fitToText(textarea));
    return () => observer.disconnect();
  }, []);
  return <textarea ref={ref} {...props} />;
}

function growsByItself(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");
}

function fitToText(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  // border-box: the height takes in the borders, which scrollHeight leaves out.
  textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
}

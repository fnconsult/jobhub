"use client";

import { resolveTextSize } from "@jobhub/shared/design";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { browserOf } from "@/signalements/context";
import { DRAFT_TYPES, forgetDraft, keepDraft, keptDraft, type DraftType } from "@/signalements/draft";
import { MESSAGE_MAX_LENGTH, MESSAGE_MIN_LENGTH } from "@/signalements/values";
import { send } from "./ApplicationControls";
import { SIGNALEMENT_GLYPHS, signalementGlyph } from "./signalement-glyphs";

const SVG_NS = "http://www.w3.org/2000/svg";
const MORPH = "0.5s";

/**
 * The Signalement's entry point in the Sidebar's foot (#375, ADR-0009 amendment « the Signalement icon »): an icon alone, the bug, to the right of
 * « Mon compte », a 44 px target named « Signalement » with its tooltip on hover and focus. It never moves. It opens the
 * Signalement dialog (Radix, ADR-0018; centred, full screen on phones), and on close the focus comes back to it.
 * `version`: the Jobbbox version the dialog's detail shows (the server's, as the Signalement keeps it).
 */
export function SignalementButton({ version }: { version: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const message = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="signalement-open" type="button" aria-label={t("signalement.open")}>
        <svg className="icon signalement-glyph" viewBox="0 0 24 24" aria-hidden focusable={false}>
          <path d={SIGNALEMENT_GLYPHS.bug} />
        </svg>
        <span className="signalement-tip" aria-hidden>
          {t("signalement.open")}
        </span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content
          className="dialog signalement-dialog"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Into the message, the type already chosen.
            event.preventDefault();
            message.current?.focus();
          }}
        >
          <SignalementForm version={version} message={message} onClose={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type Problem = "tooShort" | "tooMany" | "failed";

/** The dialog's content, mounted on each opening from the kept draft. */
function SignalementForm({ version, message, onClose }: { version: string; message: RefObject<HTMLTextAreaElement | null>; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  // The draft kept from the last opening (signalements/draft): Esc, Annuler or a click outside keeps it.
  const [type, setType] = useState<DraftType>(() => keptDraft().type);
  const [text, setText] = useState(() => keptDraft().text);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const length = text.trim().length;

  useEffect(() => {
    if (sent) closeButton.current?.focus();
  }, [sent]);

  function changeType(next: DraftType) {
    keepDraft({ type: next, text });
    setType(next);
  }

  function changeText(next: string) {
    keepDraft({ type, text: next });
    setText(next);
    if (problem === "tooShort" && next.trim().length >= MESSAGE_MIN_LENGTH) setProblem(null);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (working) return;
    if (length < MESSAGE_MIN_LENGTH) {
      setProblem("tooShort");
      message.current?.focus();
      return;
    }
    setWorking(true);
    setProblem(null);
    const { ok, result } = await send("/api/signalements", "POST", { type, message: text, path: window.location.pathname, textSize: textSizeNow() });
    setWorking(false);
    if (ok) {
      forgetDraft();
      setSent(true);
      return;
    }
    const tooShort = Array.isArray(result.errors) && result.errors.some((error: { code?: string }) => error.code === "too_short");
    setProblem(result.error === "too_many" ? "tooMany" : tooShort ? "tooShort" : "failed");
    message.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  const title = (
    <Dialog.Title className="dialog-title signalement-title">
      <MorphingGlyph d={signalementGlyph(type)} />
      {t("signalement.title")}
    </Dialog.Title>
  );

  if (sent)
    return (
      <>
        {title}
        <div className="signalement-thanks" role="status">
          <p>
            <strong>{t("signalement.thanks")}</strong> {t("signalement.thanksDetail")}
          </p>
        </div>
        <div className="actions signalement-actions">
          <button ref={closeButton} className="button button-primary" type="button" onClick={onClose}>
            {t("signalement.close")}
          </button>
        </div>
      </>
    );

  const errorId = `${id}-error`;
  const countId = `${id}-count`;
  return (
    <form className="signalement-form" noValidate onSubmit={submit}>
      {title}
      <fieldset className="signalement-types">
        <legend className="visually-hidden">{t("signalement.typeLegend")}</legend>
        {DRAFT_TYPES.map((option) => (
          <label key={option} className="signalement-type">
            <input type="radio" name={`${id}-type`} value={option} checked={type === option} onChange={() => changeType(option)} />
            {t(`signalement.types.${option}`)}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-message`}>{t(`signalement.label.${type}`)}</label>
        <textarea
          ref={message}
          id={`${id}-message`}
          className="input"
          rows={6}
          value={text}
          maxLength={MESSAGE_MAX_LENGTH}
          placeholder={t(`signalement.placeholder.${type}`)}
          aria-invalid={problem === "tooShort" || undefined}
          aria-describedby={problem === "tooShort" ? `${errorId} ${countId}` : countId}
          onChange={(event) => changeText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="signalement-count">
          {problem === "tooShort" ? (
            <p id={errorId} className="field-error" role="alert">
              {t("signalement.tooShort", { min: MESSAGE_MIN_LENGTH })}
            </p>
          ) : (
            <span />
          )}
          <span id={countId} className="signalement-meta">
            {t("signalement.count", { count: length, max: MESSAGE_MAX_LENGTH })}
          </span>
        </div>
      </div>
      <div className="signalement-context">
        <p>
          {t("signalement.notice")}{" "}
          <button className="link-button" type="button" aria-expanded={detailOpen} aria-controls={`${id}-detail`} onClick={() => setDetailOpen(!detailOpen)}>
            {t(detailOpen ? "signalement.hideDetail" : "signalement.showDetail")}
          </button>
        </p>
        {detailOpen ? (
          <dl id={`${id}-detail`} className="signalement-detail">
            <dt>{t("signalement.detail.page")}</dt>
            <dd>{window.location.pathname}</dd>
            <dt>{t("signalement.detail.version")}</dt>
            <dd>{version}</dd>
            <dt>{t("signalement.detail.browser")}</dt>
            <dd>{browserOf(navigator.userAgent) ?? "—"}</dd>
            <dt>{t("signalement.detail.language")}</dt>
            <dd>{t(`languages.${i18n.language}`, { defaultValue: i18n.language })}</dd>
            <dt>{t("signalement.detail.textSize")}</dt>
            <dd>{t(`textSize.${textSizeNow()}`)}</dd>
          </dl>
        ) : null}
        <p className="signalement-meta">{t("signalement.readBy")}</p>
      </div>
      {problem === "tooMany" || problem === "failed" ? (
        <p className="field-error" role="alert">
          {t(problem === "tooMany" ? "signalement.tooMany" : "signalement.failed")}
        </p>
      ) : null}
      <div className="actions signalement-actions">
        <button className="button" type="button" onClick={onClose}>
          {t("signalement.cancel")}
        </button>
        <button className="button button-primary" type="submit" disabled={working}>
          {working ? t("signalement.sending") : t("signalement.send")}
        </button>
      </div>
    </form>
  );
}

/** The Text Size in use, as <html data-text-size> holds it (see TextSizeControl). */
const textSizeNow = () => resolveTextSize(document.documentElement.dataset.textSize).setting;

/**
 * The title's glyph, following the Signalement's type (#279, #375). When it changes it morphs, in MORPH, with SMIL
 * `<animate attributeName="d">`, once, never looping; the `<animate>` is added only after mount and only while
 * `prefers-reduced-motion: no-preference` matches, otherwise the glyph switches at once. Decoration: the title says it.
 */
function MorphingGlyph({ d }: { d: string }) {
  const path = useRef<SVGPathElement>(null);
  const shown = useRef(d);
  const motion = useMotionAllowed();

  useEffect(() => {
    const element = path.current;
    const from = shown.current;
    shown.current = d;
    if (!element || from === d) return;
    element.querySelectorAll("animate").forEach((animate) => animate.remove());
    if (!motion) return;
    const animate = document.createElementNS(SVG_NS, "animate");
    animate.setAttribute("attributeName", "d");
    animate.setAttribute("values", `${from};${d}`);
    animate.setAttribute("dur", MORPH);
    animate.setAttribute("calcMode", "spline");
    animate.setAttribute("keyTimes", "0;1");
    animate.setAttribute("keySplines", "0.65 0 0.35 1");
    animate.setAttribute("begin", "indefinite");
    animate.setAttribute("fill", "freeze");
    // Once played, the path rests on its own `d`, which React already set to the new glyph.
    animate.addEventListener("endEvent", () => animate.remove());
    element.appendChild(animate);
    (animate as SVGAnimationElement).beginElement();
  }, [d, motion]);

  return (
    <svg className="icon signalement-glyph" viewBox="0 0 24 24" aria-hidden focusable={false}>
      <path ref={path} d={d} />
    </svg>
  );
}

/** False on the server's render and the first one; then whether the Candidate's system lets things move, kept up to date. */
function useMotionAllowed(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const update = () => setAllowed(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return allowed;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CoachFocus } from "@/coach";
import { recentConversation, type CoachMessage } from "@/coach/conversation";

/** What a page shows, as the Coach Panel tells the Candidate and the AI Coach. */
export type InView = CoachFocus & { name: string };

const SetInView = createContext<(inView: InView | null) => void>(() => {});

/**
 * Declares the Profile or Application a page shows, so the Coach Panel (and
 * the AI Coach behind it) know what the Candidate has in view. Renders nothing;
 * does nothing outside a Coach Panel (signed-out pages).
 */
export function CoachInView({ kind, id, name }: InView) {
  const setInView = useContext(SetInView);
  useEffect(() => {
    setInView({ kind, id, name } as InView);
    return () => setInView(null);
  }, [setInView, kind, id, name]);
  return null;
}

type Status = "idle" | "sending" | "unavailable" | "invalid";

/**
 * The Coach Panel: the side panel, available from every page of a signed-in
 * Candidate, where they talk with the AI Coach. The conversation carries over
 * from page to page; each message goes with what the Candidate has in view.
 */
export function CoachPanel({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [inView, setInViewState] = useState<InView | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const toggle = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const setInView = useCallback((next: InView | null) => setInViewState(next), []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") close();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || status === "sending") return;
    const conversation: CoachMessage[] = [...messages, { from: "candidate", text }];
    setMessages(conversation);
    setDraft("");
    setStatus("sending");
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The AI Coach answers from the recent window; the panel keeps the whole conversation.
        body: JSON.stringify({ messages: recentConversation(conversation), ...(inView ? { focus: { kind: inView.kind, id: inView.id } } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body.reply === "string") {
        setMessages([...conversation, { from: "coach", text: body.reply }]);
        setStatus("idle");
      } else {
        // Give the Candidate their message back to retry or shorten it.
        setMessages(messages);
        setDraft(text);
        setStatus(body.error === "invalid" ? "invalid" : "unavailable");
      }
    } catch {
      setMessages(messages);
      setDraft(text);
      setStatus("unavailable");
    }
  }

  const inViewLabel = inView
    ? t("coachPanel.inView", {
        label: inView.kind === "profile" ? t("coachPanel.inViewProfile", { name: inView.name }) : t("coachPanel.inViewApplication", { name: inView.name }),
      })
    : t("coachPanel.nothingInView");

  return (
    <SetInView.Provider value={setInView}>
      <div className={open ? "with-coach-panel" : undefined}>{children}</div>
      {open ? (
        <aside id={`${id}-panel`} className="coach-panel" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
          <div className="coach-panel-header">
            <h2 id={`${id}-title`}>{t("coachPanel.title")}</h2>
            <button className="button" type="button" onClick={close}>
              {t("coachPanel.close")}
            </button>
          </div>
          <p className="coach-panel-in-view">{inViewLabel}</p>
          <ol className="chat coach-panel-messages" aria-live="polite">
            <li className="chat-message chat-coach">
              <span className="chat-author">{t("questionnaire.coach")}</span>
              <p>{t("coachPanel.welcome")}</p>
            </li>
            {messages.map((message, index) => (
              <li key={index} className={`chat-message ${message.from === "coach" ? "chat-coach" : "chat-candidate"}`}>
                <span className="chat-author">{message.from === "coach" ? t("questionnaire.coach") : t("questionnaire.you")}</span>
                <p>{message.text}</p>
              </li>
            ))}
          </ol>
          {status === "sending" ? (
            <p className="notice" role="status">
              {t("coachPanel.thinking")}
            </p>
          ) : null}
          {status === "unavailable" || status === "invalid" ? (
            <p className="notice" role="alert">
              {t(`coachPanel.errors.${status}`)}
            </p>
          ) : null}
          <form className="stack coach-panel-form" onSubmit={send}>
            <label htmlFor={`${id}-message`}>{t("coachPanel.messageLabel")}</label>
            <textarea
              id={`${id}-message`}
              ref={input}
              className="input"
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button className="button button-primary" type="submit" disabled={status === "sending"}>
              {t("coachPanel.send")}
            </button>
          </form>
        </aside>
      ) : null}
      <button
        ref={toggle}
        className="button button-primary coach-panel-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {t("coachPanel.open")}
      </button>
    </SetInView.Provider>
  );
}

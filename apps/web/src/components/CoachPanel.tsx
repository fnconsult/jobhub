"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CoachFocus } from "@/coach";
import type { CoachMessage } from "@/coach/conversation";
import { CoachConversationList, type ConversationSummary } from "@/components/CoachConversationList";
import { StartJobSearchButton } from "@/components/JobSearchControls";

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

/** This browser remembers which Coach Conversation was open, to reopen it after a reload. */
const OPEN_CONVERSATION_KEY = "jobhub.coachConversation";

function remember(conversationId: string | null) {
  try {
    if (conversationId) window.localStorage.setItem(OPEN_CONVERSATION_KEY, conversationId);
    else window.localStorage.removeItem(OPEN_CONVERSATION_KEY);
  } catch {
    // Storage blocked: the conversation is still saved, only not reopened by itself.
  }
}

function remembered(): string | null {
  try {
    return window.localStorage.getItem(OPEN_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

/** A saved Coach Conversation with its messages, or null when it is gone or cannot be read. */
async function fetchConversation(conversationId: string): Promise<{ conversation: ConversationSummary & { messages: CoachMessage[] } } | { gone: boolean }> {
  const response = await fetch(`/api/coach/conversations/${encodeURIComponent(conversationId)}`).catch(() => null);
  if (!response?.ok) return { gone: response?.status === 404 };
  return response.json();
}

/**
 * The Coach Panel: the side panel, available from every page of a signed-in
 * Candidate, where they talk with the AI Coach. Each exchange is saved in a
 * Coach Conversation, which carries over from page to page and reopens after a
 * reload; each message goes with what the Candidate has in view. The Candidate
 * starts new conversations and lists, reopens, renames or deletes saved ones.
 * With a Profile in view, the Candidate can also ask the AI Coach to search
 * for Job Offers for it.
 */
export function CoachPanel({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [inView, setInViewState] = useState<InView | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [view, setView] = useState<"chat" | "list">("chat");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [focusInput, setFocusInput] = useState(0);
  const restored = useRef(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const setInView = useCallback((next: InView | null) => setInViewState(next), []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, focusInput]);

  function openPanel() {
    setOpen(true);
    // The first time the panel opens, reopen the conversation this browser had open.
    if (restored.current) return;
    restored.current = true;
    const conversationId = remembered();
    if (!conversationId) return;
    setRestoring(true);
    void fetchConversation(conversationId).then((found) => {
      if ("conversation" in found) {
        const { messages: saved, ...summary } = found.conversation;
        setConversation(summary);
        setMessages(saved);
      } else if (found.gone) remember(null);
      setRestoring(false);
    });
  }

  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") close();
  }

  function showChat() {
    setView("chat");
    setFocusInput((n) => n + 1);
  }

  function startNewConversation() {
    setConversation(null);
    setMessages([]);
    setStatus("idle");
    remember(null);
    showChat();
  }

  async function showList() {
    setView("list");
    setConversations(null);
    setListFailed(false);
    const response = await fetch("/api/coach/conversations").catch(() => null);
    if (response?.ok) setConversations((await response.json()).conversations);
    else setListFailed(true);
  }

  async function openConversation(conversationId: string): Promise<boolean> {
    const found = await fetchConversation(conversationId);
    if (!("conversation" in found)) {
      if (found.gone) setConversations((list) => list?.filter((item) => item.id !== conversationId) ?? null);
      return false;
    }
    const { messages: saved, ...summary } = found.conversation;
    setConversation(summary);
    setMessages(saved);
    setStatus("idle");
    remember(summary.id);
    showChat();
    return true;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || status === "sending" || restoring) return;
    const shown: CoachMessage[] = [...messages, { from: "candidate", text }];
    setMessages(shown);
    setDraft("");
    setStatus("sending");
    const giveBack = (error: Status) => {
      // Give the Candidate their message back to retry or shorten it.
      setMessages(messages);
      setDraft(text);
      setStatus(error);
    };
    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The server holds the conversation: only the new message goes.
        body: JSON.stringify({
          ...(conversation ? { conversationId: conversation.id } : {}),
          message: text,
          ...(inView ? { focus: { kind: inView.kind, id: inView.id } } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body.reply === "string") {
        setConversation(body.conversation);
        remember(body.conversation.id);
        setMessages([...shown, { from: "coach", text: body.reply }]);
        setStatus("idle");
      } else if (response.status === 404) {
        // Deleted meanwhile (another tab, or kept past its 12 months): the message starts a new one.
        setConversation(null);
        remember(null);
        setMessages([]);
        setDraft(text);
        setStatus("unavailable");
      } else giveBack(body.error === "invalid" ? "invalid" : "unavailable");
    } catch {
      giveBack("unavailable");
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
          <div className="actions">
            {view === "chat" ? (
              <button className="button" type="button" onClick={showList}>
                {t("coachPanel.conversations")}
              </button>
            ) : (
              <button className="button" type="button" onClick={showChat}>
                {t("coachPanel.backToConversation")}
              </button>
            )}
            <button className="button" type="button" onClick={startNewConversation}>
              {t("coachPanel.newConversation")}
            </button>
          </div>
          {view === "list" ? (
            <CoachConversationList
              conversations={conversations}
              loadFailed={listFailed}
              onOpen={openConversation}
              onRenamed={(renamed) => {
                setConversations((list) => list?.map((item) => (item.id === renamed.id ? renamed : item)) ?? null);
                if (conversation?.id === renamed.id) setConversation(renamed);
              }}
              onDeleted={(deletedId) => {
                setConversations((list) => list?.filter((item) => item.id !== deletedId) ?? null);
                if (conversation?.id === deletedId) {
                  setConversation(null);
                  setMessages([]);
                  remember(null);
                }
              }}
            />
          ) : (
            <>
              <h3 className="coach-panel-conversation">{conversation ? conversation.title : t("coachPanel.newConversation")}</h3>
              <p className="coach-panel-in-view">{inViewLabel}</p>
              {inView?.kind === "profile" ? (
                <StartJobSearchButton key={inView.id} profileId={inView.id} label={t("coachPanel.searchJobs")} className="button" />
              ) : (
                <p className="hint">{t("coachPanel.searchHint")}</p>
              )}
              {restoring ? <p role="status">{t("coachPanel.loading")}</p> : null}
              <ol className="chat coach-panel-messages" aria-label={t("coachPanel.messagesLabel")} aria-live="polite">
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
                <button className="button button-primary" type="submit" disabled={status === "sending" || restoring}>
                  {t("coachPanel.send")}
                </button>
              </form>
            </>
          )}
        </aside>
      ) : null}
      <button
        ref={toggle}
        className="button button-primary coach-panel-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => (open ? close() : openPanel())}
      >
        {t("coachPanel.open")}
      </button>
    </SetInView.Provider>
  );
}

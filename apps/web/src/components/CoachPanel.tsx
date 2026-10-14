"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CoachFocus } from "@/coach";
import { coachReplyBlocks, type Inline } from "@/coach/reply-text";
import type { CoachMessage } from "@/coach/conversation";
import { CoachConversationList, type ConversationSummary } from "@/components/CoachConversationList";
import { CoachMemoryProposals, CoachMemoryView } from "@/components/CoachMemory";
import { Icons } from "@/components/icons";
import { StartJobSearchButton } from "@/components/JobSearchControls";

/**
 * What a page shows, as the Coach Panel tells the Candidate and the AI Coach.
 * `profileId`: the Profile a Job Search, Job Digest or Application page shows, so a
 * new Coach Conversation is attached to it and the AI Coach can search for it.
 */
export type InView = CoachFocus & { name: string; profileId?: string };

const SetInView = createContext<(inView: InView | null) => void>(() => {});

/** What a Coach Panel button needs: whether the panel is open, and a way to open or close it. */
type Control = {
  open: boolean;
  panelId: string;
  toggle: () => void;
  /** Each button registers itself, so closing the panel gives focus back to the one on screen. */
  register: (button: HTMLButtonElement | null) => (() => void) | undefined;
};

const CoachPanelControl = createContext<Control | null>(null);

/**
 * The button that opens and closes the Coach Panel. The sidebar layout puts
 * one in its top bar; every other page gets the floating one the Coach Panel
 * renders itself, hidden where a top bar has one (see app.css). Renders
 * nothing outside a Coach Panel (signed-out pages).
 */
export function CoachPanelToggle({ floating = false }: { floating?: boolean }) {
  const { t } = useTranslation();
  const control = useContext(CoachPanelControl);
  if (!control) return null;
  const { open, panelId, toggle, register } = control;
  return (
    <button
      ref={register}
      className={floating ? "button button-primary coach-panel-toggle coach-panel-toggle-floating" : "button coach-panel-toggle"}
      type="button"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={toggle}
    >
      <Icons.coach />
      {t("coachPanel.open")}
    </button>
  );
}

/**
 * Declares the Profile, Application, Job Offer, Job Search or Job Digest a page
 * shows, so the Coach Panel (and the AI Coach behind it) know what the Candidate
 * has in view. Renders nothing; does nothing outside a Coach Panel (signed-out pages).
 */
export function CoachInView({ kind, id, name, profileId }: InView) {
  const setInView = useContext(SetInView);
  useEffect(() => {
    setInView({ kind, id, name, ...(profileId ? { profileId } : {}) } as InView);
    return () => setInView(null);
  }, [setInView, kind, id, name, profileId]);
  return null;
}

/** The Profile in view, or the one the page in view shows. */
const profileIdOf = (inView: InView | null) => (inView?.kind === "profile" ? inView.id : inView?.profileId);

const IN_VIEW_LABEL = {
  profile: "coachPanel.inViewProfile",
  application: "coachPanel.inViewApplication",
  job_offer: "coachPanel.inViewJobOffer",
  job_search: "coachPanel.inViewJobSearch",
  job_digest: "coachPanel.inViewJobDigest",
} as const satisfies Record<InView["kind"], string>;

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

/** An AI Coach reply set as paragraphs, lists and bold or italic text, never raw Markdown (#164). */
function CoachReplyText({ text }: { text: string }) {
  const line = (inlines: Inline[]) =>
    inlines.map((part, i) => {
      let node: ReactNode = part.text;
      if (part.emphasis) node = <em>{node}</em>;
      if (part.strong) node = <strong>{node}</strong>;
      return <span key={i}>{node}</span>;
    });
  const lines = (list: Inline[][]) =>
    list.map((inlines, i) => (
      <span key={i}>
        {i > 0 ? <br /> : null}
        {line(inlines)}
      </span>
    ));
  return (
    <>
      {coachReplyBlocks(text).map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>{lines(block.lines)}</p>
        ) : block.ordered ? (
          <ol key={index} start={block.start}>
            {block.items.map((item, i) => (
              <li key={i}>{lines(item)}</li>
            ))}
          </ol>
        ) : (
          <ul key={index}>
            {block.items.map((item, i) => (
              <li key={i}>{lines(item)}</li>
            ))}
          </ul>
        ),
      )}
    </>
  );
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
  const [view, setView] = useState<"chat" | "list" | "memory">("chat");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [focusInput, setFocusInput] = useState(0);
  const restored = useRef(false);
  const toggles = useRef(new Set<HTMLButtonElement>());
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
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
    // The button on screen: the top bar's, or the floating one where there is no top bar.
    [...toggles.current].find((button) => button.getClientRects().length > 0)?.focus();
  }

  const register = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return undefined;
    toggles.current.add(button);
    return () => {
      toggles.current.delete(button);
    };
  }, []);

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

  // The latest message (or the "thinking" notice) comes into view when it arrives (#164).
  useEffect(() => {
    const element = body.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, status, view, open]);

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
          ...(inView ? { focus: { kind: inView.kind, id: inView.id, ...(inView.profileId ? { profileId: inView.profileId } : {}) } } : {}),
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
        label: t(IN_VIEW_LABEL[inView.kind], { name: inView.name }),
      })
    : t("coachPanel.nothingInView");

  const control: Control = { open, panelId: `${id}-panel`, toggle: () => (open ? close() : openPanel()), register };

  return (
    <SetInView.Provider value={setInView}>
      <CoachPanelControl.Provider value={control}>
        <div className={open ? "with-coach-panel" : undefined}>{children}</div>
        {open ? (
          <aside id={`${id}-panel`} className="coach-panel" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
            <div className="coach-panel-header">
              <h2 id={`${id}-title`}>{t("coachPanel.title")}</h2>
              <button className="button button-quiet" type="button" onClick={close}>
                <Icons.close />
                {t("coachPanel.close")}
              </button>
            </div>
            <div className="coach-panel-tools">
              {view === "chat" ? (
                <button className="button button-quiet" type="button" onClick={showList}>
                  <Icons.conversations />
                  {t("coachPanel.conversations")}
                </button>
              ) : (
                <button className="button button-quiet" type="button" onClick={showChat}>
                  {t("coachPanel.backToConversation")}
                </button>
              )}
              {view !== "memory" ? (
                <button className="button button-quiet" type="button" onClick={() => setView("memory")}>
                  {t("coachMemory.open")}
                </button>
              ) : null}
              <button className="button button-quiet" type="button" onClick={startNewConversation}>
                <Icons.add />
                {t("coachPanel.newConversation")}
              </button>
            </div>
            {view === "memory" ? (
              <div className="coach-panel-body">
                <CoachMemoryView />
              </div>
            ) : view === "list" ? (
              <div className="coach-panel-body">
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
              </div>
            ) : (
              <>
                <div className="coach-panel-context">
                  <h3 className="coach-panel-conversation">{conversation ? conversation.title : t("coachPanel.newConversation")}</h3>
                  <p className="coach-panel-in-view">{inViewLabel}</p>
                  {profileIdOf(inView) ? (
                    <StartJobSearchButton key={profileIdOf(inView)} profileId={profileIdOf(inView)!} label={t("coachPanel.searchJobs")} className="button" />
                  ) : (
                    <p className="hint">{t("coachPanel.searchHint")}</p>
                  )}
                </div>
                <div className="coach-panel-body" ref={body}>
                  {restoring ? <p role="status">{t("coachPanel.loading")}</p> : null}
                  <ol className="chat coach-panel-messages" aria-label={t("coachPanel.messagesLabel")} aria-live="polite">
                    <li className="chat-message chat-coach">
                      <span className="chat-author">{t("questionnaire.coach")}</span>
                      <p>{t("coachPanel.welcome")}</p>
                    </li>
                    {messages.map((message, index) => (
                      <li key={index} className={`chat-message ${message.from === "coach" ? "chat-coach" : "chat-candidate"}`}>
                        <span className="chat-author">{message.from === "coach" ? t("questionnaire.coach") : t("questionnaire.you")}</span>
                        {message.from === "coach" ? <CoachReplyText text={message.text} /> : <p>{message.text}</p>}
                      </li>
                    ))}
                  </ol>
                  {conversation ? <CoachMemoryProposals key={conversation.id} conversationId={conversation.id} /> : null}
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
                </div>
                <form className="coach-panel-form" onSubmit={send}>
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
        <CoachPanelToggle floating />
      </CoachPanelControl.Provider>
    </SetInView.Provider>
  );
}

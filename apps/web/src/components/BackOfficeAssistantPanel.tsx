"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ExplainedItem } from "@/back-office-assistant/conversation";
import type { CoachMessage } from "@/coach/conversation";
import { CoachConversationList, type ConversationSummary } from "@/components/CoachConversationList";
import { CoachReplyText } from "@/components/CoachReplyText";
import { fetchConversation } from "@/components/chat-conversation";
import { Icons } from "@/components/icons";
import { ProvenanceLine } from "@/components/ProvenanceLine";
import { buttonClass } from "@/design/Button";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { replyActivity, type Provenance } from "@jobhub/shared";

const SEND = "/api/admin/assistant";
const CONVERSATIONS = "/api/admin/assistant/conversations";
/** This browser remembers which conversation was open, to reopen it after a reload. */
const STORAGE_KEY = "jobhub.backOfficeAssistantConversation";
/** What differs from the Coach Conversations' list. */
const LIST_TEXTS = { retention: "backOfficeAssistant.retention", noConversations: "backOfficeAssistant.noConversations" } as const;
/** The menu opens under the conversation's title, from its start. */
const MENU_ALIGN = "start";

/** What the Back Office Assistant's button needs: whether the panel is open, and a way to open or close it. */
type Control = {
  open: boolean;
  panelId: string;
  toggle: () => void;
  /** Each button registers itself, so closing the panel gives focus back to the one on screen. */
  register: (button: HTMLButtonElement | null) => (() => void) | undefined;
  /** Opens the panel and sends `question`, with the item an Explainable label asks about (#407). */
  ask: (question: string, explained: ExplainedItem) => void;
};

const PanelControl = createContext<Control | null>(null);

/**
 * Asks the Back Office Assistant about an item, from an Explainable label (#407, ADR-0042): the panel opens and sends
 * `question` with `explained`, the item's context, in the conversation it has open. Null outside the Back Office.
 */
export function useAskAssistant(): ((question: string, explained: ExplainedItem) => void) | null {
  return useContext(PanelControl)?.ask ?? null;
}

/**
 * The button in the Back Office's Top Bar that opens the Back Office Assistant's panel. While the panel is open its
 * Fermer button closes it: the button steps aside (ADR-0024). Nothing outside the Back Office.
 */
export function BackOfficeAssistantToggle() {
  const { t } = useTranslation();
  const control = useContext(PanelControl);
  if (!control) return null;
  const { open, panelId, toggle, register } = control;
  if (open) return null;
  return (
    <button ref={register} className={`${buttonClass()} coach-panel-toggle`} type="button" aria-expanded={false} aria-controls={panelId} onClick={toggle}>
      <Icons.coach />
      {t("backOfficeAssistant.open")}
    </button>
  );
}

type Status = "idle" | "sending" | "unavailable" | "invalid";

/** A saved reply, as the server gives it back. */
type ReplyBody = { conversation: ConversationSummary; reply: string; blocked?: { message?: boolean; reply?: boolean }; provenance?: Provenance | null; at?: string };

function remember(conversationId: string | null) {
  try {
    if (conversationId) window.localStorage.setItem(STORAGE_KEY, conversationId);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the conversation is still saved, only not reopened by itself.
  }
}

function remembered(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The Back Office Assistant (#205): the side panel where an Administrator talks with the AI about the Back Office, the
 * Coach Panel of the Back Office alone since the Candidate's conversation became their page (ADR-0070, #608). Each
 * exchange is saved in the Administrator's own conversations, which carry over from page to page and reopen after a
 * reload; they start new ones and list, reopen, rename or delete saved ones. « Agrandir » widens it into a modal drawer
 * over the page (ADR-0024); an Explainable label asks it about its item (#407). Read-only: nothing in view goes with a
 * message, there is no Coach Memory.
 */
export function BackOfficeAssistantPanel({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [view, setView] = useState<"chat" | "list">("chat");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [focusInput, setFocusInput] = useState(0);
  // Agrandir: the panel widens into a modal drawer over the page (ADR-0024); never remembered.
  const [wide, setWide] = useState(false);
  const restored = useRef(false);
  const toggles = useRef(new Set<HTMLButtonElement>());
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const focusMoved = useRef(false);

  useEffect(() => {
    const box = input.current;
    if (!open || !box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [open, focusInput]);

  // The latest message (or the "thinking" notice) comes into view when it arrives (#164).
  useEffect(() => {
    const element = body.current;
    const end = messagesEnd.current;
    if (!element || !end) return;
    element.scrollTop += end.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
  }, [messages, status, view, open]);

  /** Opens the panel; the conversation it reopened the first time, once it is back (null when none came back). */
  async function openPanel(): Promise<{ conversation: ConversationSummary; messages: CoachMessage[] } | null> {
    setOpen(true);
    if (restored.current) return null;
    restored.current = true;
    const conversationId = remembered();
    if (!conversationId) return null;
    setRestoring(true);
    const found = await fetchConversation(CONVERSATIONS, conversationId);
    let reopened = null;
    if ("conversation" in found) {
      const { messages: saved, id, title, lastMessageAt } = found.conversation;
      const summary = { id, title, lastMessageAt };
      setConversation(summary);
      setMessages(saved);
      reopened = { conversation: summary, messages: saved };
    } else if (found.gone) remember(null);
    setRestoring(false);
    return reopened;
  }

  function close() {
    setOpen(false);
    setWide(false);
    // The Top Bar's button, once it is back (it steps aside while the panel is open).
    requestAnimationFrame(() => [...toggles.current].find((button) => button.getClientRects().length > 0)?.focus());
  }

  const register = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return undefined;
    toggles.current.add(button);
    return () => {
      toggles.current.delete(button);
    };
  }, []);

  // Escape brings a widened panel back beside the page first, then closes it.
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (wide) setWide(false);
    else close();
  }

  /** A menu item whose view takes the focus: the menu must not hand it back to its button. */
  function moveFocus(action: () => void) {
    focusMoved.current = true;
    action();
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
    const response = await fetch(CONVERSATIONS).catch(() => null);
    if (response?.ok) setConversations((await response.json()).conversations);
    else setListFailed(true);
  }

  async function openConversation(conversationId: string): Promise<boolean> {
    const found = await fetchConversation(CONVERSATIONS, conversationId);
    if (!("conversation" in found)) {
      if (found.gone) setConversations((list) => list?.filter((item) => item.id !== conversationId) ?? null);
      return false;
    }
    const { messages: saved, id, title, lastMessageAt } = found.conversation;
    const summary = { id, title, lastMessageAt };
    setConversation(summary);
    setMessages(saved);
    setStatus("idle");
    remember(summary.id);
    showChat();
    return true;
  }

  /**
   * An Explainable label's question (#407): sent at once, in the conversation open, or the one the panel reopens the
   * first time it opens. Nothing while a reply is on its way or a conversation is coming back: the label can be clicked again.
   */
  function ask(question: string, explained: ExplainedItem) {
    setView("chat");
    if (open) {
      if (status !== "sending" && !restoring) void sendMessage(question, explained);
      return;
    }
    void openPanel().then((reopened) => sendMessage(question, explained, reopened ?? undefined));
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft.trim());
  }

  /** Sends `text` (an Explainable label's question with its item, `explained`) and shows the reply. */
  async function sendMessage(text: string, explained?: ExplainedItem, reopened?: { conversation: ConversationSummary; messages: CoachMessage[] }) {
    if (!text || status === "sending" || (restoring && !reopened)) return;
    const { conversation: current, messages: before } = reopened ?? { conversation, messages };
    setMessages([...before, { from: "candidate", text }]);
    setDraft("");
    setStatus("sending");
    const giveBack = (error: Status) => {
      // Give the Administrator their message back to retry or shorten it.
      setMessages(before);
      setDraft(text);
      setStatus(error);
    };
    try {
      const response = await fetch(SEND, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The server holds the conversation: only the new message goes.
        body: JSON.stringify({ ...(current ? { conversationId: current.id } : {}), message: text, ...(explained ? { explained } : {}) }),
      });
      const reply = (await response.json().catch(() => ({}))) as Partial<ReplyBody> & { error?: string };
      if (response.ok && typeof reply.reply === "string" && reply.conversation) {
        setConversation(reply.conversation);
        remember(reply.conversation.id);
        // A Blocked message (#228): the Guardrail is never named, only that the message or the reply was blocked.
        const blocked = reply.blocked;
        setMessages([
          ...before,
          { from: "candidate", text, ...(blocked?.message ? { blocked: true as const } : {}) },
          {
            from: "coach",
            text: reply.reply,
            ...(blocked?.reply ? { blocked: true as const } : {}),
            ...(typeof reply.at === "string" ? { provenance: reply.provenance ?? null, at: reply.at } : {}),
          },
        ]);
        setStatus("idle");
      } else if (response.status === 404) {
        // Deleted meanwhile (another tab, or kept past its 12 months): the message starts a new one.
        setConversation(null);
        remember(null);
        setMessages([]);
        setDraft(text);
        setStatus("unavailable");
      } else giveBack(reply.error === "invalid" ? "invalid" : "unavailable");
    } catch {
      giveBack("unavailable");
    }
  }

  const conversationTitle = conversation ? conversation.title : t("coachPanel.newConversation");
  const control: Control = { open, panelId: `${id}-panel`, toggle: () => (open ? close() : void openPanel()), register, ask };

  return (
    <PanelControl.Provider value={control}>
      {/* A widened panel is modal: the page beneath is out of reach until it narrows or closes. */}
      <div className={open ? "with-coach-panel" : undefined} inert={open && wide} aria-hidden={(open && wide) || undefined}>
        {children}
      </div>
      {open && wide ? <div className="coach-panel-scrim" aria-hidden="true" onClick={() => setWide(false)} /> : null}
      {open ? (
        <aside
          id={`${id}-panel`}
          className={wide ? "coach-panel coach-panel-wide" : "coach-panel"}
          aria-labelledby={`${id}-title`}
          aria-modal={wide || undefined}
          role={wide ? "dialog" : undefined}
          onKeyDown={onKeyDown}
        >
          <div className="coach-panel-header">
            <h2 id={`${id}-title`} className="coach-panel-title">
              {t("backOfficeAssistant.title")}
            </h2>
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger className="button button-quiet coach-panel-menu-button">
                <span className="coach-panel-menu-title">{view === "list" ? t("coachPanel.conversations") : conversationTitle}</span>
                <Icons.chevron />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="menu coach-panel-menu"
                  align={MENU_ALIGN}
                  sideOffset={4}
                  // An item that moves focus on (the list's heading, the message box) keeps it there.
                  onCloseAutoFocus={(event) => {
                    if (focusMoved.current) event.preventDefault();
                    focusMoved.current = false;
                  }}
                >
                  <DropdownMenu.Item className="menu-item" onSelect={() => moveFocus(startNewConversation)}>
                    <Icons.add />
                    {t("coachPanel.newConversation")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="menu-item" onSelect={() => moveFocus(() => void showList())}>
                    <Icons.conversations />
                    {t("coachPanel.conversations")}
                  </DropdownMenu.Item>
                  {view !== "chat" ? (
                    <>
                      <DropdownMenu.Separator className="menu-separator" />
                      <DropdownMenu.Item className="menu-item" onSelect={() => moveFocus(showChat)}>
                        {t("coachPanel.backToConversation")}
                      </DropdownMenu.Item>
                    </>
                  ) : null}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <div className="coach-panel-actions">
              <button className="button button-quiet coach-panel-widen" type="button" onClick={() => setWide((was) => !was)}>
                {t(wide ? "coachPanel.narrow" : "coachPanel.widen")}
              </button>
              <button className="button button-quiet" type="button" onClick={close}>
                <Icons.close />
                {t("coachPanel.close")}
              </button>
            </div>
          </div>
          {view === "list" ? (
            <div className="coach-panel-body">
              <CoachConversationList
                endpoint={CONVERSATIONS}
                texts={LIST_TEXTS}
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
              <div className="coach-panel-body" ref={body}>
                <h3 className="visually-hidden">{conversationTitle}</h3>
                {restoring ? <p role="status">{t("coachPanel.loading")}</p> : null}
                <ol className="chat coach-panel-messages" aria-label={t("backOfficeAssistant.messagesLabel")} aria-live="polite">
                  {restoring ? null : (
                    <li className="chat-message chat-coach">
                      {/* No visible author (#317, #327): screen readers still hear who speaks. */}
                      <span className="visually-hidden">{t("backOfficeAssistant.author")}</span>
                      <p>{t("backOfficeAssistant.welcome")}</p>
                    </li>
                  )}
                  {messages.map((message, index) => (
                    <li key={index} className={`chat-message ${message.from === "coach" ? "chat-coach" : "chat-candidate"}${message.blocked ? " chat-blocked" : ""}`}>
                      <span className="visually-hidden">{message.from === "coach" ? t("backOfficeAssistant.author") : t("questionnaire.you")}</span>
                      {/* A reply is unframed text after the glyph of what it did last (#464); the Administrator's words, a bubble. */}
                      {message.from === "coach" ? <ActivityGlyph activity={replyActivity(message.provenance ?? null)} /> : null}
                      {message.blocked ? <span className="chat-blocked-label">{t("coachPanel.blocked")}</span> : null}
                      {message.from === "coach" ? <CoachReplyText text={message.text} /> : <p>{message.text}</p>}
                      {message.from === "coach" && message.at ? <ProvenanceLine provenance={message.provenance ?? null} at={message.at} /> : null}
                    </li>
                  ))}
                </ol>
                {status === "sending" ? (
                  <p className="notice" role="status">
                    {t("backOfficeAssistant.thinking")}
                  </p>
                ) : null}
                {status === "unavailable" || status === "invalid" ? (
                  <p className="notice" role="alert">
                    {status === "invalid" ? t("coachPanel.errors.invalid") : t("backOfficeAssistant.unavailable")}
                  </p>
                ) : null}
                <div ref={messagesEnd} aria-hidden="true" />
              </div>
              <form className="coach-panel-form" onSubmit={send}>
                <label className="visually-hidden" htmlFor={`${id}-message`}>
                  {t("coachPanel.messageLabel")}
                </label>
                {/* The Send button sits inside the message box; a click anywhere in the box writes in it. */}
                <div className="coach-panel-composer" onClick={(event) => event.target === event.currentTarget && input.current?.focus()}>
                  <textarea
                    id={`${id}-message`}
                    ref={input}
                    rows={2}
                    placeholder={t("coachPanel.messageLabel")}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="coach-panel-composer-actions">
                    {/* Says, by the message box, that the one answering is an AI (#324). */}
                    <span className="pill coach-panel-badge" data-tone="accent">
                      {t("backOfficeAssistant.badge")}
                    </span>
                    <button className={buttonClass({ variant: "primary" })} type="submit" disabled={status === "sending" || restoring}>
                      {t("backOfficeAssistant.send")}
                    </button>
                  </div>
                </div>
                {/* What goes with the message: nothing in view, the Assistant reads the Back Office, never changes it. */}
                <details className="coach-panel-context">
                  <summary>
                    <Icons.coach />
                    <span className="coach-panel-context-line">{t("backOfficeAssistant.readOnly")}</span>
                  </summary>
                  <div className="coach-panel-context-more">
                    <p className="coach-panel-in-view">{t("backOfficeAssistant.readOnly")}</p>
                  </div>
                </details>
              </form>
            </>
          )}
        </aside>
      ) : null}
    </PanelControl.Provider>
  );
}

"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ParseKeys } from "i18next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { CoachFocus } from "@/coach";
import { coachReplyBlocks, type Inline } from "@/coach/reply-text";
import type { CoachMessage, JobOfferCard as JobOfferCardData } from "@/coach/conversation";
import { CoachConversationList, type ConversationSummary } from "@/components/CoachConversationList";
import { CoachMemoryProposals, CoachMemoryView } from "@/components/CoachMemory";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icons } from "@/components/icons";
import { PrototypeReplyActivity, PrototypeReplyResult, protoResultFor, protoStoppedResult, type ProtoReplyResult } from "@/components/PrototypeAiProvenanceBar";
import { StartJobSearchButton } from "@/components/JobSearchControls";
import { routes } from "@/routes";

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
  /** The button's words. */
  label: ParseKeys;
};

const CoachPanelControl = createContext<Control | null>(null);

/** The menu opens under the conversation's title, from its start. */
const MENU_ALIGN = "start";
const MEMORY_VIEW = "memory";

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
  const { open, panelId, toggle, register, label } = control;
  // While the panel is open its Fermer button closes it: the toggle steps aside (ADR-0024).
  if (open) return null;
  return (
    <button
      ref={register}
      className={floating ? "button button-primary coach-panel-toggle coach-panel-toggle-floating" : "button coach-panel-toggle"}
      type="button"
      aria-expanded={false}
      aria-controls={panelId}
      onClick={toggle}
    >
      <Icons.coach />
      {t(label)}
    </button>
  );
}

/**
 * Declares the Profile, Application, Job Offer, Job Search or Job Digest a page
 * shows, or the Agenda, so the Coach Panel (and the AI Coach behind it) know what the Candidate
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
  agenda: "coachPanel.inViewAgenda",
} as const satisfies Record<InView["kind"], string>;

type Status = "idle" | "sending" | "unavailable" | "invalid";

/**
 * Which panel it is: the Candidate's Coach Panel, with the AI Coach, or the
 * Back Office Assistant (#205), the same panel for Administrators in the Back
 * Office, with its own conversations and no Coach Memory, nothing In view and
 * no Job Search.
 */
export type PanelKind = "coach" | "backOfficeAssistant";

/** What a message's author is called on the server, for each panel. */
type ServerMessage = { from: "candidate" | "coach" | "administrator" | "assistant"; text: string; blocked?: true; jobOffer?: JobOfferCardData };

/** Everything that differs between the two panels. */
interface PanelConfig {
  send: string;
  conversations: string;
  /** This browser remembers which conversation was open, to reopen it after a reload. */
  storageKey: string;
  features: {
    /** The Coach Memory view and its proposals. */
    memory: boolean;
    /** What the page has in view goes with each message, and the Job Search it allows. */
    inView: boolean;
  };
  texts: Record<"open" | "title" | "welcome" | "thinking" | "unavailable" | "messagesLabel" | "author" | "retention" | "noConversations", ParseKeys> & {
    /** Shown where the Coach Panel says what is in view, for a panel that follows nothing in view. */
    context?: ParseKeys;
  };
}

const PANELS: Record<PanelKind, PanelConfig> = {
  coach: {
    send: "/api/coach",
    conversations: "/api/coach/conversations",
    storageKey: "jobhub.coachConversation",
    features: { memory: true, inView: true },
    texts: {
      open: "coachPanel.open",
      title: "coachPanel.title",
      welcome: "coachPanel.welcome",
      thinking: "coachPanel.thinking",
      unavailable: "coachPanel.errors.unavailable",
      messagesLabel: "coachPanel.messagesLabel",
      author: "questionnaire.coach",
      retention: "coachPanel.retention",
      noConversations: "coachPanel.noConversations",
    },
  },
  backOfficeAssistant: {
    send: "/api/admin/assistant",
    conversations: "/api/admin/assistant/conversations",
    storageKey: "jobhub.backOfficeAssistantConversation",
    features: { memory: false, inView: false },
    texts: {
      open: "backOfficeAssistant.open",
      title: "backOfficeAssistant.title",
      welcome: "backOfficeAssistant.welcome",
      thinking: "backOfficeAssistant.thinking",
      unavailable: "backOfficeAssistant.unavailable",
      messagesLabel: "backOfficeAssistant.messagesLabel",
      author: "backOfficeAssistant.author",
      retention: "backOfficeAssistant.retention",
      noConversations: "backOfficeAssistant.noConversations",
      context: "backOfficeAssistant.readOnly",
    },
  },
};

/** A message as the panel shows it: the person's own, or the AI's reply. */
const asPanelMessage = (message: ServerMessage): CoachMessage => ({
  from: message.from === "candidate" || message.from === "administrator" ? "candidate" : "coach",
  text: message.text,
  ...(message.blocked ? { blocked: true as const } : {}),
  ...(message.jobOffer ? { jobOffer: message.jobOffer } : {}),
});

function remember(storageKey: string, conversationId: string | null) {
  try {
    if (conversationId) window.localStorage.setItem(storageKey, conversationId);
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Storage blocked: the conversation is still saved, only not reopened by itself.
  }
}

function remembered(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
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

/**
 * A Job Offer card: the Job Offer an AI Coach reply read from a pasted link, linking to its page, where the
 * Candidate processes it. "À traiter" until they follow it; its state said in words, never by colour alone.
 */
function JobOfferCard({ jobOffer }: { jobOffer: JobOfferCardData }) {
  const { t } = useTranslation();
  return (
    <article className="job-offer-card" aria-label={t("coachPanel.jobOfferLink.card")}>
      <span className="pill" data-tone={jobOffer.followed ? "success" : "accent"}>
        {t(jobOffer.followed ? "coachPanel.jobOfferLink.followed" : "coachPanel.jobOfferLink.toProcess")}
      </span>
      <p className="job-offer-card-title">{jobOffer.title}</p>
      {jobOffer.employer ? <p className="hint">{jobOffer.employer}</p> : null}
      <Link className="button" href={routes.jobOffer(jobOffer.id)}>
        {t("coachPanel.jobOfferLink.open")}
      </Link>
    </article>
  );
}

/** A saved conversation with its messages, or null when it is gone or cannot be read. */
async function fetchConversation(endpoint: string, conversationId: string): Promise<{ conversation: ConversationSummary & { messages: CoachMessage[] } } | { gone: boolean }> {
  const response = await fetch(`${endpoint}/${encodeURIComponent(conversationId)}`).catch(() => null);
  if (!response?.ok) return { gone: response?.status === 404 };
  const { conversation } = (await response.json()) as { conversation: ConversationSummary & { messages: ServerMessage[] } };
  return { conversation: { ...conversation, messages: conversation.messages.map(asPanelMessage) } };
}

/**
 * The Coach Panel: the side panel, available from every page of a signed-in
 * Candidate, where they talk with the AI Coach. Each exchange is saved in a
 * Coach Conversation, which carries over from page to page and reopens after a
 * reload; each message goes with what the Candidate has in view. The Candidate
 * starts new conversations and lists, reopens, renames or deletes saved ones.
 * With a Profile in view, the Candidate can also ask the AI Coach to search
 * for Job Offers for it. `kind="backOfficeAssistant"`: the same panel for an
 * Administrator in the Back Office (see PanelKind).
 */
export function CoachPanel({ kind = "coach", children }: { kind?: PanelKind; children: ReactNode }) {
  const { t } = useTranslation();
  const panel = PANELS[kind];
  const texts = panel.texts;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [inView, setInViewState] = useState<InView | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  // PROTOTYPE: each reply's run results, by the reply's index (stubbed, see PrototypeReplyResult).
  const [protoResults, setProtoResults] = useState<Record<number, ProtoReplyResult>>({});
  const [protoQuestion, setProtoQuestion] = useState("");
  // PROTOTYPE: « Arrêter » (#316). What is running: the demo's timer or the real request.
  const protoTimer = useRef<number | undefined>(undefined);
  const protoAbort = useRef<AbortController | null>(null);
  const protoStarted = useRef(0);
  const protoAsked = useRef("");
  const stopReply = useCallback(() => {
    window.clearTimeout(protoTimer.current);
    // Today the server finishes the reply and saves it anyway (#319): the real build aborts the AI call.
    protoAbort.current?.abort();
    protoAbort.current = null;
    const question = protoAsked.current;
    const result = protoStoppedResult(question, performance.now() - protoStarted.current);
    setMessages((m) => {
      setProtoResults((r) => ({ ...r, [m.length]: result }));
      return [...m, { from: "coach", text: "Réponse arrêtée" }];
    });
    window.dispatchEvent(new CustomEvent("proto-coach-done", { detail: { ...result, question } }));
    setStatus("idle");
  }, []);
  useEffect(() => {
    window.addEventListener("proto-coach-stop", stopReply);
    return () => window.removeEventListener("proto-coach-stop", stopReply);
  }, [stopReply]);
  // PROTOTYPE: « ▶ coach » in the prototype switcher plays an exchange without calling the AI.
  useEffect(() => {
    const play = (event: Event) => {
      const { question, reply, ms } = (event as CustomEvent<{ question: string; reply: string; ms: number }>).detail;
      setOpen(true);
      setView("chat");
      setProtoQuestion(question);
      protoAsked.current = question;
      protoStarted.current = performance.now();
      setStatus("sending");
      setMessages((m) => [...m, { from: "candidate", text: question }]);
      protoTimer.current = window.setTimeout(() => {
        const result = protoResultFor(question);
        setMessages((m) => {
          setProtoResults((r) => ({ ...r, [m.length]: result }));
          return [...m, { from: "coach", text: reply }];
        });
        window.dispatchEvent(new CustomEvent("proto-coach-done", { detail: { ...result, question } }));
        setStatus("idle");
      }, ms);
    };
    window.addEventListener("proto-coach-demo", play);
    return () => window.removeEventListener("proto-coach-demo", play);
  }, []);
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
  const messagesEnd = useRef<HTMLDivElement>(null);
  const setInView = useCallback((next: InView | null) => setInViewState(next), []);
  // Agrandir: the panel widens into a modal drawer over the page (ADR-0024); never remembered.
  const [wide, setWide] = useState(false);
  const focusMoved = useRef(false);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, focusInput]);

  function openPanel() {
    setOpen(true);
    // The first time the panel opens, reopen the conversation this browser had open.
    if (restored.current) return;
    restored.current = true;
    const conversationId = remembered(panel.storageKey);
    if (!conversationId) return;
    setRestoring(true);
    void fetchConversation(panel.conversations, conversationId).then((found) => {
      if ("conversation" in found) {
        const { messages: saved, ...summary } = found.conversation;
        setConversation(summary);
        setMessages(saved);
      } else if (found.gone) remember(panel.storageKey, null);
      setRestoring(false);
    });
  }

  function close() {
    setOpen(false);
    setWide(false);
    // The button on screen: the top bar's, or the floating one where there is no top bar,
    // once it is back (the toggle steps aside while the panel is open).
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

  function showMemory() {
    setView(MEMORY_VIEW);
  }

  function showChat() {
    setView("chat");
    setFocusInput((n) => n + 1);
  }

  function startNewConversation() {
    setConversation(null);
    setMessages([]);
    setStatus("idle");
    remember(panel.storageKey, null);
    showChat();
  }

  async function showList() {
    setView("list");
    setConversations(null);
    setListFailed(false);
    const response = await fetch(panel.conversations).catch(() => null);
    if (response?.ok) setConversations((await response.json()).conversations);
    else setListFailed(true);
  }

  // The latest message (or the "thinking" notice) comes into view when it arrives (#164): the
  // body scrolls to where the messages end, not to its own end, which holds the Coach Memory
  // proposals (#125) and would push the latest reply out of sight in a short panel.
  useEffect(() => {
    const element = body.current;
    const end = messagesEnd.current;
    if (element && end) element.scrollTop += end.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
  }, [messages, status, view, open]);

  async function openConversation(conversationId: string): Promise<boolean> {
    const found = await fetchConversation(panel.conversations, conversationId);
    if (!("conversation" in found)) {
      if (found.gone) setConversations((list) => list?.filter((item) => item.id !== conversationId) ?? null);
      return false;
    }
    const { messages: saved, ...summary } = found.conversation;
    setConversation(summary);
    setMessages(saved);
    setStatus("idle");
    remember(panel.storageKey, summary.id);
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
    setProtoQuestion(text);
    protoAsked.current = text;
    protoStarted.current = performance.now();
    const controller = new AbortController();
    protoAbort.current = controller;
    const giveBack = (error: Status) => {
      // Give the Candidate their message back to retry or shorten it.
      setMessages(messages);
      setDraft(text);
      setStatus(error);
    };
    try {
      const response = await fetch(panel.send, {
        signal: controller.signal,
        method: "POST",
        headers: { "content-type": "application/json" },
        // The server holds the conversation: only the new message goes.
        body: JSON.stringify({
          ...(conversation ? { conversationId: conversation.id } : {}),
          message: text,
          ...(inView && panel.features.inView ? { focus: { kind: inView.kind, id: inView.id, ...(inView.profileId ? { profileId: inView.profileId } : {}) } } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body.reply === "string") {
        setConversation(body.conversation);
        remember(panel.storageKey, body.conversation.id);
        // A Blocked message (#228): the Guardrail is never named, only that the message or the reply was blocked.
        const blocked = body.blocked as { message?: boolean; reply?: boolean } | undefined;
        setMessages([
          ...messages,
          { from: "candidate", text, ...(blocked?.message ? { blocked: true as const } : {}) },
          { from: "coach", text: body.reply, ...(blocked?.reply ? { blocked: true as const } : {}), ...(body.jobOffer ? { jobOffer: body.jobOffer as JobOfferCardData } : {}) },
        ]);
        const result = protoResultFor(text);
        setProtoResults((r) => ({ ...r, [messages.length + 1]: result }));
        window.dispatchEvent(new CustomEvent("proto-coach-done", { detail: { ...result, question: text } }));
        setStatus("idle");
      } else if (response.status === 404) {
        // Deleted meanwhile (another tab, or kept past its 12 months): the message starts a new one.
        setConversation(null);
        remember(panel.storageKey, null);
        setMessages([]);
        setDraft(text);
        setStatus("unavailable");
      } else giveBack(body.error === "invalid" ? "invalid" : "unavailable");
    } catch {
      // Stopped: stopReply has already said so.
      if (controller.signal.aborted) return;
      giveBack("unavailable");
    }
  }

  const inViewLabel = inView
    ? t("coachPanel.inView", {
        label: t(IN_VIEW_LABEL[inView.kind], { name: inView.name }),
      })
    : t("coachPanel.nothingInView");

  const contextText = panel.features.inView || !texts.context ? inViewLabel : t(texts.context);
  const conversationTitle = conversation ? conversation.title : t("coachPanel.newConversation");

  const control: Control = { open, panelId: `${id}-panel`, toggle: () => (open ? close() : openPanel()), register, label: texts.open };

  return (
    <SetInView.Provider value={setInView}>
      <CoachPanelControl.Provider value={control}>
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
              <h2 id={`${id}-title`} className="visually-hidden">
                {t(texts.title)}
              </h2>
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger className="button button-quiet coach-panel-menu-button">
                  <span className="coach-panel-menu-title">{view === "list" ? t("coachPanel.conversations") : view === "memory" ? t("coachMemory.open") : conversationTitle}</span>
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
                    {panel.features.memory ? (
                      <DropdownMenu.Item className="menu-item" onSelect={() => moveFocus(showMemory)}>
                        <Icons.coach />
                        {t("coachMemory.open")}
                      </DropdownMenu.Item>
                    ) : null}
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
            {view === "memory" ? (
              <div className="coach-panel-body">
                <CoachMemoryView />
              </div>
            ) : view === "list" ? (
              <div className="coach-panel-body">
                <CoachConversationList
                  endpoint={panel.conversations}
                  texts={texts}
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
                      remember(panel.storageKey, null);
                    }
                  }}
                />
              </div>
            ) : (
              <>
                <div className="coach-panel-body" ref={body}>
                  <h3 className="visually-hidden">{conversationTitle}</h3>
                  {restoring ? <p role="status">{t("coachPanel.loading")}</p> : null}
                  <ol className="chat coach-panel-messages" aria-label={t(texts.messagesLabel)} aria-live="polite">
                    <li className="chat-message chat-coach">
                      {/* PROTOTYPE: no visible author (the user's request); screen readers still hear it. */}
                      <span className="visually-hidden">{t(texts.author)}</span>
                      <p>{t(texts.welcome)}</p>
                    </li>
                    {messages.map((message, index) => (
                      <li
                        key={index}
                        className={`chat-message ${message.from === "coach" ? "chat-coach" : "chat-candidate"}${message.blocked ? " chat-blocked" : ""}`}
                        // PROTOTYPE: a stopped reply in a very light red (the user's request).
                        style={protoResults[index]?.stopped ? { background: "var(--color-danger-surface)" } : undefined}
                      >
                        <span className="visually-hidden">{message.from === "coach" ? t(texts.author) : t("questionnaire.you")}</span>
                        {message.blocked ? <span className="chat-blocked-label">{t("coachPanel.blocked")}</span> : null}
                        {message.from === "coach" ? (
                          protoResults[index]?.stopped ? (
                            <p style={{ fontStyle: "italic", color: "var(--color-text-secondary)" }}>{message.text}</p>
                          ) : (
                            <CoachReplyText text={message.text} />
                          )
                        ) : (
                          <p>{message.text}</p>
                        )}
                        {message.jobOffer ? <JobOfferCard jobOffer={message.jobOffer} /> : null}
                        {protoResults[index] ? <PrototypeReplyResult result={protoResults[index]} /> : null}
                      </li>
                    ))}
                  </ol>
                  {status === "sending" ? (
                    <p role="status" aria-label={t(texts.thinking)} style={{ margin: 0 }}>
                      {/* PROTOTYPE: the glyph of what the AI is doing now, instead of « … rédige sa réponse ». */}
                      <PrototypeReplyActivity question={protoQuestion} />
                    </p>
                  ) : null}
                  {status === "unavailable" || status === "invalid" ? (
                    <p className="notice" role="alert" style={{ background: "var(--color-danger-surface)" /* PROTOTYPE: a failed reply, very light red */ }}>
                      {t(status === "unavailable" ? texts.unavailable : "coachPanel.errors.invalid")}
                    </p>
                  ) : null}
                  <div ref={messagesEnd} aria-hidden="true" />
                  {conversation && panel.features.memory ? <CoachMemoryProposals key={conversation.id} conversationId={conversation.id} /> : null}
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
                    {status === "sending" ? (
                      // PROTOTYPE: « Envoyer » becomes « Arrêter » while a reply is on its way (#316).
                      <button className="button" type="button" onClick={stopReply}>
                        <span aria-hidden style={{ display: "inline-block", width: "0.6em", height: "0.6em", marginRight: "0.45em", background: "currentColor", borderRadius: 1 }} />
                        Arrêter
                      </button>
                    ) : (
                      <button className="button button-primary" type="submit" disabled={restoring}>
                        {t("coachPanel.send")}
                      </button>
                    )}
                  </div>
                  {/* What goes with the message: one line, opened for the whole text (and the Job Search). */}
                  <details className="coach-panel-context">
                    <summary>
                      <Icons.coach />
                      <span className="coach-panel-context-line">{contextText}</span>
                    </summary>
                    <div className="coach-panel-context-more">
                      <p className="coach-panel-in-view">{contextText}</p>
                      {!panel.features.inView ? null : profileIdOf(inView) ? (
                        <StartJobSearchButton key={profileIdOf(inView)} profileId={profileIdOf(inView)!} label={t("coachPanel.searchJobs")} className="button" />
                      ) : (
                        <p className="hint">{t("coachPanel.searchHint")}</p>
                      )}
                    </div>
                  </details>
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

/**
 * The Candidate's Coach Panel around every page but the Back Office's, whose
 * pages carry the Back Office Assistant instead (BackOfficeLayout): only one
 * panel is ever mounted.
 */
export function CandidateCoachPanel({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inBackOffice = pathname === routes.admin || pathname.startsWith(`${routes.admin}/`);
  return inBackOffice ? children : <CoachPanel>{children}</CoachPanel>;
}
